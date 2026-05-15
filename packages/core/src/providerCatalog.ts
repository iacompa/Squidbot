import type { ProviderKind } from "./modelAccounts.js";

/**
 * Static catalog of canonical models per provider. This is what the UI falls
 * back to when we can't reach the provider's live `/v1/models` endpoint —
 * either because the user hasn't entered a key yet, the network is down, or
 * the provider doesn't expose a model-discovery API (looking at you, Ollama
 * without a running daemon).
 *
 * Curation rules of thumb:
 *   • Keep the list short — 4 to 8 models per provider. The point of this
 *     catalog is to show a reasonable default selection, not to enumerate
 *     every variant. The live `/v1/models` fetch always wins when available.
 *   • Order matters: flagship → balanced → fast → legacy. The first entry is
 *     what we surface as the suggested default for that provider.
 *   • Model IDs must be the exact strings the provider expects in the
 *     `model` field of an OpenAI-compatible request. NOT the human label.
 *
 * Last reviewed: 2026-05. Refresh when providers ship new flagships.
 */

export type ModelTier = "flagship" | "balanced" | "fast" | "reasoning" | "legacy";

export type ModelCatalogEntry = {
  /** The exact id to send as `model` in the API request. */
  id: string;
  /** Human-friendly label for the UI dropdown. */
  label: string;
  /** Optional tier hint for grouping / suggesting defaults. */
  tier: ModelTier;
  /** Optional one-line description shown under the label. */
  description?: string;
};

export const PROVIDER_MODEL_CATALOG: Record<ProviderKind, readonly ModelCatalogEntry[]> = {
  anthropic: [
    { id: "claude-opus-4-5", label: "Claude Opus 4.5", tier: "flagship", description: "Most capable Claude — best for hard reasoning, agents, complex tools." },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", tier: "balanced", description: "Strong default — fast enough for chat, smart enough for code." },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", tier: "fast", description: "Cheapest + fastest — great for high-volume / low-latency work." },
    { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet (legacy)", tier: "legacy", description: "Pin if you have flows that depend on 3.5 behaviour." }
  ],
  openai: [
    { id: "gpt-5", label: "GPT-5", tier: "flagship", description: "OpenAI's flagship — best general-purpose model." },
    { id: "gpt-5-mini", label: "GPT-5 mini", tier: "balanced", description: "Cheaper / faster GPT-5 variant for most chat workloads." },
    { id: "gpt-4o", label: "GPT-4o", tier: "balanced", description: "Multimodal — text + image + audio in one model." },
    { id: "gpt-4o-mini", label: "GPT-4o mini", tier: "fast", description: "Inexpensive, fast — good for routine tasks and tool calls." },
    { id: "o3-mini", label: "o3-mini", tier: "reasoning", description: "Reasoning model — slower but stronger on multi-step problems." }
  ],
  openrouter: [
    { id: "anthropic/claude-opus-4-5", label: "Anthropic · Claude Opus 4.5", tier: "flagship", description: "Routed via OpenRouter — billed in OR credits." },
    { id: "anthropic/claude-sonnet-5-5", label: "Anthropic · Claude Sonnet 5.5", tier: "balanced" },
    { id: "openai/gpt-5", label: "OpenAI · GPT-5", tier: "flagship" },
    { id: "google/gemini-2.5-pro", label: "Google · Gemini 2.5 Pro", tier: "flagship", description: "Strong on long context and reasoning." },
    { id: "google/gemini-2.0-flash-001", label: "Google · Gemini 2.0 Flash", tier: "fast", description: "Very cheap — great for high-volume work." },
    { id: "meta-llama/llama-3.3-70b-instruct", label: "Meta · Llama 3.3 70B Instruct", tier: "balanced", description: "Open-weights flagship; very competitive on price." }
  ],
  groq: [
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile", tier: "flagship", description: "Groq's fastest large model — sub-second TTFB." },
    { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant", tier: "fast", description: "Ultra-cheap and extremely fast for simple tasks." },
    { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B", tier: "balanced", description: "Solid mid-tier with a 32K context window." }
  ],
  together: [
    { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", label: "Llama 3.3 70B Turbo", tier: "flagship" },
    { id: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo", label: "Llama 3.1 8B Turbo", tier: "fast" },
    { id: "deepseek-ai/deepseek-coder-33b-instruct", label: "DeepSeek Coder 33B", tier: "balanced", description: "Strong on code generation specifically." }
  ],
  ollama: [
    { id: "llama3.3:latest", label: "Llama 3.3 (latest)", tier: "flagship", description: "Make sure you've run `ollama pull llama3.3` first." },
    { id: "llama3.1:8b", label: "Llama 3.1 8B", tier: "fast" },
    { id: "mistral:latest", label: "Mistral", tier: "balanced" },
    { id: "phi3:latest", label: "Phi 3", tier: "fast", description: "Tiny, capable, runs on modest hardware." }
  ],
  custom: []
};

export function getCatalogForProvider(providerKind: ProviderKind): readonly ModelCatalogEntry[] {
  return PROVIDER_MODEL_CATALOG[providerKind] ?? [];
}

/**
 * The default model to surface for a provider when the user picks it in the
 * UI. Returns the first entry in the catalog (which is always the flagship by
 * curation rule). Custom providers have no catalog, so callers get null and
 * must require explicit input.
 */
export function getDefaultModelForProvider(providerKind: ProviderKind): string | null {
  const catalog = getCatalogForProvider(providerKind);
  return catalog[0]?.id ?? null;
}

/**
 * Merge a live model list (from the provider's `/v1/models` endpoint) with
 * the static catalog. Live entries override the catalog by id, but the
 * catalog supplies labels/tiers/descriptions for known models that the live
 * endpoint returns. Unknown live entries get a synthesized label.
 *
 * Used by the renderer so the dropdown shows everything the user could
 * possibly pick, with rich metadata where we have it and bare ids where we
 * don't.
 */
export function mergeWithLiveModels(
  providerKind: ProviderKind,
  liveModelIds: readonly string[]
): ModelCatalogEntry[] {
  const catalog = getCatalogForProvider(providerKind);
  const byId = new Map<string, ModelCatalogEntry>();
  for (const entry of catalog) {
    byId.set(entry.id, { ...entry });
  }
  for (const id of liveModelIds) {
    if (!byId.has(id)) {
      byId.set(id, { id, label: id, tier: "balanced" });
    }
  }
  // Surface live entries in the order the provider returned them, then
  // append catalog-only entries the live endpoint didn't mention. This way
  // a user who's already paying for a specific model on a specific provider
  // sees it in the order the provider considers canonical, while still
  // having the curated defaults available as a fallback.
  const liveSet = new Set(liveModelIds);
  const live = liveModelIds.map((id) => byId.get(id)!).filter(Boolean);
  const catalogOnly = catalog.filter((entry) => !liveSet.has(entry.id));
  return [...live, ...catalogOnly];
}
