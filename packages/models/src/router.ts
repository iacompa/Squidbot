import { AnthropicModelProvider } from "./anthropicProvider.js";
import { ApiModelProvider } from "./apiProvider.js";
import type {
  JsonObject,
  ModelBudgetStore,
  ModelCostOwner,
  ModelProvider,
  ModelProviderName,
  ModelProviderRequest,
  ModelResponse,
  ModelRouterSettings,
  TaskPlan,
  TaskPlanRequest,
  TokenUsage
} from "./base.js";
import { LocalModelProvider } from "./localProvider.js";
import { MockModelProvider } from "./mockProvider.js";
import { estimateRequestTokens, normalizeBudget, todayUtc, usageFromText } from "./util.js";

export type ModelRouterOptions = {
  settings?: ModelRouterSettings;
  budgetStore?: ModelBudgetStore;
  providers?: ModelProvider[];
};

type ProviderCallKind = "chat" | "plan";

type RoutedProvider = {
  provider: ModelProvider;
  tokenEstimate: number;
  costEstimate: number;
};

export class ModelRouter {
  private readonly providers = new Map<string, ModelProvider>();
  private readonly settings: ModelRouterSettings;
  private readonly budgetStore?: ModelBudgetStore;
  private readonly forcedProviderName?: string;
  private lastProvider: ModelProvider;

  constructor(providerOrOptions: ModelProvider | ModelRouterOptions = {}) {
    const singleProvider = isModelProvider(providerOrOptions) ? providerOrOptions : null;
    const options: ModelRouterOptions = singleProvider ? { providers: [singleProvider] } : (providerOrOptions as ModelRouterOptions);
    this.settings = options.settings ?? {};
    this.budgetStore = options.budgetStore;
    this.forcedProviderName = singleProvider?.name;
    const defaultProviders = [
      new LocalModelProvider({ modelName: this.settings.localModel ?? undefined }),
      buildByokProvider(this.settings),
      new MockModelProvider()
    ];

    for (const provider of options.providers ?? defaultProviders) {
      this.providers.set(provider.name, provider);
    }

    if (!this.providers.has("mock")) {
      this.providers.set("mock", new MockModelProvider());
    }

    this.lastProvider = this.providers.get("mock")!;
  }

  getProvider(): ModelProvider {
    return this.lastProvider;
  }

  listProviders(): ModelProvider[] {
    return [...this.providers.values()];
  }

  async generate(request: ModelProviderRequest): Promise<ModelResponse> {
    return this.routeCall("chat", request, async (provider) => provider.generate(request));
  }

  async generateTaskPlan(request: TaskPlanRequest): Promise<TaskPlan> {
    return this.routeCall("plan", request, async (provider) => {
      if (provider.generateTaskPlan) {
        return provider.generateTaskPlan(request);
      }

      return new MockModelProvider().generateTaskPlan(request);
    });
  }

  getBudgetStatus(providerName = "api", date = todayUtc()): {
    provider: string;
    usageDate: string;
    budgetTokens: number | null;
    usedTokens: number;
    remainingTokens: number | null;
    cost: number;
  } {
    const budgetTokens = normalizeBudget(providerName === "api" ? this.settings.apiBudgetTokens : null);
    // BYOK usage is bucketed per account (apiBudgetKey), not under a shared
    // "api" key — otherwise two paid accounts would share one daily budget.
    const storeKey = providerName === "api" ? this.apiBudgetKey() : providerName;
    const usage = this.budgetStore?.getModelUsage(storeKey, date);
    const usedTokens = usage?.tokens ?? 0;
    return {
      provider: providerName,
      usageDate: date,
      budgetTokens,
      usedTokens,
      remainingTokens: budgetTokens === null ? null : Math.max(0, budgetTokens - usedTokens),
      cost: usage?.cost ?? 0
    };
  }

  private async routeCall<T>(
    callKind: ProviderCallKind,
    request: ModelProviderRequest | TaskPlanRequest,
    invoke: (provider: ModelProvider) => Promise<T>
  ): Promise<T> {
    const orderedProviders = this.providerOrder();
    let previousProvider: string | null = null;
    let previousReason: string | null = null;

    for (const provider of orderedProviders) {
      if (previousProvider) {
        request.emitEvent?.("model.fallback", {
          fromProvider: previousProvider,
          toProvider: provider.name,
          reason: previousReason ?? "Provider failed or was unavailable.",
          callKind
        });
      }

      const routed = await this.prepareProvider(provider, request, callKind);
      if (!routed) {
        previousProvider = provider.name;
        previousReason = `${provider.name} unavailable or budget blocked`;
        continue;
      }

      request.emitEvent?.("model.call", this.modelCallEvent(routed, request, callKind));

      try {
        const result = await invoke(provider);
        const modelResult = isModelResponse(result) ? result : null;
        const tokenUsage = modelResult?.tokenUsage ?? usageFromText(routed.tokenEstimate, JSON.stringify(result).slice(0, 2_000));
        const costEstimate = modelResult?.costEstimate ?? estimateCost(provider, tokenUsage.totalTokens);
        this.recordUsage(provider, tokenUsage, costEstimate);
        this.lastProvider = provider;
        request.emitEvent?.("model.result", {
          provider: provider.name,
          modelName: provider.modelName,
          mode: provider.mode,
          costOwner: provider.costOwner,
          callKind,
          success: true,
          tokenUsage,
          costEstimate
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown model provider failure.";
        request.emitEvent?.("model.error", {
          provider: provider.name,
          modelName: provider.modelName,
          mode: provider.mode,
          costOwner: provider.costOwner,
          callKind,
          message
        });
        previousProvider = provider.name;
        previousReason = message;
      }
    }

    throw new Error("No model provider was available.");
  }

  private async prepareProvider(
    provider: ModelProvider,
    request: ModelProviderRequest | TaskPlanRequest,
    callKind: ProviderCallKind
  ): Promise<RoutedProvider | null> {
    const available = provider.isAvailable ? await provider.isAvailable() : true;
    if (!available) {
      request.emitEvent?.("model.error", {
        provider: provider.name,
        modelName: provider.modelName,
        mode: provider.mode,
        costOwner: provider.costOwner,
        callKind,
        message: "Provider is not available."
      });
      return null;
    }

    const tokenEstimate = estimateProviderTokens(provider, request);
    const costEstimate = estimateCost(provider, tokenEstimate);
    if (provider.name === "api") {
      const budget = this.getBudgetStatus("api");
      if (budget.budgetTokens !== null) {
        if (tokenEstimate > budget.remainingTokens!) {
          request.emitEvent?.("model.budgetExceeded", {
            provider: provider.name,
            usageDate: budget.usageDate,
            budgetTokens: budget.budgetTokens,
            usedTokens: budget.usedTokens,
            remainingTokens: budget.remainingTokens,
            requestedTokens: tokenEstimate,
            callKind
          });
          return null;
        }

        if (tokenEstimate >= Math.max(1, Math.floor(budget.remainingTokens! * 0.8))) {
          request.emitEvent?.("model.budgetWarning", {
            provider: provider.name,
            usageDate: budget.usageDate,
            budgetTokens: budget.budgetTokens,
            usedTokens: budget.usedTokens,
            remainingTokens: budget.remainingTokens,
            requestedTokens: tokenEstimate,
            callKind
          });
        }
      }
    }

    return { provider, tokenEstimate, costEstimate };
  }

  private modelCallEvent(routed: RoutedProvider, request: ModelProviderRequest | TaskPlanRequest, callKind: ProviderCallKind): JsonObject {
    const tools = "tools" in request ? request.tools ?? [] : [];
    const promptSnapshot =
      "messages" in request
        ? { messages: request.messages }
        : {
            task: request.task,
            testCommand: request.testCommand ?? null,
            memoryBulletin: request.memoryBulletin ?? null,
            workspaceSummary: request.workspaceSummary
          };
    return {
      provider: routed.provider.name,
      modelName: routed.provider.modelName,
      mode: routed.provider.mode,
      costOwner: routed.provider.costOwner,
      callKind,
      tokenEstimate: routed.tokenEstimate,
      costEstimate: routed.costEstimate,
      maxTokens: routed.provider.maxTokens,
      supportsTools: routed.provider.supportsTools,
      toolCount: tools.length,
      promptSnapshot,
      toolDefinitions: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        permissionScopes: tool.permissionScopes ?? [],
        riskLevel: tool.riskLevel ?? "low",
        metadata: tool.metadata ?? {}
      })),
      contextSize: routed.tokenEstimate
    };
  }

  private recordUsage(provider: ModelProvider, tokenUsage: TokenUsage, costEstimate: number): void {
    if (provider.name !== "api") {
      return;
    }

    this.budgetStore?.addModelUsage(this.apiBudgetKey(), todayUtc(), tokenUsage.totalTokens, costEstimate);
  }

  /** Per-account BYOK budget bucket — the active account id, or "api" if none. */
  private apiBudgetKey(): string {
    const key = this.settings.apiBudgetKey;
    return key && key.length > 0 ? key : "api";
  }

  private providerOrder(): ModelProvider[] {
    if (this.forcedProviderName) {
      const provider = this.providers.get(this.forcedProviderName);
      return provider ? [provider] : [];
    }

    const selected = normalizeProviderName(this.settings.provider ?? this.settings.legacyProvider ?? "local");
    const namesByPreference: Record<ModelProviderName, string[]> = {
      api: ["api", "local", "mock"],
      local: ["local", "mock"],
      mock: ["mock"]
    };

    return namesByPreference[selected].map((name) => this.providers.get(name)).filter((provider): provider is ModelProvider => Boolean(provider));
  }
}

function normalizeProviderName(value: string): ModelProviderName {
  if (value === "api" || value === "local" || value === "mock") {
    return value;
  }

  return "local";
}

function estimateProviderTokens(provider: ModelProvider, request: ModelProviderRequest | TaskPlanRequest): number {
  if ("messages" in request) {
    return provider.estimateTokens?.(request.messages, request.tools) ?? estimateRequestTokens(request.messages, request.tools);
  }

  return estimateRequestTokens(
    [
      { role: "user", content: request.task },
      { role: "system", content: request.memoryBulletin ?? "" },
      { role: "system", content: JSON.stringify(request.workspaceSummary).slice(0, 6_000) }
    ],
    request.tools ?? []
  );
}

function estimateCost(provider: ModelProvider, tokens: number): number {
  return provider.costPerToken ? Number((tokens * provider.costPerToken).toFixed(8)) : 0;
}

function isModelProvider(value: unknown): value is ModelProvider {
  return Boolean(value && typeof value === "object" && "generate" in value && "name" in value);
}

/**
 * Build the BYOK ("api") provider from settings. When the endpoint is the
 * native Anthropic Messages API we use AnthropicModelProvider (native tool-use,
 * no proxy); every other endpoint uses the OpenAI-compatible provider. Both
 * register under the name "api", so the rest of the router is unchanged — the
 * endpoint URL alone decides the wire protocol.
 */
function buildByokProvider(settings: ModelRouterSettings): ModelProvider {
  const apiUrl = settings.apiUrl ?? undefined;
  if (apiUrl && isAnthropicUrl(apiUrl)) {
    return new AnthropicModelProvider({ apiKey: settings.apiKey, apiUrl, modelName: settings.apiModel });
  }
  return new ApiModelProvider({ apiKey: settings.apiKey, apiUrl: settings.apiUrl, modelName: settings.apiModel });
}

function isAnthropicUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "anthropic.com" || host === "api.anthropic.com" || host.endsWith(".anthropic.com");
  } catch {
    return /\banthropic\.com\b/i.test(url);
  }
}

function isModelResponse(value: unknown): value is ModelResponse {
  return Boolean(value && typeof value === "object" && "toolCalls" in value && "content" in value);
}
