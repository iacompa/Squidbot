import { describe, it, expect, vi, beforeEach } from "vitest";
import { replaceMcpManager, shutdownMcpPool, __resetMcpPoolForTests } from "./mcpPool.js";
import type { ToolRegistry } from "@squidbot/core";

const spawnAll = vi.fn().mockResolvedValue(undefined);
const shutdown = vi.fn().mockResolvedValue(undefined);

vi.mock("@squidbot/connectors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@squidbot/connectors")>();
  return {
    ...actual,
    McpClientManager: vi.fn().mockImplementation(() => ({ spawnAll, shutdown }))
  };
});

function fakeRegistry(): ToolRegistry {
  return { register: vi.fn(), get: vi.fn() } as unknown as ToolRegistry;
}

describe("mcpPool", () => {
  beforeEach(() => {
    __resetMcpPoolForTests();
    spawnAll.mockClear();
    shutdown.mockClear();
  });

  it("does not shut down anything on the first replace", async () => {
    await replaceMcpManager(fakeRegistry(), []);
    expect(shutdown).not.toHaveBeenCalled();
    expect(spawnAll).toHaveBeenCalledTimes(1);
  });

  it("shuts down the previous manager when replaceMcpManager is called again", async () => {
    await replaceMcpManager(fakeRegistry(), []);
    await replaceMcpManager(fakeRegistry(), []);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(spawnAll).toHaveBeenCalledTimes(2);
  });

  it("shutdownMcpPool tears down the active manager", async () => {
    await replaceMcpManager(fakeRegistry(), []);
    await shutdownMcpPool();
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("shutdownMcpPool is a no-op when no manager is active", async () => {
    await shutdownMcpPool();
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("survives previous-manager shutdown rejecting", async () => {
    await replaceMcpManager(fakeRegistry(), []);
    shutdown.mockRejectedValueOnce(new Error("boom"));
    await expect(replaceMcpManager(fakeRegistry(), [])).resolves.toBeDefined();
    expect(spawnAll).toHaveBeenCalledTimes(2);
  });
});
