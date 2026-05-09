import { describe, expect, it } from "vitest";
import { TaskBroker, defaultTeamManifest } from "../src/index.js";

describe("TaskBroker", () => {
  it("decomposes coding tasks into scoped role subtasks with dependencies", () => {
    const broker = new TaskBroker();
    const subtasks = broker.decompose({
      teamRunId: "team_run_test",
      task: "Fix calculator add function and verify tests",
      team: defaultTeamManifest
    });
    expect(subtasks.map((subtask) => subtask.assignedRoleId)).toEqual(["researcher", "implementer", "tester", "reviewer"]);
    expect(subtasks[1].dependsOn).toEqual([subtasks[0].id]);
    expect(subtasks[2].riskLevel).toBe("medium");
  });

  it("routes developer workflow tasks through release coordination", () => {
    const broker = new TaskBroker();
    const subtasks = broker.decompose({
      teamRunId: "team_run_test",
      task: "Fix bug and open a GitHub pull request linked to Jira",
      team: defaultTeamManifest
    });
    expect(subtasks.map((subtask) => subtask.assignedRoleId)).toContain("releaseCoordinator");
    expect(subtasks.find((subtask) => subtask.assignedRoleId === "releaseCoordinator")?.riskLevel).toBe("high");
  });
});
