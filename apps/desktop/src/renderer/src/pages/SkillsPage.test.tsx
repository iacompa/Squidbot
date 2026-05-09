// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const skill = {
  id: "skill_list_files",
  name: "List files",
  currentVersion: "0.1.0",
  status: "draft" as const,
  createdAt: "2026-05-02T12:00:00.000Z",
  updatedAt: "2026-05-02T12:00:00.000Z",
  archivedAt: null
};

const version = {
  id: "skill_version_skill_list_files_0_1_0",
  skillId: "skill_list_files",
  version: "0.1.0",
  status: "draft" as const,
  manifest: {
    id: "skill_list_files",
    name: "List files",
    version: "0.1.0",
    description: "Lists files in a workspace.",
    requiredTools: ["workspace.listFiles"],
    prompts: { planningPrompt: "List files safely." },
    testFixtures: [{ id: "fixture_list", name: "Fixture", task: "list files" }],
    permissions: { "workspace.listFiles": { riskLevel: "low" } },
    createdAt: "2026-05-02T12:00:00.000Z",
    updatedAt: "2026-05-02T12:00:00.000Z",
    author: "test"
  },
  prompts: { planningPrompt: "List files safely." },
  testFixtures: [{ id: "fixture_list", name: "Fixture", task: "list files" }],
  packagePath: "/tmp/skill",
  evaluation: null,
  createdAt: "2026-05-02T12:00:00.000Z",
  updatedAt: "2026-05-02T12:00:00.000Z",
  promotedAt: null,
  archivedAt: null
};

beforeEach(() => {
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: {
      listSkills: vi.fn(async () => [skill]),
      getSkill: vi.fn(async () => ({ skill, version, versions: [version], evaluations: [] })),
      evaluateSkill: vi.fn(async () => ({
        id: "skill_eval_test",
        skillId: "skill_list_files",
        version: "0.1.0",
        pass: true,
        createdAt: "2026-05-02T12:01:00.000Z",
        metrics: {
          fixtureCount: 1,
          passedFixtures: 1,
          successRate: 1,
          medianRuntimeMs: 10,
          toolCount: 1,
          cost: 0
        },
        fixtures: []
      })),
      promoteSkill: vi.fn(),
      rollbackSkill: vi.fn(),
      deleteSkill: vi.fn(),
      runSkill: vi.fn()
    }
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, "squidbot");
});

describe("SkillsPage", () => {
  it("lists skills and renders manifest details", async () => {
    const { SkillsPage } = await import("./SkillsPage");
    render(<SkillsPage />);

    await waitFor(() => expect(screen.getByText("List files")).toBeTruthy());
    expect(screen.getAllByText((_content, element) => Boolean(element?.textContent?.includes("workspace.listFiles"))).length).toBeGreaterThan(0);
    expect(screen.getByText("Evaluate")).toBeTruthy();
    expect(screen.getByText("Run Test")).toBeTruthy();
  });
});
