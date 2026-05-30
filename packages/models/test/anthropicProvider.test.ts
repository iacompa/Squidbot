import { describe, expect, it, vi } from "vitest";
import { AnthropicModelProvider } from "../src/anthropicProvider.js";
import type { ModelProviderRequest } from "../src/base.js";

type AnthropicResponse = {
  content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
};

function withFetch(responseOverride?: AnthropicResponse): {
  provider: AnthropicModelProvider;
  request: () => { url: string; headers: Record<string, string>; body: Record<string, unknown> } | null;
  restore: () => void;
} {
  let captured: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | null = null;
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    captured = {
      url: String(url),
      headers: (init?.headers as Record<string, string>) ?? {},
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
    };
    const payload: AnthropicResponse = responseOverride ?? {
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 4, output_tokens: 1 },
      stop_reason: "end_turn"
    };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  return {
    provider: new AnthropicModelProvider({
      apiKey: "sk-ant-test",
      apiUrl: "https://api.anthropic.com/v1/messages",
      modelName: "claude-sonnet-4-6"
    }),
    request: () => captured,
    restore: () => {
      globalThis.fetch = original;
    }
  };
}

const baseRequest = (messages: ModelProviderRequest["messages"], tools: ModelProviderRequest["tools"] = []): ModelProviderRequest => ({
  sessionId: "s1",
  runId: "r1",
  messages,
  tools
});

describe("AnthropicModelProvider — native Messages API", () => {
  it("hoists system messages to the top-level `system` field and sends max_tokens + x-api-key", async () => {
    const { provider, request, restore } = withFetch();
    try {
      await provider.generate(
        baseRequest([
          { role: "system", content: "You are SquidBot." },
          { role: "user", content: "list files" }
        ])
      );
      const captured = request()!;
      expect(captured.url).toBe("https://api.anthropic.com/v1/messages");
      expect(captured.headers["x-api-key"]).toBe("sk-ant-test");
      expect(captured.headers["anthropic-version"]).toBeTruthy();
      // System is a top-level param, NOT a message (Anthropic has no system role).
      expect(captured.body.system).toBe("You are SquidBot.");
      expect(captured.body.max_tokens).toBeTypeOf("number");
      expect(captured.body.messages).toEqual([{ role: "user", content: "list files" }]);
    } finally {
      restore();
    }
  });

  it("maps tools to Anthropic's {name, description, input_schema} and sanitises dotted names", async () => {
    const { provider, request, restore } = withFetch();
    try {
      await provider.generate(
        baseRequest(
          [{ role: "user", content: "go" }],
          [{ name: "workspace.listFiles", description: "List files.", inputSchema: { type: "object" } }]
        )
      );
      const tools = request()!.body.tools as Array<{ name: string; description: string; input_schema: unknown }>;
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("workspace_listFiles"); // dots → underscores
      expect(tools[0].input_schema).toMatchObject({ type: "object" });
    } finally {
      restore();
    }
  });

  it("parses tool_use content blocks into toolCalls with the dotted name restored", async () => {
    const { provider, request, restore } = withFetch({
      content: [
        { type: "text", text: "Let me look." },
        { type: "tool_use", id: "tu_1", name: "workspace_listFiles", input: { path: "." } }
      ],
      usage: { input_tokens: 10, output_tokens: 6 }
    });
    try {
      const result = await provider.generate(
        baseRequest(
          [{ role: "user", content: "go" }],
          [{ name: "workspace.listFiles", description: "List files.", inputSchema: { type: "object" } }]
        )
      );
      expect(result.content).toBe("Let me look.");
      expect(result.toolCalls).toEqual([{ id: "tu_1", name: "workspace.listFiles", args: { path: "." } }]);
      expect(result.tokenUsage).toMatchObject({ promptTokens: 10, completionTokens: 6, totalTokens: 16 });
      // Ensure capture is referenced so lint sees `request` used.
      expect(request()).not.toBeNull();
    } finally {
      restore();
    }
  });

  it("serialises an assistant tool call as a tool_use block and a tool result as a user tool_result block", async () => {
    const { provider, request, restore } = withFetch();
    try {
      await provider.generate(
        baseRequest([
          { role: "user", content: "go" },
          { role: "assistant", content: "", toolCalls: [{ id: "tu_1", name: "workspace.listFiles", args: {} }] },
          { role: "tool", content: "README.md", toolCallId: "tu_1", name: "workspace.listFiles" }
        ])
      );
      const messages = request()!.body.messages as Array<{ role: string; content: unknown }>;
      // user, assistant(tool_use), user(tool_result)
      const assistant = messages.find((m) => m.role === "assistant")!;
      expect(JSON.stringify(assistant.content)).toContain("tool_use");
      expect(JSON.stringify(assistant.content)).toContain("workspace_listFiles");
      const toolResult = messages[messages.length - 1];
      expect(toolResult.role).toBe("user");
      expect(JSON.stringify(toolResult.content)).toContain("tool_result");
      expect(JSON.stringify(toolResult.content)).toContain("tu_1");
      expect(JSON.stringify(toolResult.content)).toContain("README.md");
    } finally {
      restore();
    }
  });

  it("is unavailable and refuses to generate without an API key", async () => {
    const provider = new AnthropicModelProvider({ apiUrl: "https://api.anthropic.com/v1/messages" });
    expect(await provider.isAvailable()).toBe(false);
    await expect(
      provider.generate(baseRequest([{ role: "user", content: "hi" }]))
    ).rejects.toThrow();
  });
});
