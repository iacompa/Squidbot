import { McpClientManager } from "@squidbot/connectors";
import type { ToolRegistry } from "@squidbot/core";

type ServerConfig = Parameters<McpClientManager["spawnAll"]>[0][number];

let current: McpClientManager | null = null;

/**
 * Replace the active MCP manager. The previous manager is shut down so its
 * subprocesses don't leak. Designed for the call pattern in createRuntime,
 * where every chat message builds a fresh ToolRegistry — this keeps exactly
 * one generation of MCP subprocess trees alive at a time.
 *
 * Shutdown of the previous generation runs in parallel with the new spawn,
 * and its errors are swallowed: a slow or broken old manager must never
 * block or fail the new runtime.
 */
export async function replaceMcpManager(
  registry: ToolRegistry,
  servers: readonly ServerConfig[]
): Promise<McpClientManager> {
  const previous = current;
  const next = new McpClientManager(registry);
  current = next;
  await Promise.all([
    next.spawnAll(servers),
    previous ? previous.shutdown().catch(() => undefined) : Promise.resolve()
  ]);
  return next;
}

export async function shutdownMcpPool(): Promise<void> {
  const previous = current;
  current = null;
  if (previous) await previous.shutdown().catch(() => undefined);
}

export function __resetMcpPoolForTests(): void {
  current = null;
}
