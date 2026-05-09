import type { JsonObject, RiskLevel } from "./types.js";

export type ToolContext = {
  workspacePath: string;
  emitEvent?: (type: import("./types.js").AgentEvent["type"], data: JsonObject) => void;
  getSetting?: <T = unknown>(key: string) => T | null;
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
