import { sanitizeJsonSchemaForStrictProviders, sanitizeToolName } from "./apiProvider.js";
import type { ChatMessage, ModelProvider, ModelProviderRequest, ModelResponse, TaskPlan, TaskPlanRequest } from "./base.js";
import { generateDeterministicResponse, generateDeterministicTaskPlan } from "./deterministic.js";
import { estimateRequestTokens } from "./util.js";

export type AnthropicModelProviderOptions = {
  apiKey?: string | null;
  apiUrl?: string | null;
  modelName?: string | null;
  costPerToken?: number;
  /** Anthropic's required `max_tokens` output cap. Default 4096. */
  maxOutputTokens?: number;
  /** Abort the HTTP call after this many ms. Default 60_000. */
  fetchTimeoutMs?: number;
  /** `anthropic-version` header. Default 2023-06-01. */
  anthropicVersion?: string;
};

const ANTHROPIC_DEFAULT_URL = "https://api.anthropic.com/v1/messages";

/**
 * Native provider for Anthropic's Messages API (`/v1/messages`). This is a
 * different wire shape from the OpenAI-compatible `ApiModelProvider`:
 *   - auth is `x-api-key` + `anthropic-version`, not a Bearer token;
 *   - there is no `system` or `tool` *role* — the system prompt is a top-level
 *     field, tool calls come back as `tool_use` content blocks, and tool
 *     results are sent as a `user` message carrying a `tool_result` block;
 *   - `max_tokens` (the output cap) is required.
 *
 * It shares the OpenAI provider's name ("api") and mode ("byok") so the router
 * can substitute one for the other purely on the endpoint URL — Claude accounts
 * configured against api.anthropic.com get native tool-use without any other
 * routing change. Closes the modelAccounts.ts "Anthropic native schema" TODO.
 */
export class AnthropicModelProvider implements ModelProvider {
  readonly name = "api";
  readonly modelName: string;
  readonly mode = "byok";
  readonly maxTokens = 200_000;
  readonly supportsTools = true;
  readonly costOwner = "user-paid";
  readonly costPerToken: number;
  private readonly apiKey?: string | null;
  private readonly apiUrl: string;
  private readonly maxOutputTokens: number;
  private readonly fetchTimeoutMs: number;
  private readonly anthropicVersion: string;

  constructor(options: AnthropicModelProviderOptions = {}) {
    this.apiKey = options.apiKey;
    this.apiUrl = options.apiUrl && options.apiUrl.trim() ? options.apiUrl : ANTHROPIC_DEFAULT_URL;
    this.modelName = options.modelName ?? "claude-sonnet-4-6";
    this.costPerToken = options.costPerToken ?? 0.000009;
    this.maxOutputTokens = options.maxOutputTokens ?? 4096;
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? 60_000;
    this.anthropicVersion = options.anthropicVersion ?? "2023-06-01";
  }

  estimateTokens = estimateRequestTokens;

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async generate(request: ModelProviderRequest): Promise<ModelResponse> {
    if (!this.apiKey) {
      throw new Error("Anthropic provider is disabled because no API key is configured.");
    }

    if (!/^https?:\/\//i.test(this.apiUrl)) {
      return generateDeterministicResponse({
        request,
        provider: this.name,
        modelName: this.modelName,
        mode: this.mode,
        costOwner: this.costOwner,
        contentPrefix: "Anthropic provider is configured. This zero-spend test path returns deterministic output unless apiUrl points at a real endpoint.",
        costPerToken: this.costPerToken
      });
    }

    // Hoist system messages to the top-level `system` param (Anthropic has no
    // system role inside `messages`).
    const systemText = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n")
      .trim();

    const reverseToolNameMap = new Map<string, string>();
    const tools = request.tools.map((tool) => {
      const sanitized = sanitizeToolName(tool.name);
      reverseToolNameMap.set(sanitized, tool.name);
      reverseToolNameMap.set(tool.name, tool.name);
      return {
        name: sanitized,
        description: tool.description,
        input_schema: sanitizeJsonSchemaForStrictProviders(tool.inputSchema)
      };
    });

    const messages = request.messages
      .filter((message) => message.role !== "system")
      .map((message) => serializeMessageForAnthropic(message));

    const body: Record<string, unknown> = {
      model: this.modelName,
      max_tokens: this.maxOutputTokens,
      messages
    };
    if (systemText) {
      body.system = systemText;
    }
    if (tools.length > 0) {
      body.tools = tools;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.fetchTimeoutMs);
    let response: Response;
    try {
      response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": this.anthropicVersion
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Anthropic API request timed out after ${this.fetchTimeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`Anthropic API request failed with ${response.status}: ${await response.text()}`);
    }

    const parsed = (await response.json()) as {
      content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const blocks = parsed.content ?? [];
    const content = blocks
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("");
    const toolCalls = blocks
      .filter((block) => block.type === "tool_use")
      .map((block, index) => ({
        id: block.id ?? `tool_use_${index}`,
        name: reverseToolNameMap.get(block.name ?? "") ?? block.name ?? "unknown",
        args: block.input && typeof block.input === "object" ? (block.input as Record<string, unknown>) : {}
      }));

    const promptTokens = parsed.usage?.input_tokens ?? estimateRequestTokens(request.messages, request.tools);
    const completionTokens = parsed.usage?.output_tokens ?? 0;
    const totalTokens = promptTokens + completionTokens;

    return {
      provider: this.name,
      modelName: this.modelName,
      mode: this.mode,
      costOwner: this.costOwner,
      content,
      toolCalls,
      tokenUsage: { promptTokens, completionTokens, totalTokens },
      costEstimate: totalTokens * this.costPerToken
    };
  }

  async generateTaskPlan(request: TaskPlanRequest): Promise<TaskPlan> {
    if (!this.apiKey) {
      throw new Error("Anthropic provider is disabled because no API key is configured.");
    }
    return generateDeterministicTaskPlan(request);
  }
}

/**
 * Serialize a SquidBot ChatMessage into an Anthropic Messages-API turn.
 * Assistant turns that requested tools become a `tool_use` content block;
 * tool-result turns (`role: "tool"`) become a `user` message carrying a
 * `tool_result` block linked by `tool_use_id`.
 */
function serializeMessageForAnthropic(message: ChatMessage): { role: "user" | "assistant"; content: unknown } {
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    const blocks: Array<Record<string, unknown>> = [];
    if (message.content && message.content.length > 0) {
      blocks.push({ type: "text", text: message.content });
    }
    for (const call of message.toolCalls) {
      blocks.push({ type: "tool_use", id: call.id, name: sanitizeToolName(call.name), input: call.args ?? {} });
    }
    return { role: "assistant", content: blocks };
  }

  if (message.role === "tool") {
    return {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: message.toolCallId ?? "", content: message.content }]
    };
  }

  return { role: message.role === "assistant" ? "assistant" : "user", content: message.content };
}
