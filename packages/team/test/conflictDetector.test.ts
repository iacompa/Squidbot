import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRoots, tempDb } from "./helpers.js";
import { ConflictDetector, RoleRegistry, TeamStore, defaultTeamManifest } from "../src/index.js";

afterEach(cleanupTempRoots);

describe("ConflictDetector", () => {
  it("detects overlapping patch conflicts and writes blackboard conflict entries", () => {
    const db = tempDb();
    new RoleRegistry(db).installDefaults();
    const store = new TeamStore(db);
    const team = store.createTeam(defaultTeamManifest);
    const run = store.createTeamRun({ teamId: team.id, task: "Conflict test" });
    store.createBlackboardEntry({
      teamRunId: run.id,
      authorRoleId: "implementer",
      type: "patch",
      title: "Patch A",
      body: "--- a/calculator.py\n+++ b/calculator.py\n@@\n-return a - b\n+return a + b\n"
    });
    store.createBlackboardEntry({
      teamRunId: run.id,
      authorRoleId: "reviewer",
      type: "patch",
      title: "Patch B",
      body: "--- a/calculator.py\n+++ b/calculator.py\n@@\n-return a - b\n+return b + a\n"
    });

    const conflicts = new ConflictDetector(db).detect(run.id);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].type).toBe("patchConflict");
    expect(store.listBlackboardEntries({ teamRunId: run.id, type: "conflict" })).toHaveLength(1);
    db.close();
  });

  it("detects decision conflicts", () => {
    const db = tempDb();
    new RoleRegistry(db).installDefaults();
    const store = new TeamStore(db);
    const team = store.createTeam(defaultTeamManifest);
    const run = store.createTeamRun({ teamId: team.id, task: "Decision conflict" });
    store.createBlackboardEntry({ teamRunId: run.id, authorRoleId: "implementer", type: "decision", title: "Ready", body: "ready to promote" });
    store.createBlackboardEntry({ teamRunId: run.id, authorRoleId: "reviewer", type: "decision", title: "Reject", body: "reject patch because tests failed" });
    expect(new ConflictDetector(db).detect(run.id)[0].type).toBe("decisionConflict");
    db.close();
  });
});
