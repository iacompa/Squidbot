import fs from "node:fs";
import path from "node:path";
import { ConnectorRegistry, installDeveloperWorkflowConnectors, registerConnectorTools } from "@squidbot/connectors";
import type { SquidDatabase } from "@squidbot/db";
import { AgentRuntime, buildTrace, createId, registerTerminalTools, registerTestTools, registerWorkspaceTools, ToolRegistry, type AgentEvent } from "@squidbot/core";
import { MemoryGraphStore } from "@squidbot/memory";
import { installDeveloperWorkflowSkills, SkillService } from "@squidbot/skills";
import { scoreTask, summarizeRunMetrics } from "./metricEngine.js";
import { EvalResultStore } from "./resultStore.js";
import { runStaticChecks } from "./staticChecks.js";
import { SkillVariantStore } from "./skillVariantStore.js";
import type { EvalRunRecord, EvalTaskRecord, SkillVariantRecord } from "./types.js";

export class BenchmarkRunner {
  private readonly store: EvalResultStore;
  private readonly variants: SkillVariantStore;

  constructor(
    private readonly database: SquidDatabase,
    private readonly options: { skillsRoot?: string } = {}
  ) {
    this.store = new EvalResultStore(database);
    this.variants = new SkillVariantStore(database);
  }

  async run(input: { datasetId: string; skillId?: string; version?: string; variantId?: string }): Promise<{ evalRun: EvalRunRecord; taskResults: ReturnType<EvalResultStore["listTaskResults"]>; traceId: string }> {
    const dataset = this.store.getDataset(input.datasetId);
    if (!dataset) {
      throw new Error(`Dataset not installed: ${input.datasetId}`);
    }
    const skillService = this.createSkillService();
    const variant = input.variantId ? this.requireVariant(input.variantId) : null;
    if (variant) {
      const check = runStaticChecks(variant);
      this.store.saveStaticCheck(variant.id, check);
      if (check.status !== "passed") {
        throw new Error(`Variant static checks failed: ${variant.id}`);
      }
    }
    const resolvedSkillId = variant?.skillId ?? this.resolveSkillId(skillService, input.skillId);
    const targetId = variant ? variant.id : `${resolvedSkillId}@${input.version ?? skillService.getSkill(resolvedSkillId)?.currentVersion ?? "0.1.0"}`;
    const evalRun = this.store.createEvalRun({
      datasetId: dataset.id,
      targetType: variant ? "skillVariant" : "skillVersion",
      targetId,
      mode: "offline"
    });
    const events: AgentEvent[] = [];
    const emit = (type: AgentEvent["type"], data: Record<string, unknown>): void => {
      const event: AgentEvent = {
        id: createId("evt"),
        timestamp: new Date().toISOString(),
        sessionId: `session_${evalRun.id}`,
        runId: evalRun.id,
        type,
        data: {
          runId: evalRun.id,
          evalRunId: evalRun.id,
          datasetId: dataset.id,
          ...data
        }
      };
      events.push(event);
      this.database.appendEvent({ id: event.id, timestamp: event.timestamp, sessionId: event.sessionId, type: event.type, data: event.data });
    };

    this.store.updateEvalRun(evalRun.id, { status: "running", startedAt: new Date().toISOString() });
    emit("eval.run.started", { targetId, targetType: variant ? "skillVariant" : "skillVersion", mode: "offline" });
    if (variant) {
      if (variant.state === "generated") {
        this.variants.updateState(variant.id, "sandbox_testing");
      } else if (variant.state !== "sandbox_testing" && variant.state !== "benchmarking" && variant.state !== "canary" && variant.state !== "stable") {
        throw new Error(`Variant cannot enter benchmarking from state ${variant.state}.`);
      }
      const refreshed = this.variants.getVariant(variant.id);
      if (refreshed?.state === "sandbox_testing") {
        this.variants.updateState(variant.id, "benchmarking");
      }
    }

    const taskSummaries: Array<{ status: string; score: number; metrics: unknown[]; durationMs?: number; cost?: number }> = [];
    try {
      for (const task of this.store.listTasks(dataset.id)) {
        const result = await this.runTask({
          evalRunId: evalRun.id,
          task,
          datasetSourcePath: dataset.sourcePath,
          skillId: resolvedSkillId,
          version: variant?.baseVersion ?? input.version,
          variant,
          emit
        });
        taskSummaries.push(result);
      }
      const metrics = summarizeRunMetrics(taskSummaries.map((item) => ({
        status: item.status,
        score: item.score,
        metrics: item.metrics as never,
        durationMs: item.durationMs,
        cost: item.cost
      })));
      const completed = this.store.updateEvalRun(evalRun.id, {
        status: "completed",
        completedAt: new Date().toISOString(),
        metrics,
        summary: {
          datasetId: dataset.id,
          targetId,
          compositeScore: metrics.compositeScore,
          passedTaskCount: metrics.passedTaskCount,
          taskCount: metrics.taskCount
        },
        report: {
          dataset: dataset.manifest,
          taskResults: this.store.listTaskResults(evalRun.id),
          metrics
        }
      });
      this.store.upsertLeaderboard({
        datasetId: dataset.id,
        targetType: completed.targetType,
        targetId: completed.targetId,
        evalRunId: completed.id,
        compositeScore: metrics.compositeScore,
        metrics
      });
      this.persistMemory(completed);
      emit("eval.run.completed", { status: completed.status, metrics });
      const trace = buildTrace(events);
      this.database.saveTrace({ id: trace.id, sessionId: trace.sessionId, events: trace, createdAt: trace.createdAt });
      return { evalRun: completed, taskResults: this.store.listTaskResults(evalRun.id), traceId: trace.id };
    } catch (error) {
      const failed = this.store.updateEvalRun(evalRun.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        summary: { error: error instanceof Error ? error.message : String(error) },
        report: { error: error instanceof Error ? error.message : String(error) }
      });
      emit("eval.run.failed", { error: error instanceof Error ? error.message : String(error) });
      const trace = buildTrace(events);
      this.database.saveTrace({ id: trace.id, sessionId: trace.sessionId, events: trace, createdAt: trace.createdAt });
      return { evalRun: failed, taskResults: this.store.listTaskResults(evalRun.id), traceId: trace.id };
    }
  }

  private async runTask(input: {
    evalRunId: string;
    task: EvalTaskRecord;
    datasetSourcePath: string | null;
    skillId: string;
    version?: string;
    variant: SkillVariantRecord | null;
    emit: (type: AgentEvent["type"], data: Record<string, unknown>) => void;
  }): Promise<{ status: string; score: number; metrics: unknown[]; durationMs: number; cost: number }> {
    const startedAt = new Date().toISOString();
    input.emit("eval.task.started", { evalTaskId: input.task.id, name: input.task.name });
    const workspacePath = resolveWorkspacePath(input.datasetSourcePath, input.task);
    const previousProvider = this.database.getSetting("model.provider");
    this.database.setSetting("model.provider", "mock");
    const started = Date.now();
    try {
      const runtime = this.createRuntime(workspacePath);
      const result = await runtime.runTask(input.task.task.task, {
        testCommand: input.task.task.expected.mustPassTests?.[0],
        skillCall: {
          skillId: input.skillId,
          version: input.version ?? "0.1.0",
          testMode: true
        }
      });
      const trace = result.trace;
      const durationMs = Date.now() - started;
      const score = scoreTask(
        {
          task: input.task.task,
          trace,
          finalSummary: result.finalSummary,
          testExitCode: extractTestExitCode(trace),
          durationMs,
          cost: 0,
          variantImpact: readVariantImpact(input.variant)
        },
        input.task.task.scoringOverrides?.weights ?? this.store.getDataset(input.task.datasetId)?.manifest.scoring.weights ?? {}
      );
      const taskResult = this.store.createTaskResult({
        evalRunId: input.evalRunId,
        evalTaskId: input.task.id,
        status: score.status,
        score: score.score,
        metrics: score.metrics,
        traceId: trace.id,
        runId: result.runId,
        sandboxId: extractSandboxId(trace),
        output: { finalSummary: result.finalSummary },
        startedAt,
        completedAt: new Date().toISOString()
      });
      input.emit(score.status === "passed" ? "eval.task.completed" : "eval.task.failed", {
        evalTaskId: input.task.id,
        status: taskResult.status,
        score: taskResult.score,
        traceId: trace.id,
        runId: result.runId
      });
      return { status: score.status, score: score.score, metrics: score.metrics, durationMs, cost: 0 };
    } catch (error) {
      const durationMs = Date.now() - started;
      this.store.createTaskResult({
        evalRunId: input.evalRunId,
        evalTaskId: input.task.id,
        status: "error",
        score: 0,
        metrics: [],
        error: { message: error instanceof Error ? error.message : String(error) },
        startedAt,
        completedAt: new Date().toISOString()
      });
      input.emit("eval.task.failed", { evalTaskId: input.task.id, error: error instanceof Error ? error.message : String(error) });
      return { status: "error", score: 0, metrics: [], durationMs, cost: 0 };
    } finally {
      if (previousProvider === null || previousProvider === undefined) {
        this.database.deleteSetting("model.provider");
      } else {
        this.database.setSetting("model.provider", previousProvider);
      }
    }
  }

  private createRuntime(workspacePath: string): AgentRuntime {
    const toolRegistry = new ToolRegistry();
    registerWorkspaceTools(toolRegistry);
    registerTerminalTools(toolRegistry);
    registerTestTools(toolRegistry);
    const connectors = new ConnectorRegistry(this.database);
    installDeveloperWorkflowConnectors(connectors);
    registerConnectorTools(toolRegistry, connectors);
    return new AgentRuntime({ database: this.database, workspacePath, toolRegistry });
  }

  private createSkillService(): SkillService {
    const service = new SkillService(this.database, this.options.skillsRoot ? { skillsRoot: this.options.skillsRoot } : {});
    installDeveloperWorkflowSkills(service);
    return service;
  }

  private resolveSkillId(service: SkillService, skillId?: string): string {
    if (!skillId) {
      throw new Error("Evaluation run requires --skill or --variant.");
    }
    if (service.getSkill(skillId)) {
      return skillId;
    }
    const normalized = skillId.startsWith("skill_") ? skillId : `skill_${skillId.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase()}`;
    if (service.getSkill(normalized)) {
      return normalized;
    }
    throw new Error(`Skill not found: ${skillId}`);
  }

  private requireVariant(variantId: string): SkillVariantRecord {
    const variant = this.variants.getVariant(variantId);
    if (!variant) {
      throw new Error(`Variant not found: ${variantId}`);
    }
    return variant;
  }

  private persistMemory(evalRun: EvalRunRecord): void {
    try {
      const memory = new MemoryGraphStore(this.database);
      memory.createNode({
        type: evalRun.metrics && evalRun.metrics.compositeScore >= 0.75 ? "decision" : "risk",
        title: `Evaluation result: ${evalRun.targetId}`,
        body: `Dataset ${evalRun.datasetId} scored ${evalRun.metrics?.compositeScore ?? 0}.`,
        confidence: 0.85,
        importance: 0.7,
        sensitivity: "public"
      });
    } catch {
      // Evaluation persistence remains authoritative if graph insertion is rejected.
    }
  }
}

function resolveWorkspacePath(datasetSourcePath: string | null, task: EvalTaskRecord): string {
  if (!task.task.fixture.workspacePath) {
    throw new Error(`Eval task missing fixture workspace: ${task.id}`);
  }
  const root = datasetSourcePath ? (fs.statSync(datasetSourcePath).isDirectory() ? datasetSourcePath : path.dirname(datasetSourcePath)) : process.cwd();
  return path.resolve(root, task.task.fixture.workspacePath);
}

function extractTestExitCode(trace: { steps: Array<{ type: string; detail: Record<string, unknown> }> }): number | null {
  const test = [...trace.steps].reverse().find((step) => step.type === "test.run" || (step.type === "tool.result" && step.detail.toolName === "test.run"));
  const result = test?.detail.result ?? (test?.detail.output as Record<string, unknown> | undefined);
  return result && typeof result === "object" && "exitCode" in result ? Number((result as Record<string, unknown>).exitCode) : null;
}

function extractSandboxId(trace: { steps: Array<{ type: string; detail: Record<string, unknown> }> }): string | null {
  const step = trace.steps.find((item) => typeof item.detail.sandboxId === "string");
  return typeof step?.detail.sandboxId === "string" ? step.detail.sandboxId : null;
}

function readVariantImpact(variant: SkillVariantRecord | null): Record<string, number> | undefined {
  if (!variant) {
    return undefined;
  }
  const impact = variant.patch.expectedMetricImpact;
  if (impact && typeof impact === "object" && !Array.isArray(impact)) {
    return impact as Record<string, number>;
  }
  if (variant.mutationType === "additional_verification") {
    return { verificationCompleteness: 0.05, taskSuccessRate: 0.02 };
  }
  return undefined;
}
