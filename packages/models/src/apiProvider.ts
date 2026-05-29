import type { ChatMessage, ModelProvider, ModelProviderRequest, ModelResponse, TaskPlan, TaskPlanRequest, ToolSchema } from "./base.js";
import { generateDeterministicResponse, generateDeterministicTaskPlan } from "./deterministic.js";
import { estimateRequestTokens, usageFromText } from "./util.js";

export type ApiModelProviderOptions = {
  apiKey?: string | null;
  apiUrl?: string | null;
  modelName?: string | null;
  costPerToken?: number;
  /** Abort a BYOK HTTP call after this many ms. Default 60_000. */
  fetchTimeoutMs?: number;
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
  private readonly fetchTimeoutMs: number;

  constructor(options: ApiModelProviderOptions = {}) {
    this.apiKey = options.apiKey;
    this.apiUrl = options.apiUrl;
    this.modelName = options.modelName ?? "byok-openai-compatible";
    this.costPerToken = options.costPerToken ?? 0.00001;
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? 60_000;
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
    // OpenAI's tool-name spec is `^[a-zA-Z0-9_-]+$` — no dots. OpenRouter,
    // Google Gemini, and most gateways silently swap dots → underscores
    // when echoing tool calls back, which breaks our dotted registry
    // names (e.g. `model.useAccount` → returned as `model_useAccount`).
    // We sanitise on the way out and reverse on the way in using a
    // per-request map so the rest of the runtime keeps using dotted names.
    const { sanitizedTools, reverseToolNameMap } = sanitizeToolNamesForOpenAi(request.tools);
    const body = {
      model: this.modelName,
      messages: request.messages.map((message) => serializeMessageForOpenAi(message)),
      tools: sanitizedTools
    };
    // Bound the request so a hung or unresponsive endpoint can't block the
    // agent loop forever. Translate the abort into a clear, actionable error.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.fetchTimeoutMs);
    let response: Response;
    try {
      response = await fetch(this.apiUrl!, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`BYOK API request timed out after ${this.fetchTimeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

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
      firstMessage?.tool_calls?.map((call, index) => {
        const returnedName = call.function?.name ?? "unknown";
        // Reverse the dot→underscore mapping we applied on the way out.
        // If the model invented a name we didn't send, leave it as-is so
        // the dispatcher can report "unknown tool" with the real string.
        const resolvedName = reverseToolNameMap.get(returnedName) ?? returnedName;
        return {
          id: call.id ?? `call_api_${index}`,
          name: resolvedName,
          args: parseToolArgs(call.function?.arguments)
        };
      }) ?? [];
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

/**
 * Convert SquidBot's dotted tool names (`model.useAccount`) into the
 * underscored form that OpenAI's tool-call spec requires (`model_useAccount`),
 * while returning a reverse-lookup map so the response parser can swap back
 * to the dotted name. Collisions are impossible in practice because we
 * always replace `.` with `_` deterministically and tools don't already
 * contain pre-existing underscore-only forms; if one ever did, the dotted
 * form wins in the reverse map.
 */
function sanitizeToolNamesForOpenAi(tools: ToolSchema[]): {
  sanitizedTools: unknown[];
  reverseToolNameMap: Map<string, string>;
} {
  const reverseToolNameMap = new Map<string, string>();
  const sanitizedTools = tools.map((tool) => {
    const sanitizedName = sanitizeToolName(tool.name);
    if (!reverseToolNameMap.has(sanitizedName)) {
      reverseToolNameMap.set(sanitizedName, tool.name);
    }
    // Also map the original (un-sanitized) name to itself so we tolerate
    // providers that echo the original dotted name unchanged.
    reverseToolNameMap.set(tool.name, tool.name);
    return {
      type: "function",
      function: {
        name: sanitizedName,
        description: tool.description,
        parameters: sanitizeJsonSchemaForStrictProviders(tool.inputSchema)
      }
    };
  });
  return { sanitizedTools, reverseToolNameMap };
}

/**
 * Serialize a SquidBot ChatMessage into the OpenAI chat-completions wire shape.
 * Assistant turns that requested tools carry a `tool_calls` array; tool-result
 * turns carry `tool_call_id` linking back to the call they answer. OpenAI (and
 * compatible gateways) REQUIRE this pairing — a bare `role: "tool"` message
 * with no preceding assistant `tool_calls` is rejected, which is exactly what
 * a naive agentic loop would send.
 */
function serializeMessageForOpenAi(message: ChatMessage): Record<string, unknown> {
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: "assistant",
      // OpenAI permits null content alongside tool_calls; some strict gateways
      // reject an empty string, so coalesce empty → null.
      content: message.content && message.content.length > 0 ? message.content : null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: sanitizeToolName(call.name), arguments: JSON.stringify(call.args ?? {}) }
      }))
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      tool_call_id: message.toolCallId ?? ""
    };
  }
  return { role: message.role, content: message.content };
}

function sanitizeToolName(name: string): string {
  // OpenAI spec: `^[a-zA-Z0-9_-]{1,64}$`. Replace anything outside that
  // class with `_` and clip to 64 chars. We don't expect anything other
  // than `.` in practice but the guard is cheap.
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
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
