# MCP Server Mode — Design

**Date:** 2026-05-29
**Status:** Approved to build (user pre-authorized "features" under the active goal; designed per superpowers:brainstorming discipline without per-step approval gate).
**Capability:** N2 in the competitive matrix. Both OpenClaw and Hermes expose themselves as MCP servers; SquidBot only had an MCP *client*. Roadmap Phase 4 ("expose SquidBot as an MCP server so Claude Desktop / any MCP client can call SquidBot's tools; every call is governed and audited").

## Goal

Let any MCP client (Claude Desktop, Cursor, another SquidBot) call SquidBot's registered tools over stdio — **governed by the same PolicyEngine the runtime uses, and audited via the event log.** This is the interop + Claude-can-drive-SquidBot unlock.

## Non-goals (YAGNI)

- No HTTP/SSE/remote MCP transport — **stdio only** (the standard local-client transport; remote can come later behind the same class).
- No exposing blueprints/skills as distinct MCP tools yet — **the tool registry only** (which already includes connector tools).
- No full ABAC `GovernanceEnforcer` wiring in v1 — the synchronous `PolicyEngine.evaluateTool` gate (same risk gating the runtime applies) is the v1 guard. Full enforcer wiring is a follow-up.
- No new auth layer — stdio implies a local, operator-launched process (same trust model as the rest of the CLI).

## Architecture

Lives in `packages/connectors` (next to the MCP **client**; `connectors → core` is the allowed dependency direction, and the MCP SDK is already a connectors dep).

### Unit 1 — `SquidbotMcpServer` (`packages/connectors/src/mcpServer.ts`)

Wraps a `ToolRegistry` and exposes it over MCP, with governance + audit.

- `constructor(toolRegistry, options: { policyEngine?, eventLog?, database?, workspacePath, sessionId? })`
- `listTools(): Array<{ name, description, inputSchema }>` — maps `registry.list()` to MCP tool defs.
- `async callTool(name, args): Promise<{ content: [...], isError?: boolean }>`:
  1. Unknown tool → MCP error result.
  2. `policyEngine.evaluateTool(tool, args)` denies → emit `tool.denied`, return MCP error ("Blocked by policy: …"). **Risky/write tools are denied to external callers by default — same as the runtime.**
  3. Allowed → emit `tool.call`, `registry.execute(name, args, context)`, emit `tool.result`, return the output as MCP text content. Tool throw → `error` event + MCP error result (never throws to the transport).
- `async serveStdio(): Promise<void>` — create SDK `Server`, register `tools/list`→`listTools()` and `tools/call`→`callTool()` handlers, connect a `StdioServerTransport`.

`listTools()`/`callTool()` are public and pure-of-transport so they're unit-testable directly; `serveStdio()` is the thin SDK wiring.

### Unit 2 — CLI `mcp serve` command (`apps/cli/src/index.ts`)

`npm run mcp -- serve [--workspace <path>]` builds a registry (workspace + terminal + test + connector tools), a `PolicyEngine`, and an `EventLog`, constructs `SquidbotMcpServer`, and runs `serveStdio()`. This is what a user points Claude Desktop at.

## Data flow

MCP client → stdio → SDK Server → `callTool` → PolicyEngine gate → ToolRegistry.execute → EventLog (audit) → result → stdio → client.

## Error handling

- Unknown tool / policy deny / tool throw → structured MCP `isError` result with a message; the transport never sees an exception.
- Governance/policy denial is the primary guard against an MCP client invoking high-risk tools.

## Testing

`packages/connectors/test/mcpServer.test.ts`:
1. `listTools()` returns the registered tools' name + inputSchema.
2. `callTool()` on a safe read tool returns its output and emits `tool.call`+`tool.result`.
3. `callTool()` on a policy-denied (high-risk) tool returns an `isError` result and does NOT execute.
4. `callTool()` on an unknown tool returns an `isError` result.

`serveStdio` is covered by typecheck + manual (`npm run mcp -- serve`).
