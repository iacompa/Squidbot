import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import { GovernanceEnforcer, GovernancePolicyEngine } from "@squidbot/governance";
import { AgentRuntime } from "../src/index.js";

let database: SquidDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

function createWorkspace(): { dbPath: string; workspacePath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-governance-"));
  const workspacePath = path.join(dir, "workspace");
  fs.mkdirSync(workspacePath);
  fs.writeFileSync(path.join(workspacePath, "README.md"), "# Fixture\n", "utf8");
  return {
    dbPath: path.join(dir, "squidbot.sqlite"),
    workspacePath
  };
}

describe("AgentRuntime governance enforcement", () => {
  it("blocks a tool call when the enforcer denies it", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);

    const enforcer: Pick<GovernanceEnforcer, "assertAllowed" | "decide"> = {
      assertAllowed: vi.fn(() => {
        throw new Error("Governance denied invoke: policy");
      }),
      decide: vi.fn()
    };

    const runtime = new AgentRuntime({
      database,
      workspacePath: fixture.workspacePath,
      governanceEnforcer: enforcer as GovernanceEnforcer
    });

    const result = await runtime.sendMessage("please list files");

    // Mock provider auto-calls workspace.listFiles. With deny, the tool
    // result records the block but runtime does NOT throw to the caller.
    expect(result.toolResults.length).toBeGreaterThanOrEqual(1);
    const blocked = result.toolResults.find((r) => !r.ok);
    expect(blocked).toBeDefined();
    expect(JSON.stringify(blocked?.output)).toMatch(/policy|governance/i);
    expect(enforcer.assertAllowed).toHaveBeenCalled();
  });

  it("does not block tool calls when no enforcer is supplied (default behavior preserved)", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);

    const runtime = new AgentRuntime({ database, workspacePath: fixture.workspacePath });
    const result = await runtime.sendMessage("please list files");

    expect(result.toolResults[0].ok).toBe(true);
  });

  it("allows tool calls when the enforcer permits them", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);

    const enforcer: Pick<GovernanceEnforcer, "assertAllowed" | "decide"> = {
      assertAllowed: vi.fn(() => ({
        tenantId: "test",
        decision: "allow" as const,
        reason: "ok",
        matchedPolicies: [],
        obligations: []
      })),
      decide: vi.fn()
    };

    const runtime = new AgentRuntime({
      database,
      workspacePath: fixture.workspacePath,
      governanceEnforcer: enforcer as GovernanceEnforcer
    });
    const result = await runtime.sendMessage("please list files");

    expect(enforcer.assertAllowed).toHaveBeenCalled();
    expect(result.toolResults[0].ok).toBe(true);
  });

  it("runs tools end-to-end with the REAL GovernancePolicyEngine (production desktop wiring)", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);

    // Exactly how apps/desktop/src/main/ipc.ts builds the enforcer for the
    // AgentRuntime. The prior tests injected a MOCK enforcer, which is why the
    // P0 (real engine denies the system runtime actor → every tool blocked in
    // the desktop) was never caught. This exercises the real production path.
    const enforcer = new GovernanceEnforcer(new GovernancePolicyEngine(database));

    const runtime = new AgentRuntime({
      database,
      workspacePath: fixture.workspacePath,
      governanceEnforcer: enforcer
    });
    const result = await runtime.sendMessage("please list files");

    expect(result.toolResults.length).toBeGreaterThanOrEqual(1);
    expect(result.toolResults[0].ok).toBe(true);
  });
});
