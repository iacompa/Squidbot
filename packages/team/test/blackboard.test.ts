import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRoots, tempDb } from "./helpers.js";
import { BlackboardStore, RoleRegistry, TeamStore, defaultTeamManifest } from "../src/index.js";

afterEach(cleanupTempRoots);

describe("BlackboardStore", () => {
  it("creates, filters, searches, updates, and soft-deletes entries", () => {
    const db = tempDb();
    new RoleRegistry(db).installDefaults();
    const store = new TeamStore(db);
    const team = store.createTeam(defaultTeamManifest);
    const run = store.createTeamRun({ teamId: team.id, task: "Inspect repo" });
    const blackboard = new BlackboardStore(db);
    const entry = blackboard.createEntry({
      teamRunId: run.id,
      authorRoleId: "researcher",
      type: "evidence",
      title: "Calculator evidence",
      body: "add subtracts",
      sensitivity: "restricted"
    });
    expect(blackboard.listByType(run.id, "evidence")).toHaveLength(1);
    expect(blackboard.search(run.id, "subtracts")[0].id).toBe(entry.id);
    expect(blackboard.updateEntry(entry.id, { body: "add subtracts instead of adding" }).body).toContain("adding");
    expect(blackboard.deleteEntry(entry.id).deletedAt).toBeTruthy();
    expect(blackboard.listByTeamRun(run.id)).toHaveLength(0);
    db.close();
  });
});
