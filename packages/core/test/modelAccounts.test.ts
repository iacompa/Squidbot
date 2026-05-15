import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import {
  activateModelAccount,
  deleteModelAccount,
  ensureLegacyAccountMigrated,
  getActiveModelAccount,
  getModelAccountByName,
  getProviderPreset,
  listModelAccounts,
  PROVIDER_PRESETS,
  redactAccount,
  upsertModelAccount
} from "../src/index.js";

let database: SquidDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

function fresh(): SquidDatabase {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-mac-"));
  return initializeDatabase(path.join(dir, "squidbot.sqlite"));
}

describe("PROVIDER_PRESETS", () => {
  it("includes a model-neutral set of direct providers + the OpenRouter gateway + Ollama + custom escape hatch", () => {
    const kinds = PROVIDER_PRESETS.map((preset) => preset.kind);
    // Gateway
    expect(kinds).toContain("openrouter");
    // Direct providers we ship presets for
    expect(kinds).toContain("openai");
    expect(kinds).toContain("anthropic");
    expect(kinds).toContain("xai");
    expect(kinds).toContain("gemini");
    expect(kinds).toContain("deepseek");
    expect(kinds).toContain("groq");
    expect(kinds).toContain("together");
    // BYO infrastructure
    expect(kinds).toContain("ollama");
    expect(kinds).toContain("custom");
    // OpenRouter is the curated default — surface it first as the all-in-one
    // gateway. Everything after it is model-neutral by design.
    expect(kinds[0]).toBe("openrouter");
  });

  it("openrouter preset has a real /v1/chat/completions URL and a curated cheap model", () => {
    const preset = getProviderPreset("openrouter");
    expect(preset.defaultApiUrl).toMatch(/openrouter\.ai\/api\/v1\/chat\/completions$/);
    // The curated list should include at least one obviously cheap Gemini Flash
    // variant — the exact id evolves, so we match on the family rather than
    // pinning a specific build (those rotate when Google ships new versions).
    const ids = preset.commonModels.map((model) => model.id);
    expect(ids.some((id) => /gemini-2\.\d+-flash/.test(id))).toBe(true);
    expect(preset.requiresApiKey).toBe(true);
  });

  it("xai preset points at the xAI endpoint and lists at least one Grok model", () => {
    // Grok and Groq are different products — verify we ship the Grok preset
    // separately and that its URL is xAI's, not Groq's LPU host.
    const preset = getProviderPreset("xai");
    expect(preset.defaultApiUrl).toMatch(/api\.x\.ai\/v1\/chat\/completions$/);
    expect(preset.commonModels.some((m) => m.id.startsWith("grok"))).toBe(true);
    // Sanity: Groq's URL must NOT match xAI's.
    expect(getProviderPreset("groq").defaultApiUrl).not.toMatch(/api\.x\.ai/);
  });

  it("gemini preset uses Google's OpenAI-compatible endpoint", () => {
    const preset = getProviderPreset("gemini");
    expect(preset.defaultApiUrl).toMatch(/generativelanguage\.googleapis\.com/);
    expect(preset.commonModels.some((m) => m.id.startsWith("gemini-"))).toBe(true);
  });

  it("deepseek preset advertises the very-cheap default model", () => {
    const preset = getProviderPreset("deepseek");
    expect(preset.defaultApiUrl).toMatch(/api\.deepseek\.com/);
    expect(preset.commonModels.some((m) => m.id === "deepseek-chat")).toBe(true);
  });

  it("custom preset description is model-neutral (does not lead with 'OpenAI')", () => {
    // The user explicitly flagged the old "Custom OpenAI-compatible endpoint"
    // label as making SquidBot feel OpenAI-biased. The replacement label and
    // description should not lead with "OpenAI".
    const preset = getProviderPreset("custom");
    expect(preset.displayName.toLowerCase()).not.toContain("openai");
  });

  it("ollama preset does not require an API key", () => {
    expect(getProviderPreset("ollama").requiresApiKey).toBe(false);
  });
});

describe("modelAccounts CRUD", () => {
  it("creates an account from a preset and persists fields", () => {
    database = fresh();
    const account = upsertModelAccount(database, {
      name: "OR Gemini",
      providerKind: "openrouter",
      apiKey: "sk-or-test",
      apiModel: "google/gemini-2.0-flash-001"
    });
    expect(account.providerKind).toBe("openrouter");
    // URL filled in from the preset.
    expect(account.apiUrl).toMatch(/openrouter\.ai\/api\/v1\/chat\/completions$/);
    expect(account.apiModel).toBe("google/gemini-2.0-flash-001");
    expect(account.isActive).toBe(false);
  });

  it("rejects empty name", () => {
    database = fresh();
    expect(() =>
      upsertModelAccount(database!, { name: "  ", providerKind: "openrouter", apiKey: "x", apiModel: "y" })
    ).toThrow(/name is required/i);
  });

  it("requires apiUrl when the preset is custom and no URL is given", () => {
    database = fresh();
    expect(() =>
      upsertModelAccount(database!, {
        name: "Custom",
        providerKind: "custom",
        apiKey: "x",
        apiModel: "y"
      })
    ).toThrow(/API URL is required/);
  });

  it("activates exactly one account at a time", () => {
    database = fresh();
    const a = upsertModelAccount(database, {
      name: "OR Gemini",
      providerKind: "openrouter",
      apiKey: "k1",
      apiModel: "google/gemini-2.0-flash-001",
      activate: true
    });
    const b = upsertModelAccount(database, {
      name: "OpenAI Mini",
      providerKind: "openai",
      apiKey: "k2",
      apiModel: "gpt-4o-mini",
      activate: true
    });
    const active = getActiveModelAccount(database);
    expect(active?.id).toBe(b.id);
    // Reactivating the previous one flips back exclusively.
    activateModelAccount(database, a.name);
    const accounts = listModelAccounts(database);
    expect(accounts.filter((account) => account.isActive)).toHaveLength(1);
    expect(getActiveModelAccount(database)?.name).toBe("OR Gemini");
  });

  it("case-insensitive lookup by name (helpful for chat-driven switching)", () => {
    database = fresh();
    upsertModelAccount(database, {
      name: "OR Gemini",
      providerKind: "openrouter",
      apiKey: "k1",
      apiModel: "google/gemini-2.0-flash-001"
    });
    expect(getModelAccountByName(database, "or gemini")?.name).toBe("OR Gemini");
    expect(getModelAccountByName(database, "Or GeminI")?.name).toBe("OR Gemini");
  });

  it("redacts the apiKey when emitting accounts to display surfaces", () => {
    database = fresh();
    const account = upsertModelAccount(database, {
      name: "OR Gemini",
      providerKind: "openrouter",
      apiKey: "sk-or-supersecret",
      apiModel: "google/gemini-2.0-flash-001"
    });
    const redacted = redactAccount(account);
    expect(redacted).not.toHaveProperty("apiKey");
    expect(redacted.apiKeyConfigured).toBe(true);
    // Account with no key reads as apiKeyConfigured=false.
    const ollama = upsertModelAccount(database, {
      name: "local",
      providerKind: "ollama",
      apiModel: "llama3.2"
    });
    expect(redactAccount(ollama).apiKeyConfigured).toBe(false);
  });

  it("delete returns true on success and false when the row didn't exist", () => {
    database = fresh();
    upsertModelAccount(database, {
      name: "OR Gemini",
      providerKind: "openrouter",
      apiKey: "k1",
      apiModel: "google/gemini-2.0-flash-001"
    });
    expect(deleteModelAccount(database, "OR Gemini")).toBe(true);
    expect(deleteModelAccount(database, "does-not-exist")).toBe(false);
  });
});

describe("ensureLegacyAccountMigrated", () => {
  it("hydrates legacy flat model.* settings into a single active account on first call", () => {
    database = fresh();
    database.setSetting("model.provider", "api");
    database.setSetting("model.apiKey", "sk-or-legacy");
    database.setSetting("model.apiUrl", "https://openrouter.ai/api/v1/chat/completions");
    database.setSetting("model.apiModel", "google/gemini-2.0-flash-001");

    ensureLegacyAccountMigrated(database);
    const accounts = listModelAccounts(database);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      name: "Legacy BYOK",
      providerKind: "openrouter", // inferred from URL
      apiModel: "google/gemini-2.0-flash-001",
      isActive: true
    });
    // Idempotent — second call does not create a duplicate.
    ensureLegacyAccountMigrated(database);
    expect(listModelAccounts(database)).toHaveLength(1);
  });

  it("does NOT auto-migrate when model.provider is not 'api' (fresh installs / mock-only)", () => {
    database = fresh();
    database.setSetting("model.provider", "mock");
    database.setSetting("model.apiKey", ""); // empty key — no real setup
    ensureLegacyAccountMigrated(database);
    expect(listModelAccounts(database)).toHaveLength(0);
  });

  it("does NOT auto-migrate when an account already exists", () => {
    database = fresh();
    upsertModelAccount(database, {
      name: "Existing",
      providerKind: "openrouter",
      apiKey: "k",
      apiModel: "google/gemini-2.0-flash-001",
      activate: true
    });
    database.setSetting("model.provider", "api");
    database.setSetting("model.apiKey", "should-not-be-imported");
    ensureLegacyAccountMigrated(database);
    expect(listModelAccounts(database)).toHaveLength(1);
    expect(getActiveModelAccount(database)?.name).toBe("Existing");
  });
});
