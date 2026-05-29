import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import {
  getModelAccountById,
  listModelAccounts,
  upsertModelAccount
} from "../src/modelAccounts.js";
import { createSecretCipher, deriveSecretKey, isEncryptedSecret } from "../src/secretCrypto.js";
import { AgentRuntime } from "../src/index.js";

let database: SquidDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

function freshDb(): SquidDatabase {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-acct-"));
  return initializeDatabase(path.join(dir, "squidbot.sqlite"));
}

const cipher = createSecretCipher(deriveSecretKey("unit-test-seed"));

describe("model account apiKey encryption at rest", () => {
  it("persists the apiKey as ciphertext and decrypts it on read", () => {
    database = freshDb();
    const account = upsertModelAccount(
      database,
      { name: "OR", providerKind: "openrouter", apiKey: "sk-super-secret", apiModel: "x/y" },
      cipher
    );

    // The raw DB column must NOT contain the plaintext key.
    const raw = database.db
      .prepare("SELECT apiKey FROM model_accounts WHERE id = ?")
      .get(account.id) as { apiKey: string };
    expect(raw.apiKey).not.toBe("sk-super-secret");
    expect(isEncryptedSecret(raw.apiKey)).toBe(true);

    // The read path decrypts transparently.
    const read = getModelAccountById(database, account.id, cipher);
    expect(read?.apiKey).toBe("sk-super-secret");
    // upsert's own return value is decrypted too.
    expect(account.apiKey).toBe("sk-super-secret");
  });

  it("reads legacy plaintext keys unchanged, then re-encrypts on the next write", () => {
    database = freshDb();
    // Simulate a legacy row written before encryption-at-rest (plaintext column).
    const legacy = upsertModelAccount(
      database,
      { name: "Legacy", providerKind: "custom", apiUrl: "https://e.com/v1", apiKey: "plain-key", apiModel: "m" }
      // NO cipher → stored as plaintext, like an upgraded install.
    );
    const rawBefore = database.db
      .prepare("SELECT apiKey FROM model_accounts WHERE id = ?")
      .get(legacy.id) as { apiKey: string };
    expect(rawBefore.apiKey).toBe("plain-key");

    // Reading WITH a cipher returns the plaintext unchanged (passthrough).
    expect(getModelAccountById(database, legacy.id, cipher)?.apiKey).toBe("plain-key");

    // Re-saving WITH a cipher encrypts it at rest.
    upsertModelAccount(database, { id: legacy.id, name: "Legacy" }, cipher);
    const rawAfter = database.db
      .prepare("SELECT apiKey FROM model_accounts WHERE id = ?")
      .get(legacy.id) as { apiKey: string };
    expect(isEncryptedSecret(rawAfter.apiKey)).toBe(true);
    expect(getModelAccountById(database, legacy.id, cipher)?.apiKey).toBe("plain-key");
  });

  it("listModelAccounts decrypts every account's key", () => {
    database = freshDb();
    upsertModelAccount(database, { name: "A", providerKind: "openrouter", apiKey: "key-a", apiModel: "m" }, cipher);
    upsertModelAccount(database, { name: "B", providerKind: "openrouter", apiKey: "key-b", apiModel: "m" }, cipher);
    const keys = listModelAccounts(database, cipher).map((a) => a.apiKey).sort();
    expect(keys).toEqual(["key-a", "key-b"]);
  });

  it("the runtime decrypts the active account's key before it reaches the HTTP layer", async () => {
    database = freshDb();
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-acct-ws-"));
    upsertModelAccount(
      database,
      {
        name: "OR",
        providerKind: "custom",
        apiUrl: "https://example.com/v1/chat/completions",
        apiKey: "sk-plain-XYZ",
        apiModel: "m",
        activate: true
      },
      cipher
    );
    // Stored encrypted at rest…
    const raw = database.db
      .prepare("SELECT apiKey FROM model_accounts WHERE isActive = 1")
      .get() as { apiKey: string };
    expect(isEncryptedSecret(raw.apiKey)).toBe(true);

    // …but the bearer token sent on the wire must be the DECRYPTED key.
    let capturedAuth = "";
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedAuth = String((init?.headers as Record<string, string> | undefined)?.authorization ?? "");
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "hi", tool_calls: [] } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;
    try {
      const runtime = new AgentRuntime({ database, workspacePath, secretCipher: cipher });
      await runtime.sendMessage("hi");
      expect(capturedAuth).toBe("Bearer sk-plain-XYZ");
    } finally {
      globalThis.fetch = original;
    }
  });
});
