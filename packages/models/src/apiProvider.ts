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
      // OpenRouter (and a growing number of compatible providers) include the
      // real upstream-billed amount on `usage.cost` (and a granular breakdown
      // under `usage.cost_details`). When present, we prefer the reported
      // value over our local per-token heuristic — our heuristic over-
      // estimates by ~200x for cheap models like Gemini 2.0 Flash.
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        cost?: number;
        cost_details?: {
          upstream_inference_cost?: number;
          upstream_inference_prompt_cost?: number;
          upstream_inference_completions_cost?: number;
        };
      };
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

    const reportedCost = typeof parsed.usage?.cost === "number" && Number.isFinite(parsed.usage.cost)
      ? parsed.usage.cost
      : null;
    const costEstimate = reportedCost ?? tokenUsage.totalTokens * this.costPerToken;

    return {
      provider: this.name,
      modelName: this.modelName,
      mode: this.mode,
      costOwner: this.costOwner,
      content,
      toolCalls,
      tokenUsage,
      costEstimate
    };
  }
}

function toOpenAiTools(tools: ToolSchema[]): unknown[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: sanitizeJsonSchemaForStrictProviders(tool.inputSchema)
    }
  }));
}

/**
 * Make a JSON Schema safe for strict providers like Google Gemini.
 *
 * Gemini (unlike OpenAI's chat-completions endpoint) validates tool parameter
 * schemas strictly and rejects requests where:
 *
 *   • An `array`-typed property is missing the required `items` declaration.
 *   • A property declared as `"type": ["string", "null"]` (JSON Schema array
 *     form) instead of a single string.
 *
 * Rather than hand-audit every connector, skill, and tool schema in the
 * registry, we walk the schema once at serialisation time and fix the two
 * known-strict violations:
 *
 *   • Fill in `items: { type: "string" }` on any `array` missing items.
 *   • Collapse `type: [..., "null"]` into the first non-null value.
 *
 * This is non-destructive — it never overrides an existing `items` value or a
 * single-string type. The mutation is on a clone so the upstream tool registry
 * is never modified.
 */
function sanitizeJsonSchemaForStrictProviders(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) {
    return schema.map((item) => sanitizeJsonSchemaForStrictProviders(item));
  }

  const source = schema as Record<string, unknown>;
  const out: Record<string, unknown> = { ...source };

  // Normalise the `type` field. JSON Schema permits `type: ["string", "null"]`
  // to mean nullable; Gemini wants `type: "string"` and nothing else.
  if (Array.isArray(out.type)) {
    const nonNull = out.type.find((value) => value !== "null" && typeof value === "string");
    out.type = nonNull ?? out.type[0];
  }

  // If this is an array schema with no items, default to a permissive string item.
  if (out.type === "array" && (out.items === undefined || out.items === null)) {
    out.items = { type: "string" };
  }

  // Recurse into nested structures (properties + items + anyOf/oneOf/allOf).
  if (out.properties && typeof out.properties === "object") {
    const properties = out.properties as Record<string, unknown>;
    const sanitisedProperties: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(properties)) {
      sanitisedProperties[name] = sanitizeJsonSchemaForStrictProviders(value);
    }
    out.properties = sanitisedProperties;
  }
  if (out.items !== undefined) {
    out.items = sanitizeJsonSchemaForStrictProviders(out.items);
  }
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(out[key])) {
      out[key] = (out[key] as unknown[]).map((entry) => sanitizeJsonSchemaForStrictProviders(entry));
    }
  }

  return out;
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
