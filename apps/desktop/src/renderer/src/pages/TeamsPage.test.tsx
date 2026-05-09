// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamDto, TeamRunDetailDto, TeamRunDto } from "../types";

const team: TeamDto = {
  id: "engineering-core-team",
  name: "Engineering Core Team",
  description: "Default team",
  status: "active",
  manifest: {
    id: "engineering-core-team",
    name: "Engineering Core Team",
    description: "Default team",
    roles: ["coordinator", "researcher", "implementer", "tester", "reviewer"],
    coordinatorRoleId: "coordinator",
    defaultPolicy: {}
  },
  createdAt: "2026-05-08T12:00:00.000Z",
  updatedAt: "2026-05-08T12:00:00.000Z",
  archivedAt: null
};

const run: TeamRunDto = {
  id: "team_run_test",
  teamId: team.id,
  parentRunId: null,
  task: "Fix calculator add function",
  status: "completed",
  coordinatorRoleId: "coordinator",
  startedAt: "2026-05-08T12:00:00.000Z",
  completedAt: "2026-05-08T12:00:01.000Z",
  createdAt: "2026-05-08T12:00:00.000Z",
  updatedAt: "2026-05-08T12:00:01.000Z",
  summary: "Completed",
  finalResult: null
};

const detail: TeamRunDetailDto = {
  run,
  subtasks: [
    {
      id: "subtask_research",
      teamRunId: run.id,
      parentSubtaskId: null,
      assignedRoleId: "researcher",
      title: "Inspect workspace evidence",
      description: "Read files",
      status: "completed",
      priority: 10,
      riskLevel: "low",
      requiredCapabilities: ["research"],
      requiredTools: ["workspace.readFile"],
      dependsOn: [],
      result: null,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt
    }
  ],
  blackboardEntries: [
    {
      id: "entry_evidence",
      teamRunId: run.id,
      subtaskId: "subtask_research",
      authorRoleId: "researcher",
      type: "evidence",
      title: "Workspace evidence",
      body: "add subtracts",
      data: {},
      confidence: 0.9,
      importance: 0.8,
      sensitivity: "public",
      sourceEventId: null,
      sourceRunId: null,
      sourceMemoryNodeId: null,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      deletedAt: null
    }
  ],
  messages: [],
  conflicts: [],
  handoffs: []
};

beforeEach(() => {
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: {
      listTeams: vi.fn(async () => [team]),
      listTeamRuns: vi.fn(async () => [run]),
      getTeamRun: vi.fn(async () => detail),
      listTeamHandoffs: vi.fn(async () => []),
      createTeam: vi.fn(async () => team),
      runTeamTask: vi.fn(async () => ({
        team,
        run,
        subtasks: detail.subtasks,
        blackboardEntries: detail.blackboardEntries,
        conflicts: [],
        handoffs: [],
        synthesis: {},
        traceId: "trace_team"
      })),
      answerTeamHandoff: vi.fn()
    }
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, "squidbot");
});

describe("TeamsPage", () => {
  it("renders teams, subtasks, and can start a team run", async () => {
    const { TeamsPage } = await import("./TeamsPage");
    render(<TeamsPage />);

    await waitFor(() => expect(screen.getAllByText("Engineering Core Team").length).toBeGreaterThan(0));
    expect(screen.getByText("Inspect workspace evidence")).toBeTruthy();
    expect(screen.getByText("Workspace evidence")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Run Team Task/i }));
    await waitFor(() => expect(window.squidbot.runTeamTask).toHaveBeenCalledWith(expect.objectContaining({ teamId: team.id })));
  });
});
