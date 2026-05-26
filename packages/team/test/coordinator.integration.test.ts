import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRoots, buggyPythonWorkspace, tempDb } from "./helpers.js";
import { TeamCoordinator } from "../src/index.js";

afterEach(cleanupTempRoots);

describe("TeamCoordinator integration", () => {
  it("runs an end-to-end coding team task with sandbox verification and no real workspace write", async () => {
    const db = tempDb();
    const workspace = buggyPythonWorkspace();
    const coordinator = new TeamCoordinator(db);
    const team = coordinator.ensureDefaultSetup();
    const result = await coordinator.runTeamTask({
      teamId: team.id,
      workspacePath: workspace,
      task: "Fix calculator add function, explain the root cause, and verify tests"
    });

    expect(result.run.status).toBe("completed");
    expect(result.subtasks.map((subtask) => subtask.assignedRoleId)).toEqual(["researcher", "implementer", "tester", "reviewer"]);
    expect(result.blackboardEntries.some((entry) => entry.type === "patch")).toBe(true);
    expect(result.blackboardEntries.some((entry) => entry.type === "testResult" && /passed/i.test(entry.body))).toBe(true);
    expect(fs.readFileSync(path.join(workspace, "calculator.py"), "utf8")).toContain("return a - b");
    const trace = db.getTraceByRunId(result.run.id);
    expect(trace).toBeTruthy();
    expect(JSON.stringify(trace)).toContain("team.run.started");
    expect(JSON.stringify(trace)).toContain("sandbox.created");
    db.close();
  });

  it("stops executing subtasks when cancelTeamRun is called mid-flight", async () => {
    const db = tempDb();
    const workspace = buggyPythonWorkspace();
    const coordinator = new TeamCoordinator(db);
    const team = coordinator.ensureDefaultSetup();

    // Start the run, then cancel it immediately. Because the cancel hits before
    // executeSubtask completes (or right after the first one), the rest of the
    // queue should not run.
    const runPromise = coordinator.runTeamTask({
      teamId: team.id,
      workspacePath: workspace,
      task: "Fix calculator add function"
    });

    // Find the run id we just created and cancel it.
    // We can't directly hook into the loop, so we rely on the fact that the
    // first subtask is short-lived: schedule a cancel via setImmediate.
    await new Promise((resolve) => setImmediate(resolve));
    const recentRun = coordinator.listTeamRuns(team.id, 1)[0];
    if (recentRun) {
      coordinator.cancelTeamRun(recentRun.id);
    }

    const result = await runPromise;
    // At least one subtask was canceled OR the synthesis was skipped.
    const wasInterrupted =
      result.synthesis === null ||
      result.subtasks.some((subtask) => subtask.status === "canceled");
    expect(wasInterrupted).toBe(true);

    db.close();
  });

  it("creates handoffs for approval-gated connector writes", async () => {
    const db = tempDb();
    const workspace = buggyPythonWorkspace();
    const coordinator = new TeamCoordinator(db);
    const team = coordinator.ensureDefaultSetup();
    const result = await coordinator.runTeamTask({
      teamId: team.id,
      workspacePath: workspace,
      task: "Fix calculator add function and open a GitHub pull request"
    });
    expect(result.handoffs.length).toBeGreaterThan(0);
    expect(result.blackboardEntries.some((entry) => entry.type === "handoff")).toBe(true);
    db.close();
  });
});
