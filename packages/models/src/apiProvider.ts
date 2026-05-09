import type { ChatMessage, ModelProvider, ModelProviderRequest, ModelResponse, TaskPlan, TaskPlanRequest, ToolSchema } from "./base.js";
import { generateDeterministicResponse, generateDeterministicTaskPlan } from "./deterministic.js";
import { estimateRequestTokens, usageFromText } from "./util.js";

export type ApiModelProviderOptions = {
  apiKey?: string | null;
  apiUrl?: string | null;
  modelName?: string | null;
  costPerToken?: number;
};

export class ApiModelProvider implements ModelProvider {
  readonly name = "api";
  readonly modelName: string;
  readonly mode = "byok";
  readonly maxTokens = 128_000;
  readonly supportsTools = true;
  readonly costOwner = "user-paid";
  readonly costPerToken: number;
  private readonly apiKey?: string | null;
  private readonly apiUrl?: string | null;

  constructor(options: ApiModelProviderOptions = {}) {
    this.apiKey = options.apiKey;
    this.apiUrl = options.apiUrl;
    this.modelName = options.modelName ?? "byok-openai-compatible";
    this.costPerToken = options.costPerToken ?? 0.00001;
  }

  estimateTokens = estimateRequestTokens;

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async generate(request: ModelProviderRequest): Promise<ModelResponse> {
    if (!this.apiKey) {
      throw new Error("BYOK API provider is disabled because model.apiKey is not configured.");
    }

    if (this.apiUrl && /^https?:\/\//i.test(this.apiUrl)) {
      return this.generateViaHttp(request);
    }

    return generateDeterministicResponse({
      request,
      provider: this.name,
      modelName: this.modelName,
      mode: this.mode,
      costOwner: this.costOwner,
      contentPrefix: "BYOK API provider is configured. This zero-spend test path returns deterministic output unless model.apiUrl points to a real endpoint.",
      costPerToken: this.costPerToken
    });
  }

  async generateTaskPlan(request: TaskPlanRequest): Promise<TaskPlan> {
    if (!this.apiKey) {
      throw new Error("BYOK API provider is disabled because model.apiKey is not configured.");
    }

    return generateDeterministicTaskPlan(request);
  }

  private async generateViaHttp(request: ModelProviderRequest): Promise<ModelResponse> {
    const body = {
      model: this.modelName,
      messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
      tools: toOpenAiTools(request.tools)
    };
    const response = await fetch(this.apiUrl!, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`BYOK API request failed with ${response.status}: ${await response.text()}`);
    }

    const parsed = (await response.json()) as {
      choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const firstMessage = parsed.choices?.[0]?.message;
    const content = firstMessage?.content ?? "";
    const toolCalls =
      firstMessage?.tool_calls?.map((call, index) => ({
        id: call.id ?? `call_api_${index}`,
        name: call.function?.name ?? "unknown",
        args: parseToolArgs(call.function?.arguments)
      })) ?? [];
    const promptTokens = parsed.usage?.prompt_tokens ?? estimateRequestTokens(request.messages, request.tools);
    const tokenUsage = {
      promptTokens,
      completionTokens: parsed.usage?.completion_tokens ?? usageFromText(promptTokens, content).completionTokens,
      totalTokens: parsed.usage?.total_tokens ?? promptTokens + usageFromText(promptTokens, content).completionTokens
    };

    return {
      provider: this.name,
      modelName: this.modelName,
      mode: this.mode,
      costOwner: this.costOwner,
      content,
      toolCalls,
      tokenUsage,
      costEstimate: tokenUsage.totalTokens * this.costPerToken
    };
  }
}

function toOpenAiTools(tools: ToolSchema[]): unknown[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }
  }));
}

function parseToolArgs(value: string | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
