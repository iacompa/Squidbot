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
 * Last reviewed: 2026-05-17. Refresh when providers ship new flagships.
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
      id: "google/gemini-2.5-flash-lite",
      label: "Gemini 2.5 Flash-Lite",
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
      pricing: { inputPerMTokens: 1, outputPerMTokens: 5 }
    },
    {
      id: "anthropic/claude-sonnet-4-6",
      label: "Anthropic · Claude Sonnet 4.6",
      tier: "balanced",
      pricing: { inputPerMTokens: 3, outputPerMTokens: 15 }
    },
    {
      id: "anthropic/claude-opus-4-7",
      label: "Anthropic · Claude Opus 4.7",
      tier: "flagship",
      description: "Most capable Claude — best for hard reasoning and agentic coding.",
      pricing: { inputPerMTokens: 5, outputPerMTokens: 25 }
    },
    {
      id: "openai/gpt-5.5",
      label: "OpenAI · GPT-5.5",
      tier: "flagship",
      pricing: { inputPerMTokens: 5, outputPerMTokens: 30 }
    },
    {
      id: "openai/gpt-5.4-mini",
      label: "OpenAI · GPT-5.4 Mini",
      tier: "fast",
      pricing: { inputPerMTokens: 0.75, outputPerMTokens: 4.5 }
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
      id: "x-ai/grok-4.3",
      label: "xAI · Grok 4.3",
      tier: "flagship",
      pricing: { inputPerMTokens: 1.25, outputPerMTokens: 2.5 }
    }
  ],

  // ---------------- Direct providers (alphabetical) ----------------
  anthropic: [
    {
      id: "anthropic/claude-haiku-4-5",
      label: "Claude Haiku 4.5",
      tier: "fast",
      description: "Cheapest + fastest Claude — great for high-volume work.",
      pricing: { inputPerMTokens: 1, outputPerMTokens: 5 }
    },
    {
      id: "anthropic/claude-sonnet-4-6",
      label: "Claude Sonnet 4.6",
      tier: "balanced",
      description: "Strong default — fast enough for chat, smart enough for code.",
      pricing: { inputPerMTokens: 3, outputPerMTokens: 15 }
    },
    {
      id: "anthropic/claude-sonnet-4-5",
      label: "Claude Sonnet 4.5",
      tier: "balanced",
      pricing: { inputPerMTokens: 3, outputPerMTokens: 15 }
    },
    {
      id: "anthropic/claude-opus-4-7",
      label: "Claude Opus 4.7",
      tier: "flagship",
      description: "Most capable Claude — step-change in agentic coding.",
      pricing: { inputPerMTokens: 5, outputPerMTokens: 25 }
    },
    {
      id: "anthropic/claude-opus-4-6",
      label: "Claude Opus 4.6",
      tier: "flagship",
      pricing: { inputPerMTokens: 5, outputPerMTokens: 25 }
    },
    {
      id: "anthropic/claude-opus-4-5",
      label: "Claude Opus 4.5",
      tier: "legacy",
      pricing: { inputPerMTokens: 5, outputPerMTokens: 25 }
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
      id: "deepseek-v3.1",
      label: "DeepSeek V3.1",
      tier: "balanced",
      description: "V3 refresh — sharper instruction-following, still cheap.",
      pricing: { inputPerMTokens: 0.21, outputPerMTokens: 0.79 }
    },
    {
      id: "deepseek-v3.2",
      label: "DeepSeek V3.2",
      tier: "flagship",
      description: "Latest V3-series flagship — improved coding + reasoning.",
      pricing: { inputPerMTokens: 0.28, outputPerMTokens: 0.42 }
    },
    {
      id: "deepseek-reasoner",
      label: "DeepSeek R1 (reasoning)",
      tier: "reasoning",
      description: "Open-weights reasoning model — multi-step problems, still cheap.",
      pricing: { inputPerMTokens: 0.55, outputPerMTokens: 2.19 }
    }
  ],

  gemini: [
    {
      id: "gemini-2.5-flash-lite",
      label: "Gemini 2.5 Flash-Lite",
      tier: "fast",
      description: "The cheapest + fastest Gemini — great for very high-volume work.",
      pricing: { inputPerMTokens: 0.1, outputPerMTokens: 0.4 }
    },
    {
      id: "gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
      tier: "fast",
      description: "Best price-performance Gemini — strong default for chat traffic.",
      pricing: { inputPerMTokens: 0.3, outputPerMTokens: 2.5 }
    },
    {
      id: "gemini-2.5-pro",
      label: "Gemini 2.5 Pro",
      tier: "flagship",
      description: "Long-context flagship. Strong on reasoning and complex tasks.",
      pricing: { inputPerMTokens: 1.25, outputPerMTokens: 10 }
    },
    {
      id: "gemini-2.0-flash",
      label: "Gemini 2.0 Flash",
      tier: "legacy",
      description: "Deprecated — shuts down June 2026. Migrate to 2.5 Flash.",
      pricing: { inputPerMTokens: 0.1, outputPerMTokens: 0.4 }
    }
  ],

  groq: [
    {
      id: "llama-3.1-8b-instant",
      label: "Llama 3.1 8B Instant",
      tier: "fast",
      description: "Ultra-cheap, ultra-fast for simple work.",
      pricing: { inputPerMTokens: 0.05, outputPerMTokens: 0.08 }
    },
    {
      id: "openai/gpt-oss-20b",
      label: "GPT OSS 20B",
      tier: "fast",
      description: "OpenAI's open-weight 20B served on Groq — ~1000 tok/sec.",
      pricing: { inputPerMTokens: 0.075, outputPerMTokens: 0.3 }
    },
    {
      id: "llama-3.3-70b-versatile",
      label: "Llama 3.3 70B Versatile",
      tier: "flagship",
      description: "Sub-second time-to-first-byte. Great when latency matters.",
      pricing: { inputPerMTokens: 0.59, outputPerMTokens: 0.79 }
    },
    {
      id: "openai/gpt-oss-120b",
      label: "GPT OSS 120B",
      tier: "balanced",
      description: "OpenAI's open-weight 120B — strong + still fast.",
      pricing: { inputPerMTokens: 0.15, outputPerMTokens: 0.6 }
    }
  ],

  openai: [
    {
      id: "gpt-5.4-nano",
      label: "GPT-5.4 Nano",
      tier: "fast",
      description: "Cheapest GPT — good default for routine tasks and tool calls.",
      pricing: { inputPerMTokens: 0.2, outputPerMTokens: 1.25 }
    },
    {
      id: "gpt-5.4-mini",
      label: "GPT-5.4 Mini",
      tier: "fast",
      description: "Mid-tier GPT — fast enough for chat, smart enough for code.",
      pricing: { inputPerMTokens: 0.75, outputPerMTokens: 4.5 }
    },
    {
      id: "gpt-5.4",
      label: "GPT-5.4",
      tier: "balanced",
      description: "Recommended production default — strong on most workloads.",
      pricing: { inputPerMTokens: 2.5, outputPerMTokens: 15 }
    },
    {
      id: "gpt-5.5",
      label: "GPT-5.5",
      tier: "flagship",
      description: "Flagship general-purpose model — most capable GPT.",
      pricing: { inputPerMTokens: 5, outputPerMTokens: 30 }
    },
    {
      id: "gpt-5.5-pro",
      label: "GPT-5.5 Pro",
      tier: "flagship",
      description: "Maximum-capability GPT — research-grade problems, premium pricing.",
      pricing: { inputPerMTokens: 30, outputPerMTokens: 180 }
    },
    {
      id: "o3",
      label: "o3",
      tier: "reasoning",
      description: "Reasoning-focused model — strong on multi-step problems.",
      pricing: { inputPerMTokens: 2, outputPerMTokens: 8 }
    },
    {
      id: "gpt-4o",
      label: "GPT-4o",
      tier: "legacy",
      description: "Previous-generation multimodal — text + image + audio.",
      pricing: { inputPerMTokens: 2.5, outputPerMTokens: 10 }
    },
    {
      id: "gpt-4o-mini",
      label: "GPT-4o Mini",
      tier: "legacy",
      description: "Previous-generation cheap variant.",
      pricing: { inputPerMTokens: 0.15, outputPerMTokens: 0.6 }
    }
  ],

  together: [
    {
      id: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
      label: "Llama 3.1 8B Turbo",
      tier: "fast",
      description: "Cheap + fast — good default for high-volume work.",
      pricing: { inputPerMTokens: 0.18, outputPerMTokens: 0.18 }
    },
    {
      id: "openai/gpt-oss-120b",
      label: "GPT OSS 120B",
      tier: "balanced",
      description: "OpenAI's open-weight 120B served on Together.",
      pricing: { inputPerMTokens: 0.15, outputPerMTokens: 0.6 }
    },
    {
      id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      label: "Llama 3.3 70B Turbo",
      tier: "flagship",
      description: "Open-weights flagship — strong on most workloads.",
      pricing: { inputPerMTokens: 0.88, outputPerMTokens: 0.88 }
    },
    {
      id: "Qwen/Qwen2.5-72B-Instruct-Turbo",
      label: "Qwen 2.5 72B Turbo",
      tier: "balanced",
      description: "Strong on multilingual + reasoning.",
      pricing: { inputPerMTokens: 1.2, outputPerMTokens: 1.2 }
    },
    {
      id: "deepseek-ai/DeepSeek-V3",
      label: "DeepSeek V3",
      tier: "balanced",
      description: "Strong on code generation + general reasoning.",
      pricing: { inputPerMTokens: 1.25, outputPerMTokens: 1.25 }
    }
  ],

  xai: [
    {
      id: "grok-4-1-fast",
      label: "Grok 4.1 Fast",
      tier: "fast",
      description: "Cheapest Grok — great for high-volume work.",
      pricing: { inputPerMTokens: 0.2, outputPerMTokens: 0.5 }
    },
    {
      id: "grok-4.3",
      label: "Grok 4.3",
      tier: "flagship",
      description: "xAI's latest flagship — strong on real-time / current-events knowledge.",
      pricing: { inputPerMTokens: 1.25, outputPerMTokens: 2.5 }
    },
    {
      id: "grok-4.20",
      label: "Grok 4.20 (2M context)",
      tier: "balanced",
      description: "Long-context variant — 2M tokens for big-document workloads.",
      pricing: { inputPerMTokens: 2, outputPerMTokens: 6 }
    },
    {
      id: "grok-4",
      label: "Grok 4",
      tier: "legacy",
      description: "Previous-generation flagship.",
      pricing: { inputPerMTokens: 3, outputPerMTokens: 15 }
    },
    {
      id: "grok-3",
      label: "Grok 3",
      tier: "legacy",
      pricing: { inputPerMTokens: 3, outputPerMTokens: 15 }
    },
    {
      id: "grok-3-mini",
      label: "Grok 3 Mini",
      tier: "legacy",
      description: "Previous-generation cheap variant.",
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
