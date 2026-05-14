import { describe, expect, it, vi } from "vitest";
import { ApiModelProvider } from "../src/apiProvider.js";

describe("ApiModelProvider — schema sanitiser for strict providers (Gemini, etc.)", () => {
  function captureRequestBody(): {
    provider: ApiModelProvider;
    body: () => Record<string, unknown> | null;
    restore: () => void;
  } {
    let captured: Record<string, unknown> | null = null;
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const payload = {
        choices: [{ message: { content: "ok", tool_calls: [] } }],
        usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 }
      };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    const provider = new ApiModelProvider({
      apiKey: "test-key",
      apiUrl: "https://strict-provider.example/api/v1/chat/completions",
      modelName: "test-model"
    });

    return {
      provider,
      body: () => captured,
      restore: () => {
        globalThis.fetch = original;
      }
    };
  }

  it("fills in missing `items` on array-typed schema properties before sending", async () => {
    const { provider, body, restore } = captureRequestBody();
    try {
      await provider.generate({
        sessionId: "s1",
        runId: "r1",
        messages: [{ role: "user", content: "ping" }],
        tools: [
          {
            name: "demo.actions",
            description: "Demo tool with a malformed array property.",
            inputSchema: {
              type: "object",
              properties: {
                // This is the exact shape Gemini was rejecting in the
                // SquidBot tool registry: an array without `items`.
                actions: { type: "array" }
              }
            },
            permissionScopes: [],
            riskLevel: "low"
          }
        ]
      });
    } finally {
      restore();
    }

    const sent = body();
    expect(sent).not.toBeNull();
    const tools = sent!.tools as Array<{
      function: { parameters: { properties: { actions: { items?: unknown } } } };
    }>;
    expect(tools[0].function.parameters.properties.actions.items).toEqual({ type: "string" });
  });

  it("collapses JSON-Schema-style `type: [..., 'null']` to a single string type", async () => {
    const { provider, body, restore } = captureRequestBody();
    try {
      await provider.generate({
        sessionId: "s2",
        runId: "r2",
        messages: [{ role: "user", content: "ping" }],
        tools: [
          {
            name: "demo.nullable",
            description: "Demo tool with a nullable string.",
            inputSchema: {
              type: "object",
              properties: { note: { type: ["string", "null"] } }
            },
            permissionScopes: [],
            riskLevel: "low"
          }
        ]
      });
    } finally {
      restore();
    }

    const sent = body();
    const tools = sent!.tools as Array<{
      function: { parameters: { properties: { note: { type: unknown } } } };
    }>;
    expect(tools[0].function.parameters.properties.note.type).toBe("string");
  });

  it("does not mutate the upstream tool object", async () => {
    const { provider, restore } = captureRequestBody();
    const sharedTool = {
      name: "demo.actions",
      description: "Demo tool",
      inputSchema: {
        type: "object",
        properties: { actions: { type: "array" } }
      },
      permissionScopes: [] as string[],
      riskLevel: "low"
    };
    try {
      await provider.generate({
        sessionId: "s3",
        runId: "r3",
        messages: [{ role: "user", content: "ping" }],
        tools: [sharedTool]
      });
    } finally {
      restore();
    }

    // The original tool registry object must be unchanged after serialisation.
    expect((sharedTool.inputSchema.properties as Record<string, unknown>).actions).toEqual({
      type: "array"
    });
  });

  it("recurses into nested array items and properties", async () => {
    const { provider, body, restore } = captureRequestBody();
    try {
      await provider.generate({
        sessionId: "s4",
        runId: "r4",
        messages: [{ role: "user", content: "ping" }],
        tools: [
          {
            name: "demo.nested",
            description: "Tool with nested malformed schema.",
            inputSchema: {
              type: "object",
              properties: {
                grid: {
                  type: "array",
                  // items present but its own properties have a bare array
                  items: {
                    type: "object",
                    properties: {
                      cells: { type: "array" }
                    }
                  }
                }
              }
            },
            permissionScopes: [],
            riskLevel: "low"
          }
        ]
      });
    } finally {
      restore();
    }

    const sent = body();
    const tools = sent!.tools as Array<{
      function: {
        parameters: {
          properties: {
            grid: { items: { properties: { cells: { items: unknown } } } };
          };
        };
      };
    }>;
    expect(tools[0].function.parameters.properties.grid.items.properties.cells.items).toEqual({
      type: "string"
    });
  });
});
