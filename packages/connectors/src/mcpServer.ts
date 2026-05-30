import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  createId,
  EventLog,
  PolicyEngine,
  ToolRegistry,
  validateToolArgs,
  type AgentEvent,
  type JsonObject,
  type ToolContext
} from "@squidbot/core";
import type { SquidDatabase } from "@squidbot/db";

/**
 * MCP SERVER MODE — exposes SquidBot's tool registry over the Model Context
 * Protocol so any MCP client (Claude Desktop, Cursor, another SquidBot) can
 * call SquidBot's tools. Every call is gated by the same `PolicyEngine` the
 * agent runtime uses and audited to the event log — SquidBot does not become
 * an ungoverned tool gateway just because the caller is external.
 *
 * `listTools`/`callTool` are transport-free (unit-testable directly);
 * `serveStdio` is the thin SDK wiring a real client connects to.
 */

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpCallResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type SquidbotMcpServerOptions = {
  policyEngine?: PolicyEngine;
  eventLog?: EventLog;
  database?: SquidDatabase;
  workspacePath: string;
  sessionId?: string;
};

export class SquidbotMcpServer {
  private readonly registry: ToolRegistry;
  private readonly policyEngine: PolicyEngine;
  private readonly eventLog?: EventLog;
  private readonly database?: SquidDatabase;
  private readonly workspacePath: string;
  private readonly sessionId: string;

  constructor(registry: ToolRegistry, options: SquidbotMcpServerOptions) {
    this.registry = registry;
    this.policyEngine = options.policyEngine ?? new PolicyEngine();
    this.eventLog = options.eventLog;
    this.database = options.database;
    this.workspacePath = options.workspacePath;
    this.sessionId = options.sessionId ?? createId("mcp_session");
  }

  listTools(): McpToolDefinition[] {
    return this.registry.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: (tool.inputSchema as Record<string, unknown>) ?? { type: "object" }
    }));
  }

  async callTool(name: string, args: JsonObject): Promise<McpCallResult> {
    const runId = createId("mcp_run");
    const tool = this.registry.get(name);
    if (!tool) {
      return errorResult(`Unknown tool: ${name}`);
    }

    // Validate the external client's args against the tool's inputSchema before
    // anything else. MCP input is untrusted (it crosses a process/trust
    // boundary), so a malformed call must be rejected at the edge rather than
    // silently coerced by the handler. Same permissive validator the agent
    // runtime uses.
    const argCheck = validateToolArgs(tool.inputSchema, args);
    if (!argCheck.ok) {
      const reason = `Invalid arguments for ${name}: ${argCheck.errors.join("; ")}`;
      this.emit(runId, "tool.denied", { toolName: name, reason, via: "mcp" });
      return errorResult(reason);
    }

    // Same governance gate the agent runtime applies — risky/write tools are
    // denied to external MCP callers by default.
    const decision = this.policyEngine.evaluateTool(tool, args);
    if (!decision.allowed) {
      this.emit(runId, "tool.denied", { toolName: name, reason: decision.reason, riskLevel: decision.riskLevel, via: "mcp" });
      return errorResult(`Blocked by policy: ${decision.reason}`);
    }

    this.emit(runId, "tool.call", { toolName: name, args, via: "mcp" });
    try {
      const output = await this.registry.execute(name, args, this.toolContext(runId));
      this.emit(runId, "tool.result", { toolName: name, output, via: "mcp" });
      return {
        content: [{ type: "text", text: typeof output === "string" ? output : JSON.stringify(output) }]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit(runId, "error", { toolName: name, message, via: "mcp" });
      return errorResult(`Tool failed: ${message}`);
    }
  }

  /** Wire the SDK server to a stdio transport. This is what a client connects to. */
  async serveStdio(): Promise<void> {
    const server = new Server({ name: "squidbot", version: "0.1.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: this.listTools() }));
    server.setRequestHandler(CallToolRequestSchema, async (request) =>
      this.callTool(request.params.name, (request.params.arguments as JsonObject) ?? {})
    );
    await server.connect(new StdioServerTransport());
  }

  private toolContext(runId: string): ToolContext {
    return {
      workspacePath: this.workspacePath,
      emitEvent: (type, data) => this.emit(runId, type, data),
      getSetting: this.database ? <T = unknown>(key: string) => this.database!.getSetting<T>(key) : undefined,
      database: this.database,
      sessionId: this.sessionId,
      runId
    };
  }

  private emit(runId: string, type: AgentEvent["type"], data: JsonObject): void {
    if (!this.eventLog) return;
    this.eventLog.append({
      id: createId("evt"),
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      runId,
      type,
      data
    });
  }
}

function errorResult(message: string): McpCallResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
