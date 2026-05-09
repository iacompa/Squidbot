import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SquidDatabase } from "@squidbot/db";
import { AgentRuntime, computeTraceMetrics, createId } from "@squidbot/core";
import { SkillService } from "./service.js";
import type { EvaluationResult, SkillFixtureEvaluation } from "./types.js";

export type EvaluateSkillOptions = {
  version?: string;
  workspacePath?: string;
  runtimeFactory?: (workspacePath: string) => AgentRuntime;
};

export async function evaluateSkill(database: SquidDatabase, skillId: string, options: EvaluateSkillOptions = {}): Promise<EvaluationResult> {
  const service = new SkillService(database);
  const skillVersion = service.getVersion(skillId, options.version);
  if (!skillVersion) {
    throw new Error(`Skill version not found: ${skillId}${options.version ? `@${options.version}` : ""}`);
  }

  const fixtureResults: SkillFixtureEvaluation[] = [];
  for (const fixture of skillVersion.testFixtures) {
    const startedAt = Date.now();
    const workspacePath = prepareFixtureWorkspace(fixture.repoPath ?? options.workspacePath);
    const runtime = options.runtimeFactory?.(workspacePath) ?? new AgentRuntime({ database, workspacePath });
    try {
      const result = await runtime.runTask(fixture.task, {
        testCommand: fixture.testCommand,
        skillCall: {
          skillId,
          version: skillVersion.version,
          testMode: true
        }
      });
      const metrics = computeTraceMetrics(result.trace);
      const errors = result.toolResults.filter((toolResult) => !toolResult.ok).map((toolResult) => `${toolResult.toolName}: ${JSON.stringify(toolResult.output)}`);
      const testOutput = result.toolResults.find((toolResult) => toolResult.toolName === "test.run")?.output as { exitCode?: number } | undefined;
      const testPassed = fixture.testCommand ? testOutput?.exitCode === 0 : true;
      const diffPassed = fixture.expectedDiff ? sandboxDiffMatches(database, result.runId, fixture.expectedDiff) : true;
      fixtureResults.push({
        fixtureId: fixture.id,
        name: fixture.name,
        pass: errors.length === 0 && testPassed && diffPassed,
        durationMs: Date.now() - startedAt,
        toolCount: result.toolResults.length,
        cost: metrics.totalCost,
        runId: result.runId,
        errors: [...errors, ...(testPassed ? [] : [`Test command failed with exit ${testOutput?.exitCode ?? "unknown"}.`]), ...(diffPassed ? [] : ["Expected diff was not found in sandbox output."])]
      });
    } catch (error) {
      fixtureResults.push({
        fixtureId: fixture.id,
        name: fixture.name,
        pass: false,
        durationMs: Date.now() - startedAt,
        toolCount: 0,
        cost: 0,
        errors: [error instanceof Error ? error.message : "Unknown evaluation error."]
      });
    }
  }

  const durations = fixtureResults.map((result) => result.durationMs).sort((left, right) => left - right);
  const passedFixtures = fixtureResults.filter((result) => result.pass).length;
  const fixtureCount = fixtureResults.length;
  const evaluation: EvaluationResult = {
    id: createId("skill_eval"),
    skillId,
    version: skillVersion.version,
    pass: fixtureCount > 0 && passedFixtures / fixtureCount >= 0.8,
    createdAt: new Date().toISOString(),
    metrics: {
      fixtureCount,
      passedFixtures,
      successRate: fixtureCount ? Number((passedFixtures / fixtureCount).toFixed(4)) : 0,
      medianRuntimeMs: durations.length ? durations[Math.floor(durations.length / 2)] : 0,
      toolCount: fixtureResults.reduce((total, result) => total + result.toolCount, 0),
      cost: fixtureResults.reduce((total, result) => total + result.cost, 0)
    },
    fixtures: fixtureResults
  };
  service.recordEvaluation(evaluation);
  return evaluation;
}

function prepareFixtureWorkspace(repoPath?: string): string {
  if (!repoPath) {
    const emptyWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-skill-empty-"));
    return emptyWorkspace;
  }

  if (!fs.existsSync(repoPath)) {
    throw new Error(`Fixture repo does not exist: ${repoPath}`);
  }

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-skill-fixture-"));
  fs.cpSync(repoPath, workspace, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`) && !source.endsWith(`${path.sep}node_modules`)
  });
  return workspace;
}

function sandboxDiffMatches(database: SquidDatabase, runId: string, expectedDiff: string): boolean {
  const normalizedExpectedLines = importantDiffLines(expectedDiff);
  if (normalizedExpectedLines.length === 0) {
    return true;
  }
  const matchingSandbox = database
    .listSandboxes({ status: "all", limit: 200 })
    .find((sandbox) => sandbox.runId === runId && normalizedExpectedLines.every((line) => sandbox.diff.includes(line)));
  return Boolean(matchingSandbox);
}

function importantDiffLines(diff: string): string[] {
  return diff
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith("+") || line.startsWith("-"))
    .filter((line) => !line.startsWith("+++") && !line.startsWith("---"))
    .slice(0, 20);
}
