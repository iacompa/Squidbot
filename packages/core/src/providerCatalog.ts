import type { ProviderKind } from "./modelAccounts.js";

/**
 * Static catalog of canonical models per provider. This is what the UI falls
 * back to when we can't reach the provider's live `/v1/models` endpoint —
 * either because the user hasn't entered a key yet, the network is down, or
 * the provider doesn't expose a model-discovery API (looking at you, Ollama
 * without a running daemon).
 *
 * Curation rules of thumb:
 *   • Keep the list short — 3 to 6 models per provider. The point of this
 *     catalog is to show a reasonable default selection, not to enumerate
 *     every variant. The live `/v1/models` fetch always wins when available.
 *   • Order matters: flagship → balanced → fast → legacy. The first entry is
 *     what we surface as the suggested default for that provider.
 *   • Model IDs must be the exact strings the provider expects in the
 *     `model` field of an OpenAI-compatible request. NOT the human label.
 *   • Pricing is in USD per ONE MILLION tokens. Use the public list price
 *     for input + output. Approximate is fine — exact numbers are what
 *     `usage.cost` in the live response is for. The point of catalog
 *     pricing is to let users *compare* at a glance before they pick.
 *
 * Last reviewed: 2026-05. Refresh when providers ship new flagships.
 */

export type ModelTier = "flagship" | "balanced" | "fast" | "reasoning" | "legacy";

/**
 * Public list price for a model, in USD per 1,000,000 tokens. Both fields
 * are optional because some providers don't publish prices (Ollama is free;
 * a self-hosted custom endpoint has no list price), and we'd rather show
 * "—" than fabricate a number.
 */
export type ModelPricing = {
  inputPerMTokens?: number;
  outputPerMTokens?: number;
};

export type ModelCatalogEntry = {
  /** The exact id to send as `model` in the API request. */
  id: string;
  /** Human-friendly label for the UI dropdown. */
  label: string;
  /** Optional tier hint for grouping / suggesting defaults. */
  tier: ModelTier;
  /** Optional one-line description shown under the label. */
  description?: string;
  /** Optional list-price info, surfaced in the dropdown so users can
   *  pick cost-effective models without leaving the app. */
  pricing?: ModelPricing;
};

/**
 * Helper: produces the "$X / $Y per 1M" suffix shown in dropdown labels.
 * Returns null when no pricing info is available so callers can render the
 * label without an awkward "—" trailing.
 */
export function formatModelPricing(pricing: ModelPricing | undefined): string | null {
  if (!pricing) return null;
  const { inputPerMTokens, outputPerMTokens } = pricing;
  if (inputPerMTokens === undefined && outputPerMTokens === undefined) return null;
  if (inputPerMTokens === 0 && outputPerMTokens === 0) return "free";
  // Show a single dollar sign per side and let the precision adapt to size:
  // sub-dollar prices get 3-4 decimals; dollar-and-up get 2.
  const fmt = (n: number | undefined): string => {
    if (n === undefined) return "?";
    if (n === 0) return "$0";
    if (n < 0.01) return `$${n.toFixed(4)}`;
    if (n < 1) return `$${n.toFixed(2)}`;
    return `$${n.toFixed(2)}`;
  };
  return `${fmt(inputPerMTokens)} in / ${fmt(outputPerMTokens)} out per 1M`;
}

export const PROVIDER_MODEL_CATALOG: Record<ProviderKind, readonly ModelCatalogEntry[]> = {
  // ---------------- Gateway ----------------
  openrouter: [
    {
      id: "google/gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
      tier: "fast",
      description: "Cheap, fast, capable. The default workhorse for chat traffic.",
      pricing: { inputPerMTokens: 0.1, outputPerMTokens: 0.4 }
    },
    {
      id: "deepseek/deepseek-chat",
      label: "DeepSeek V3",
      tier: "balanced",
      description: "Excellent quality for the price — ~$0.14/$0.28 per 1M.",
      pricing: { inputPerMTokens: 0.14, outputPerMTokens: 0.28 }
    },
    {
      id: "anthropic/claude-haiku-4-5",
      label: "Anthropic · Claude Haiku 4.5",
      tier: "fast",
      pricing: { inputPerMTokens: 0.8, outputPerMTokens: 4 }
    },
    {
      id: "anthropic/claude-sonnet-5-5",
      label: "Anthropic · Claude Sonnet 5.5",
      tier: "balanced",
      pricing: { inputPerMTokens: 3, outputPerMTokens: 15 }
    },
    {
      id: "anthropic/claude-opus-4-5",
      label: "Anthropic · Claude Opus 4.5",
      tier: "flagship",
      description: "Most capable Claude — best for hard reasoning and tools.",
      pricing: { inputPerMTokens: 15, outputPerMTokens: 75 }
    },
    {
      id: "openai/gpt-5",
      label: "OpenAI · GPT-5",
      tier: "flagship",
      pricing: { inputPerMTokens: 1.25, outputPerMTokens: 10 }
    },
    {
      id: "openai/gpt-4o-mini",
      label: "OpenAI · GPT-4o Mini",
      tier: "fast",
      pricing: { inputPerMTokens: 0.15, outputPerMTokens: 0.6 }
    },
    {
      id: "google/gemini-2.5-pro",
      label: "Google · Gemini 2.5 Pro",
      tier: "flagship",
      description: "Strong on long context and reasoning.",
      pricing: { inputPerMTokens: 1.25, outputPerMTokens: 10 }
    },
    {
      id: "meta-llama/llama-3.3-70b-instruct",
      label: "Meta · Llama 3.3 70B Instruct",
      tier: "balanced",
      description: "Open-weights flagship — very competitive on price.",
      pricing: { inputPerMTokens: 0.5, outputPerMTokens: 0.5 }
    },
    {
      id: "x-ai/grok-4",
      label: "xAI · Grok 4",
      tier: "flagship",
      pricing: { inputPerMTokens: 3, outputPerMTokens: 15 }
    }
  ],

  // ---------------- Direct providers (alphabetical) ----------------
  anthropic: [
    {
      id: "anthropic/claude-haiku-4-5",
      label: "Claude Haiku 4.5",
      tier: "fast",
      description: "Cheapest + fastest Claude — great for high-volume work.",
      pricing: { inputPerMTokens: 0.8, outputPerMTokens: 4 }
    },
    {
      id: "anthropic/claude-sonnet-5-5",
      label: "Claude Sonnet 5.5",
      tier: "balanced",
      description: "Strong default — fast enough for chat, smart enough for code.",
      pricing: { inputPerMTokens: 3, outputPerMTokens: 15 }
    },
    {
      id: "anthropic/claude-opus-4-5",
      label: "Claude Opus 4.5",
      tier: "flagship",
      description: "Most capable Claude — premium pricing.",
      pricing: { inputPerMTokens: 15, outputPerMTokens: 75 }
    }
  ],

  deepseek: [
    {
      id: "deepseek-chat",
      label: "DeepSeek V3",
      tier: "balanced",
      description: "Industry-leading price/quality — ~1/100th the cost of GPT-5.",
      pricing: { inputPerMTokens: 0.14, outputPerMTokens: 0.28 }
    },
    {
      id: "deepseek-reasoner",
      label: "DeepSeek R1 (reasoning)",
      tier: "reasoning",
      description: "Open-weights reasoning model — multi-step problems, still cheap.",
      pricing: { inputPerMTokens: 0.55, outputPerMTokens: 2.19 }
    },
    {
      id: "deepseek-coder",
      label: "DeepSeek Coder",
      tier: "balanced",
      description: "Tuned for code generation specifically.",
      pricing: { inputPerMTokens: 0.14, outputPerMTokens: 0.28 }
    }
  ],

  gemini: [
    {
      id: "gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
      tier: "fast",
      description: "Cheap, fast, strong default for chat traffic.",
      pricing: { inputPerMTokens: 0.1, outputPerMTokens: 0.4 }
    },
    {
      id: "gemini-2.0-flash",
      label: "Gemini 2.0 Flash",
      tier: "fast",
      description: "Even cheaper — for very high-volume or simple tasks.",
      pricing: { inputPerMTokens: 0.075, outputPerMTokens: 0.3 }
    },
    {
      id: "gemini-2.5-pro",
      label: "Gemini 2.5 Pro",
      tier: "flagship",
      description: "Long-context flagship. Strong on reasoning.",
      pricing: { inputPerMTokens: 1.25, outputPerMTokens: 10 }
    }
  ],

  groq: [
    {
      id: "llama-3.3-70b-versatile",
      label: "Llama 3.3 70B Versatile",
      tier: "flagship",
      description: "Sub-second time-to-first-byte. Great when latency matters.",
      pricing: { inputPerMTokens: 0.59, outputPerMTokens: 0.79 }
    },
    {
      id: "llama-3.1-8b-instant",
      label: "Llama 3.1 8B Instant",
      tier: "fast",
      description: "Ultra-cheap, ultra-fast for simple work.",
      pricing: { inputPerMTokens: 0.05, outputPerMTokens: 0.08 }
    },
    {
      id: "mixtral-8x7b-32768",
      label: "Mixtral 8x7B (32K context)",
      tier: "balanced",
      pricing: { inputPerMTokens: 0.24, outputPerMTokens: 0.24 }
    }
  ],

  openai: [
    {
      id: "gpt-4o-mini",
      label: "GPT-4o Mini",
      tier: "fast",
      description: "Cheap and fast — good default for routine tasks and tool calls.",
      pricing: { inputPerMTokens: 0.15, outputPerMTokens: 0.6 }
    },
    {
      id: "gpt-5-mini",
      label: "GPT-5 Mini",
      tier: "balanced",
      description: "Cheaper / faster GPT-5 variant for most chat workloads.",
      pricing: { inputPerMTokens: 0.25, outputPerMTokens: 2 }
    },
    {
      id: "gpt-5",
      label: "GPT-5",
      tier: "flagship",
      description: "Flagship general-purpose model.",
      pricing: { inputPerMTokens: 1.25, outputPerMTokens: 10 }
    },
    {
      id: "gpt-4o",
      label: "GPT-4o",
      tier: "balanced",
      description: "Multimodal — text + image + audio in one model.",
      pricing: { inputPerMTokens: 2.5, outputPerMTokens: 10 }
    },
    {
      id: "o3-mini",
      label: "o3-mini",
      tier: "reasoning",
      description: "Reasoning model — slower but stronger on multi-step problems.",
      pricing: { inputPerMTokens: 1.1, outputPerMTokens: 4.4 }
    }
  ],

  together: [
    {
      id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      label: "Llama 3.3 70B Turbo",
      tier: "flagship",
      pricing: { inputPerMTokens: 0.88, outputPerMTokens: 0.88 }
    },
    {
      id: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
      label: "Llama 3.1 8B Turbo",
      tier: "fast",
      pricing: { inputPerMTokens: 0.18, outputPerMTokens: 0.18 }
    },
    {
      id: "deepseek-ai/deepseek-coder-33b-instruct",
      label: "DeepSeek Coder 33B",
      tier: "balanced",
      description: "Strong on code generation.",
      pricing: { inputPerMTokens: 0.8, outputPerMTokens: 0.8 }
    }
  ],

  xai: [
    {
      id: "grok-4",
      label: "Grok 4",
      tier: "flagship",
      description: "xAI's flagship — strong on real-time / current-events knowledge.",
      pricing: { inputPerMTokens: 3, outputPerMTokens: 15 }
    },
    {
      id: "grok-3",
      label: "Grok 3",
      tier: "balanced",
      pricing: { inputPerMTokens: 2, outputPerMTokens: 10 }
    },
    {
      id: "grok-3-mini",
      label: "Grok 3 Mini",
      tier: "fast",
      description: "Cheap workhorse Grok variant.",
      pricing: { inputPerMTokens: 0.3, outputPerMTokens: 0.5 }
    }
  ],

  ollama: [
    {
      id: "llama3.3:latest",
      label: "Llama 3.3 (latest)",
      tier: "flagship",
      description: "Run `ollama pull llama3.3` first. Zero token cost.",
      pricing: { inputPerMTokens: 0, outputPerMTokens: 0 }
    },
    {
      id: "qwen2.5",
      label: "Qwen 2.5",
      tier: "balanced",
      pricing: { inputPerMTokens: 0, outputPerMTokens: 0 }
    },
    {
      id: "mistral:latest",
      label: "Mistral 7B",
      tier: "balanced",
      pricing: { inputPerMTokens: 0, outputPerMTokens: 0 }
    },
    {
      id: "phi3:latest",
      label: "Phi 3 (tiny, fast)",
      tier: "fast",
      description: "Runs on modest hardware.",
      pricing: { inputPerMTokens: 0, outputPerMTokens: 0 }
    }
  ],

  custom: []
};

export function getCatalogForProvider(providerKind: ProviderKind): readonly ModelCatalogEntry[] {
  return PROVIDER_MODEL_CATALOG[providerKind] ?? [];
}

/**
 * The default model to surface for a provider when the user picks it in the
 * UI. Returns the first entry in the catalog (which is curated to be the
 * "best starting point" for that provider — usually the cost-effective
 * workhorse, not the flagship). Custom providers have no catalog, so
 * callers get null and must require explicit input.
 */
export function getDefaultModelForProvider(providerKind: ProviderKind): string | null {
  const catalog = getCatalogForProvider(providerKind);
  return catalog[0]?.id ?? null;
}

/**
 * Merge a live model list (from the provider's `/v1/models` endpoint) with
 * the static catalog. Live entries override the catalog by id, but the
 * catalog supplies labels/tiers/descriptions/pricing for known models that
 * the live endpoint returns. Unknown live entries get a synthesized label
 * and no pricing (we don't fabricate prices we don't know).
 *
 * Used by the renderer so the dropdown shows everything the user could
 * possibly pick, with rich metadata where we have it and bare ids where
 * we don't.
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
  const liveSet = new Set(liveModelIds);
  const live = liveModelIds.map((id) => byId.get(id)!).filter(Boolean);
  const catalogOnly = catalog.filter((entry) => !liveSet.has(entry.id));
  return [...live, ...catalogOnly];
}
