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
  it("includes the major OpenAI-compatible gateways + local Ollama + custom escape hatch", () => {
    const kinds = PROVIDER_PRESETS.map((preset) => preset.kind);
    expect(kinds).toContain("openrouter");
    expect(kinds).toContain("openai");
    expect(kinds).toContain("groq");
    expect(kinds).toContain("ollama");
    expect(kinds).toContain("custom");
    // OpenRouter is the curated default — surface it first.
    expect(kinds[0]).toBe("openrouter");
  });

  it("openrouter preset has a real /v1/chat/completions URL and a Gemini Flash model id", () => {
    const preset = getProviderPreset("openrouter");
    expect(preset.defaultApiUrl).toMatch(/openrouter\.ai\/api\/v1\/chat\/completions$/);
    expect(preset.commonModels.map((model) => model.id)).toContain("google/gemini-2.0-flash-001");
    expect(preset.requiresApiKey).toBe(true);
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
