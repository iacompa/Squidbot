import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export type McpClientConfig = {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
};

export type McpToolDescriptor = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

/**
 * A single connection to an MCP server. Wraps the SDK's stdio transport
 * with a small surface tuned for our needs: connect → list tools → call
 * tool → close. The lifecycle is owned by McpClientManager (the pool);
 * this class doesn't restart itself.
 */
export class McpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private cachedTools: McpToolDescriptor[] = [];

  constructor(private readonly config: McpClientConfig) {}

  async connect(): Promise<void> {
    if (this.client) return;
    this.transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args,
      env: { ...process.env, ...this.config.env } as Record<string, string>
    });
    this.client = new Client(
      { name: `squidbot-mcp-${this.config.name}`, version: "0.1.0" },
      { capabilities: {} }
    );
    await this.client.connect(this.transport);
    const list = await this.client.listTools();
    this.cachedTools = list.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: (tool.inputSchema as Record<string, unknown>) ?? { type: "object" }
    }));
  }

  tools(): McpToolDescriptor[] {
    return [...this.cachedTools];
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) {
      throw new Error(`McpClient for ${this.config.name} is not connected`);
    }
    return this.client.callTool({ name: toolName, arguments: args });
  }

  async close(): Promise<void> {
    try {
      await this.client?.close();
    } finally {
      this.client = null;
      this.transport = null;
      this.cachedTools = [];
    }
  }

  get name(): string {
    return this.config.name;
  }
}
