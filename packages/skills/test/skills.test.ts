import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildTrace, type AgentEvent } from "@squidbot/core";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import { evaluateSkill, installDeveloperWorkflowSkills, SkillService, validateSkillManifest, type SkillManifest } from "../src/index.js";

let database: SquidDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function tempDb(): SquidDatabase {
  const db = initializeDatabase(path.join(tempDir("squidbot-skills-db-"), "squidbot.sqlite"));
  database = db;
  return db;
}

function validManifest(overrides: Partial<SkillManifest> = {}): SkillManifest {
  const now = "2026-05-02T12:00:00.000Z";
  return {
    id: "skill_list_files",
    name: "List files",
    version: "0.1.0",
    description: "Lists workspace files.",
    requiredTools: ["workspace.listFiles"],
    prompts: {
      planningPrompt: "List files safely."
    },
    testFixtures: [
      {
        id: "fixture_list",
        name: "Empty repo",
        task: "list files"
      }
    ],
    permissions: {
      "workspace.listFiles": {
        riskLevel: "low"
      }
    },
    createdAt: now,
    updatedAt: now,
    author: "test",
    ...overrides
  };
}

function fixtureRepo(): string {
  const repo = tempDir("squidbot-skill-repo-");
  fs.writeFileSync(path.join(repo, "README.md"), "# Fixture\n", "utf8");
  return repo;
}

describe("Skill manifests", () => {
  it("validates required fields and semantic versions", () => {
    expect(validateSkillManifest(validManifest()).id).toBe("skill_list_files");
    expect(() => validateSkillManifest({ ...validManifest(), version: "v1" })).toThrow(/semantic version/);
    expect(() => validateSkillManifest({ ...validManifest(), name: "" })).toThrow(/manifest.name/);
  });
});

describe("SkillService", () => {
  it("stores versions, evaluates, promotes, and rolls back skills", async () => {
    const db = tempDb();
    const service = new SkillService(db, { skillsRoot: tempDir("squidbot-skills-root-") });
    const first = service.saveVersion(
      validManifest({
        testFixtures: [
          {
            id: "fixture_list",
            name: "Simple repo",
            task: "list files",
            repoPath: fixtureRepo()
          }
        ]
      })
    );

    expect(first.status).toBe("draft");
    expect(service.listSkills()).toHaveLength(1);

    const evaluation = await evaluateSkill(db, "skill_list_files", { version: "0.1.0" });
    expect(evaluation.pass).toBe(true);
    expect(evaluation.metrics.successRate).toBe(1);

    const promoted = service.promote("skill_list_files", "0.1.0", { evaluation });
    expect(promoted.status).toBe("approved");

    const secondManifest = validManifest({
      version: "0.2.0",
      description: "Lists workspace files with a newer prompt.",
      prompts: { planningPrompt: "List files and summarize them." }
    });
    service.saveVersion(secondManifest);
    service.rollback("skill_list_files", "0.1.0");

    expect(service.getSkill("skill_list_files")?.currentVersion).toBe("0.1.0");
    expect(service.compare("skill_list_files", "0.1.0", "0.2.0").changes).toHaveProperty("description");
  });

  it("captures a run as a draft skill package", () => {
    const db = tempDb();
    const workspace = tempDir("squidbot-skill-workspace-");
    fs.writeFileSync(path.join(workspace, "README.md"), "# Fixture\n", "utf8");
    const events: AgentEvent[] = [
      {
        id: "evt_session",
        timestamp: "2026-05-02T12:00:00.000Z",
        sessionId: "session_capture",
        runId: "run_capture",
        type: "session.started",
        data: { workspacePath: workspace }
      },
      {
        id: "evt_task",
        timestamp: "2026-05-02T12:00:00.010Z",
        sessionId: "session_capture",
        runId: "run_capture",
        type: "user.task",
        data: { task: "list files", testCommand: null }
      },
      {
        id: "evt_plan",
        timestamp: "2026-05-02T12:00:00.020Z",
        sessionId: "session_capture",
        runId: "run_capture",
        type: "plan.generated",
        data: {
          provider: "mock",
          plan: {
            actions: [{ id: "action_list", toolName: "workspace.listFiles", args: {} }]
          }
        }
      },
      {
        id: "evt_tool",
        timestamp: "2026-05-02T12:00:00.030Z",
        sessionId: "session_capture",
        runId: "run_capture",
        type: "tool.call",
        data: { toolName: "workspace.listFiles", args: {} }
      }
    ];
    const trace = buildTrace(events);
    db.saveTrace({ id: trace.id, sessionId: trace.sessionId, events: trace, createdAt: trace.createdAt });
    const service = new SkillService(db, { skillsRoot: tempDir("squidbot-skills-root-") });
    const created = service.createFromRun({
      runId: "run_capture",
      name: "List Files Capture",
      description: "Captured list files workflow."
    });

    expect(created.skill.status).toBe("draft");
    expect(created.version.manifest.requiredTools).toContain("workspace.listFiles");
    expect(created.version.packagePath && fs.existsSync(path.join(created.version.packagePath, "manifest.json"))).toBe(true);
  });

  it("bumps versions into their own package directory", () => {
    const db = tempDb();
    const skillsRoot = tempDir("squidbot-skills-root-");
    const service = new SkillService(db, { skillsRoot });
    const firstPackagePath = path.join(skillsRoot, "skill_list_files", "0.1.0");
    const firstManifest = validManifest({
      testFixtures: [
        {
          id: "fixture_list",
          name: "Simple repo",
          task: "list files",
          repoPath: path.join(firstPackagePath, "tests", "fixture_list", "repo")
        }
      ]
    });

    service.saveVersion(firstManifest, { packagePath: firstPackagePath });
    fs.mkdirSync(path.join(firstPackagePath, "tests", "fixture_list", "repo"), { recursive: true });
    fs.writeFileSync(path.join(firstPackagePath, "tests", "fixture_list", "repo", "README.md"), "# Fixture\n", "utf8");

    const bumped = service.bumpVersion("skill_list_files");

    expect(bumped.version).toBe("0.2.0");
    expect(bumped.packagePath).toBe(path.join(skillsRoot, "skill_list_files", "0.2.0"));
    expect(bumped.manifest.testFixtures[0]?.repoPath).toBe(path.join(skillsRoot, "skill_list_files", "0.2.0", "tests", "fixture_list", "repo"));
    expect(fs.existsSync(path.join(bumped.packagePath ?? "", "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(bumped.packagePath ?? "", "tests", "fixture_list", "repo", "README.md"))).toBe(true);
  });

  it("installs developer workflow skill templates without overwriting existing records", () => {
    const db = tempDb();
    const service = new SkillService(db, { skillsRoot: tempDir("squidbot-skills-root-") });
    const installed = installDeveloperWorkflowSkills(service);
    const secondPass = installDeveloperWorkflowSkills(service);

    expect(installed.map((manifest) => manifest.id).sort()).toEqual([
      "skill_auto_fix_and_pr",
      "skill_ci_failure_diagnosis",
      "skill_issue_triage",
      "skill_pull_request_reviewer",
      "skill_release_notes"
    ]);
    expect(secondPass).toEqual([]);
    expect(service.getVersion("skill_issue_triage", "0.1.0")?.manifest.requiredTools).toContain("connector.github.listIssues");
    expect(service.getVersion("skill_auto_fix_and_pr", "0.1.0")?.manifest.requiredTools).toContain("connector.github.openDraftPullRequest");
  });
});
