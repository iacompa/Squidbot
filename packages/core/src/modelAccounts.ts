import type { SquidDatabase } from "@squidbot/db";
import { createId } from "./types.js";

/**
 * Model accounts are first-class, named records of "where to call an LLM" —
 * URL + API key + model id + optional per-token cost. Users can register
 * multiple accounts (OpenRouter for one project, OpenAI direct for another,
 * a local Ollama for off-hours work) and switch the active one from the
 * Settings UI, the CLI, or by asking SquidBot directly in chat.
 *
 * Exactly one account is active at any time. The migration enforces this
 * with a unique partial index on `isActive = 1`. The `activateAccount`
 * function flips the previously-active row to 0 in the same transaction
 * so the index never temporarily sees two active rows.
 *
 * API keys are stored as plaintext in the row and redacted everywhere they
 * surface (CLI output, trace events, IPC). This matches the existing
 * behaviour of the legacy flat `model.apiKey` setting; a follow-up can
 * migrate them into the encrypted vault.
 */

export type ProviderKind =
  | "openrouter"
  | "openai"
  | "anthropic"
  | "groq"
  | "together"
  | "ollama"
  | "custom";

export type ProviderPreset = {
  /** Stable slug used as `providerKind` on the account row. */
  kind: ProviderKind;
  /** Human-friendly name shown in pickers. */
  displayName: string;
  /** Full chat-completions URL (matches the schema we POST to). */
  defaultApiUrl: string;
  /** Whether the provider needs an API key (false for local Ollama). */
  requiresApiKey: boolean;
  /**
   * Suggested models for this provider — useful for a dropdown picker in
   * the desktop Settings UI. NOT enforced; users can type anything.
   */
  commonModels: Array<{ id: string; label: string; estimatedCostPerToken?: number }>;
  description: string;
};

/**
 * Curated provider presets. The list is intentionally short and biased
 * toward cheap-but-capable models — these are the defaults a new user
 * sees in the "Add account" picker. Anything not on this list is still
 * usable via the "custom" preset.
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    kind: "openrouter",
    displayName: "OpenRouter",
    defaultApiUrl: "https://openrouter.ai/api/v1/chat/completions",
    requiresApiKey: true,
    description: "Universal gateway — one key, hundreds of models. Reports real per-call cost in usage.cost.",
    commonModels: [
      { id: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash (cheap, fast)" },
      { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
      { id: "anthropic/claude-haiku-4", label: "Claude Haiku 4" },
      { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B Instruct" },
      { id: "google/gemini-2.0-flash-exp:free", label: "Gemini 2.0 Flash (FREE tier)" }
    ]
  },
  {
    kind: "openai",
    displayName: "OpenAI (direct)",
    defaultApiUrl: "https://api.openai.com/v1/chat/completions",
    requiresApiKey: true,
    description: "Direct OpenAI API. Use when you have OpenAI credits or org-paid keys.",
    commonModels: [
      { id: "gpt-4o-mini", label: "GPT-4o Mini" },
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-5-mini", label: "GPT-5 Mini (if available)" }
    ]
  },
  {
    kind: "anthropic",
    displayName: "Anthropic (via OpenRouter)",
    defaultApiUrl: "https://openrouter.ai/api/v1/chat/completions",
    requiresApiKey: true,
    description: "Anthropic's native /v1/messages schema is not OpenAI-compatible. Route through OpenRouter for now; the apiModel field accepts `anthropic/claude-...` ids.",
    commonModels: [
      { id: "anthropic/claude-haiku-4", label: "Claude Haiku 4" },
      { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5" }
    ]
  },
  {
    kind: "groq",
    displayName: "Groq",
    defaultApiUrl: "https://api.groq.com/openai/v1/chat/completions",
    requiresApiKey: true,
    description: "Extremely fast inference on open-weights models. OpenAI-compatible endpoint.",
    commonModels: [
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile" },
      { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant" }
    ]
  },
  {
    kind: "together",
    displayName: "Together",
    defaultApiUrl: "https://api.together.xyz/v1/chat/completions",
    requiresApiKey: true,
    description: "Hosted open-weights inference. OpenAI-compatible endpoint.",
    commonModels: [
      { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", label: "Llama 3.3 70B Turbo" },
      { id: "Qwen/Qwen2.5-72B-Instruct-Turbo", label: "Qwen 2.5 72B Turbo" }
    ]
  },
  {
    kind: "ollama",
    displayName: "Local Ollama",
    defaultApiUrl: "http://localhost:11434/v1/chat/completions",
    requiresApiKey: false,
    description: "Local model served by Ollama. Zero cost, runs entirely on your machine.",
    commonModels: [
      { id: "llama3.2", label: "Llama 3.2" },
      { id: "qwen2.5", label: "Qwen 2.5" },
      { id: "mistral", label: "Mistral 7B" }
    ]
  },
  {
    kind: "custom",
    displayName: "Custom OpenAI-compatible endpoint",
    defaultApiUrl: "",
    requiresApiKey: true,
    description: "Any OpenAI-compatible /v1/chat/completions endpoint. Fill in URL, model id, and key by hand.",
    commonModels: []
  }
];

export function getProviderPreset(kind: ProviderKind): ProviderPreset {
  return PROVIDER_PRESETS.find((preset) => preset.kind === kind) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1];
}

// ---------------- Storage types ----------------

export type ModelAccount = {
  id: string;
  name: string;
  providerKind: ProviderKind;
  apiUrl: string;
  /** Plaintext in storage, ALWAYS redacted at display surfaces. */
  apiKey: string | null;
  apiModel: string;
  costPerToken: number;
  dailyBudgetTokens: number | null;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * The "redacted" shape — same as ModelAccount but the apiKey is replaced
 * with a boolean flag. Used by every read path that surfaces an account
 * to humans (CLI, IPC, traces). The plain ModelAccount type stays internal
 * to the router and a few admin actions that need the live key.
 */
export type RedactedModelAccount = Omit<ModelAccount, "apiKey"> & {
  apiKeyConfigured: boolean;
};

export type ModelAccountInput = {
  id?: string;
  name: string;
  providerKind?: ProviderKind;
  apiUrl?: string;
  apiKey?: string | null;
  apiModel?: string;
  costPerToken?: number;
  dailyBudgetTokens?: number | null;
  description?: string | null;
  activate?: boolean;
};

type StoredModelAccount = {
  id: string;
  name: string;
  providerKind: ProviderKind;
  apiUrl: string;
  apiKey: string | null;
  apiModel: string;
  costPerToken: number;
  dailyBudgetTokens: number | null;
  description: string | null;
  isActive: number;
  createdAt: string;
  updatedAt: string;
};

function parseAccount(row: StoredModelAccount): ModelAccount {
  return {
    id: row.id,
    name: row.name,
    providerKind: row.providerKind,
    apiUrl: row.apiUrl,
    apiKey: row.apiKey,
    apiModel: row.apiModel,
    costPerToken: row.costPerToken,
    dailyBudgetTokens: row.dailyBudgetTokens,
    description: row.description,
    isActive: row.isActive === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function redactAccount(account: ModelAccount): RedactedModelAccount {
  const { apiKey, ...rest } = account;
  return { ...rest, apiKeyConfigured: Boolean(apiKey && apiKey.length > 0) };
}

// ---------------- Read paths ----------------

const ACCOUNT_COLUMNS = `id, name, providerKind, apiUrl, apiKey, apiModel,
  costPerToken, dailyBudgetTokens, description, isActive, createdAt, updatedAt`;

export function listModelAccounts(database: SquidDatabase): ModelAccount[] {
  const rows = database.db
    .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM model_accounts ORDER BY isActive DESC, name ASC`)
    .all() as StoredModelAccount[];
  return rows.map(parseAccount);
}

export function getModelAccountById(database: SquidDatabase, id: string): ModelAccount | null {
  const row = database.db
    .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM model_accounts WHERE id = ?`)
    .get(id) as StoredModelAccount | undefined;
  return row ? parseAccount(row) : null;
}

export function getModelAccountByName(database: SquidDatabase, name: string): ModelAccount | null {
  const trimmed = name.trim();
  // Try exact match first, then case-insensitive — useful for chat-driven
  // switching where the model might emit "OpenRouter Gemini" instead of
  // the exact lowercase name.
  const exact = database.db
    .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM model_accounts WHERE name = ?`)
    .get(trimmed) as StoredModelAccount | undefined;
  if (exact) return parseAccount(exact);

  const insensitive = database.db
    .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM model_accounts WHERE LOWER(name) = LOWER(?)`)
    .get(trimmed) as StoredModelAccount | undefined;
  return insensitive ? parseAccount(insensitive) : null;
}

export function getActiveModelAccount(database: SquidDatabase): ModelAccount | null {
  // Active-account migration is *not* idempotent inside this read path —
  // it would break the "no flat settings → no accounts → zero-spend default"
  // contract. The caller is responsible for ensuring legacy migration ran.
  const row = database.db
    .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM model_accounts WHERE isActive = 1 LIMIT 1`)
    .get() as StoredModelAccount | undefined;
  return row ? parseAccount(row) : null;
}

// ---------------- Write paths ----------------

export function upsertModelAccount(database: SquidDatabase, input: ModelAccountInput): ModelAccount {
  const id = input.id ?? createId("model_account");
  const existing = getModelAccountById(database, id);
  const presetKind = input.providerKind ?? existing?.providerKind ?? "custom";
  const preset = getProviderPreset(presetKind);
  const resolvedUrl = input.apiUrl ?? existing?.apiUrl ?? preset.defaultApiUrl;
  const resolvedModel = input.apiModel ?? existing?.apiModel ?? preset.commonModels[0]?.id ?? "byok-openai-compatible";

  if (!resolvedUrl) {
    throw new Error(`API URL is required (provider preset "${presetKind}" has no default).`);
  }
  if (!resolvedModel) {
    throw new Error(`API model id is required.`);
  }
  if (!input.name || !input.name.trim()) {
    throw new Error("Model account name is required.");
  }

  const now = new Date().toISOString();
  const apiKey =
    input.apiKey === null
      ? null
      : input.apiKey ?? existing?.apiKey ?? null;
  const costPerToken = input.costPerToken ?? existing?.costPerToken ?? 0;
  const dailyBudgetTokens = input.dailyBudgetTokens ?? existing?.dailyBudgetTokens ?? null;
  const description = input.description ?? existing?.description ?? null;

  if (existing) {
    database.db
      .prepare(
        `UPDATE model_accounts
         SET name = @name,
             providerKind = @providerKind,
             apiUrl = @apiUrl,
             apiKey = @apiKey,
             apiModel = @apiModel,
             costPerToken = @costPerToken,
             dailyBudgetTokens = @dailyBudgetTokens,
             description = @description,
             updatedAt = @updatedAt
         WHERE id = @id`
      )
      .run({
        id,
        name: input.name.trim(),
        providerKind: presetKind,
        apiUrl: resolvedUrl,
        apiKey,
        apiModel: resolvedModel,
        costPerToken,
        dailyBudgetTokens,
        description,
        updatedAt: now
      });
  } else {
    database.db
      .prepare(
        `INSERT INTO model_accounts (
           id, name, providerKind, apiUrl, apiKey, apiModel,
           costPerToken, dailyBudgetTokens, description,
           isActive, createdAt, updatedAt
         ) VALUES (
           @id, @name, @providerKind, @apiUrl, @apiKey, @apiModel,
           @costPerToken, @dailyBudgetTokens, @description,
           0, @createdAt, @updatedAt
         )`
      )
      .run({
        id,
        name: input.name.trim(),
        providerKind: presetKind,
        apiUrl: resolvedUrl,
        apiKey,
        apiModel: resolvedModel,
        costPerToken,
        dailyBudgetTokens,
        description,
        createdAt: now,
        updatedAt: now
      });
  }

  if (input.activate) {
    activateModelAccount(database, id);
  }

  return getModelAccountById(database, id)!;
}

export function activateModelAccount(database: SquidDatabase, idOrName: string): ModelAccount {
  // Accept either id OR name so the agent tool can pass the human label
  // it's seen in the system prompt.
  const target =
    getModelAccountById(database, idOrName) ?? getModelAccountByName(database, idOrName);
  if (!target) {
    throw new Error(`Model account "${idOrName}" not found.`);
  }
  const now = new Date().toISOString();
  const tx = database.db.transaction(() => {
    database.db.prepare(`UPDATE model_accounts SET isActive = 0, updatedAt = ? WHERE isActive = 1`).run(now);
    database.db
      .prepare(`UPDATE model_accounts SET isActive = 1, updatedAt = ? WHERE id = ?`)
      .run(now, target.id);
  });
  tx();
  return getModelAccountById(database, target.id)!;
}

export function deactivateAllModelAccounts(database: SquidDatabase): void {
  const now = new Date().toISOString();
  database.db.prepare(`UPDATE model_accounts SET isActive = 0, updatedAt = ? WHERE isActive = 1`).run(now);
}

export function deleteModelAccount(database: SquidDatabase, idOrName: string): boolean {
  const target =
    getModelAccountById(database, idOrName) ?? getModelAccountByName(database, idOrName);
  if (!target) return false;
  database.db.prepare(`DELETE FROM model_accounts WHERE id = ?`).run(target.id);
  return true;
}

// ---------------- Legacy migration ----------------

/**
 * One-shot migration: if the legacy flat `model.apiKey` setting is configured
 * AND there are zero model_accounts rows, hydrate the flat settings into a
 * single "Legacy BYOK" account and mark it active. This way operators who
 * upgrade keep working without re-entering their key.
 *
 * Idempotent — safe to call on every router construction.
 */
export function ensureLegacyAccountMigrated(database: SquidDatabase): void {
  const count = (database.db.prepare(`SELECT COUNT(*) as count FROM model_accounts`).get() as { count: number }).count;
  if (count > 0) return;

  const apiKey = database.getSetting<string>("model.apiKey");
  const apiUrl = database.getSetting<string>("model.apiUrl");
  const apiModel = database.getSetting<string>("model.apiModel");
  const provider = database.getSetting<string>("model.provider");

  // Only auto-migrate if the legacy provider was set to "api" AND a key
  // exists. Anything less is a fresh install or a local/mock-only setup —
  // no account needs to be created.
  if (provider !== "api" || !apiKey || apiKey.trim().length === 0) return;

  const resolvedUrl = apiUrl && apiUrl.trim().length > 0 ? apiUrl.trim() : "https://openrouter.ai/api/v1/chat/completions";
  const resolvedModel = apiModel && apiModel.trim().length > 0 ? apiModel.trim() : "google/gemini-2.0-flash-001";
  const providerKind = inferProviderKindFromUrl(resolvedUrl);

  upsertModelAccount(database, {
    name: "Legacy BYOK",
    providerKind,
    apiUrl: resolvedUrl,
    apiKey: apiKey.trim(),
    apiModel: resolvedModel,
    description: "Auto-migrated from legacy model.* settings on first multi-account read.",
    activate: true
  });
}

function inferProviderKindFromUrl(url: string): ProviderKind {
  const lowered = url.toLowerCase();
  if (lowered.includes("openrouter.ai")) return "openrouter";
  if (lowered.includes("api.openai.com")) return "openai";
  if (lowered.includes("api.anthropic.com")) return "anthropic";
  if (lowered.includes("api.groq.com")) return "groq";
  if (lowered.includes("api.together.xyz")) return "together";
  if (lowered.includes("localhost:11434") || lowered.includes("127.0.0.1:11434")) return "ollama";
  return "custom";
}
