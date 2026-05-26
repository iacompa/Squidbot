import type { JsonObject, RiskLevel } from "./types.js";

export type ToolContext = {
  workspacePath: string;
  emitEvent?: (type: import("./types.js").AgentEvent["type"], data: JsonObject) => void;
  getSetting?: <T = unknown>(key: string) => T | null;
  /**
   * The active enterprise profile's sensitivity, supplied by the runtime so
   * connector tools can apply the sensitivity policy. When undefined, callers
   * should assume "standard" sensitivity.
   */
  getActiveProfileSensitivity?: () => "standard" | "sensitive" | "regulated" | "air-gapped";
  /**
   * SquidDatabase handle. Connector tools need this for queuing approvals
   * through approvalQueue.enqueueApproval. Optional because legacy tool
   * tests construct a ToolContext without it; the connector path defends
   * against the missing case.
   */
  database?: import("@squidbot/db").SquidDatabase;
  /**
   * Caller's session id. Used to associate queued approvals with the
   * session that triggered them so the runtime can match resolutions back
   * to the in-flight tool call.
   */
  sessionId?: string;
  /**
   * Caller's run id. Same role as sessionId — links a queued approval to
   * the specific run that produced it.
   */
  runId?: string;
};

export type ToolManifest = {
  name: string;
  description: string;
  inputSchema: JsonObject;
  permissionScopes: string[];
  riskLevel: RiskLevel;
  metadata?: JsonObject;
};

export type RegisteredTool = ToolManifest & {
  handler: (args: JsonObject, context: ToolContext) => Promise<unknown> | unknown;
};

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }

    this.tools.set(tool.name, tool);
  }

  get(name: string): RegisteredTool | null {
    return this.tools.get(name) ?? null;
  }

  list(): ToolManifest[] {
    return [...this.tools.values()].map(({ handler, ...manifest }) => manifest);
  }

  async execute(name: string, args: JsonObject, context: ToolContext): Promise<unknown> {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    return tool.handler(args, context);
  }
}
