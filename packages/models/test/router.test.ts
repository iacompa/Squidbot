import { describe, expect, it } from "vitest";
import { AnthropicModelProvider, ApiModelProvider, LocalModelProvider, MockModelProvider, ModelRouter, type ModelBudgetStore, type ModelEventType, type ModelUsageRecord } from "../src/index.js";

class MemoryBudgetStore implements ModelBudgetStore {
  private readonly usage = new Map<string, ModelUsageRecord>();

  getModelUsage(provider: string, usageDate: string): ModelUsageRecord | null {
    return this.usage.get(`${provider}:${usageDate}`) ?? null;
  }

  addModelUsage(provider: string, usageDate: string, tokens: number, cost: number): ModelUsageRecord {
    const key = `${provider}:${usageDate}`;
    const current = this.usage.get(key);
    const next = {
      id: `usage_${provider}_${usageDate}`,
      provider,
      usageDate,
      tokens: (current?.tokens ?? 0) + tokens,
      cost: (current?.cost ?? 0) + cost,
      updatedAt: new Date().toISOString()
    };
    this.usage.set(key, next);
    return next;
  }
}

function emitTo(events: Array<{ type: ModelEventType; data: Record<string, unknown> }>) {
  return (type: ModelEventType, data: Record<string, unknown>) => events.push({ type, data });
}

describe("ModelRouter", () => {
  it("falls back from unavailable local provider to mock", async () => {
    const events: Array<{ type: ModelEventType; data: Record<string, unknown> }> = [];
    const router = new ModelRouter({
      settings: { provider: "local" },
      providers: [new LocalModelProvider({ forceAvailable: false }), new MockModelProvider()]
    });

    const response = await router.generate({
      sessionId: "session_test",
      runId: "run_test",
      messages: [{ role: "user", content: "list files" }],
      tools: [{ name: "workspace.listFiles", description: "List files", inputSchema: {} }],
      emitEvent: emitTo(events)
    });

    expect(response.provider).toBe("mock");
    expect(events.map((event) => event.type)).toContain("model.fallback");
    expect(events.map((event) => event.type)).toContain("model.result");
  });

  it("routes BYOK calls when a key is configured and records usage", async () => {
    const store = new MemoryBudgetStore();
    const events: Array<{ type: ModelEventType; data: Record<string, unknown> }> = [];
    const router = new ModelRouter({
      settings: { provider: "api", apiKey: "test-key", apiBudgetTokens: 10_000 },
      budgetStore: store,
      providers: [new ApiModelProvider({ apiKey: "test-key" }), new MockModelProvider()]
    });

    const response = await router.generate({
      sessionId: "session_test",
      runId: "run_test",
      messages: [{ role: "user", content: "list files" }],
      tools: [{ name: "workspace.listFiles", description: "List files", inputSchema: {} }],
      emitEvent: emitTo(events)
    });
    const budget = router.getBudgetStatus("api");

    expect(response.provider).toBe("api");
    expect(response.costOwner).toBe("user-paid");
    expect(budget.usedTokens).toBeGreaterThan(0);
    expect(events.map((event) => event.type)).toContain("model.call");
    expect(events.map((event) => event.type)).toContain("model.result");
  });

  it("tracks BYOK budget per account, not in a shared 'api' bucket", async () => {
    const store = new MemoryBudgetStore();
    const request = {
      sessionId: "s",
      runId: "r",
      messages: [{ role: "user" as const, content: "list files" }],
      tools: [{ name: "workspace.listFiles", description: "List files", inputSchema: {} }]
    };

    // Account A makes a call — its usage is recorded under its own key.
    const routerA = new ModelRouter({
      settings: { provider: "api", apiKey: "kA", apiBudgetTokens: 10_000, apiBudgetKey: "acct_A" },
      budgetStore: store,
      providers: [new ApiModelProvider({ apiKey: "kA" }), new MockModelProvider()]
    });
    await routerA.generate(request);
    expect(routerA.getBudgetStatus("api").usedTokens).toBeGreaterThan(0);

    // Account B shares the same store but a different key — it must NOT inherit
    // account A's spend (the old code bucketed everything under "api").
    const routerB = new ModelRouter({
      settings: { provider: "api", apiKey: "kB", apiBudgetTokens: 10_000, apiBudgetKey: "acct_B" },
      budgetStore: store,
      providers: [new ApiModelProvider({ apiKey: "kB" }), new MockModelProvider()]
    });
    expect(routerB.getBudgetStatus("api").usedTokens).toBe(0);
  });

  it("falls back when BYOK budget is exhausted", async () => {
    const store = new MemoryBudgetStore();
    const events: Array<{ type: ModelEventType; data: Record<string, unknown> }> = [];
    const router = new ModelRouter({
      settings: { provider: "api", apiKey: "test-key", apiBudgetTokens: 1 },
      budgetStore: store,
      providers: [new ApiModelProvider({ apiKey: "test-key" }), new MockModelProvider()]
    });

    const response = await router.generate({
      sessionId: "session_test",
      runId: "run_test",
      messages: [{ role: "user", content: "list files" }],
      tools: [{ name: "workspace.listFiles", description: "List files", inputSchema: {} }],
      emitEvent: emitTo(events)
    });

    expect(response.provider).toBe("mock");
    expect(events.map((event) => event.type)).toContain("model.budgetExceeded");
    expect(events.map((event) => event.type)).toContain("model.fallback");
    expect(router.getBudgetStatus("api").usedTokens).toBe(0);
  });
});

describe("ModelRouter — native Anthropic provider selection", () => {
  it("uses the native AnthropicModelProvider when the apiUrl is the Anthropic Messages API", () => {
    const router = new ModelRouter({
      settings: { apiKey: "sk-ant-x", apiUrl: "https://api.anthropic.com/v1/messages", apiModel: "claude-sonnet-4-6" }
    });
    const api = router.listProviders().find((provider) => provider.name === "api");
    expect(api).toBeInstanceOf(AnthropicModelProvider);
  });

  it("uses the OpenAI-compatible ApiModelProvider for non-Anthropic endpoints", () => {
    const router = new ModelRouter({
      settings: { apiKey: "or-x", apiUrl: "https://openrouter.ai/api/v1/chat/completions", apiModel: "anthropic/claude-sonnet-4-6" }
    });
    const api = router.listProviders().find((provider) => provider.name === "api");
    expect(api).toBeInstanceOf(ApiModelProvider);
  });
});
