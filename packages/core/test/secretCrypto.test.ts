import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptSecret,
  deriveSecretKey,
  encryptSecret,
  isEncryptedSecret,
  loadOrCreateMasterKey
} from "../src/secretCrypto.js";

const ENV_KEY = "SQUIDBOT_LOCAL_SECRET_KEY";
let savedEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
});

describe("secretCrypto", () => {
  it("round-trips a value through encrypt → decrypt", () => {
    const key = deriveSecretKey("seed-abc");
    const cipher = encryptSecret(key, "sk-super-secret-123");
    expect(cipher).not.toContain("sk-super-secret-123");
    expect(isEncryptedSecret(cipher)).toBe(true);
    expect(decryptSecret(key, cipher)).toBe("sk-super-secret-123");
  });

  it("treats a non-prefixed value as legacy plaintext and returns it unchanged", () => {
    const key = deriveSecretKey("seed-abc");
    expect(isEncryptedSecret("sk-plaintext-legacy")).toBe(false);
    expect(decryptSecret(key, "sk-plaintext-legacy")).toBe("sk-plaintext-legacy");
  });

  it("cannot decrypt ciphertext produced with a different master key", () => {
    const a = deriveSecretKey("seed-a");
    const b = deriveSecretKey("seed-b");
    const cipher = encryptSecret(a, "value");
    expect(() => decryptSecret(b, cipher)).toThrow();
  });

  it("loadOrCreateMasterKey prefers the env var when set", () => {
    process.env[ENV_KEY] = "env-provided-seed";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-key-"));
    const keyFile = path.join(dir, "secret.key");
    const k1 = loadOrCreateMasterKey({ keyFilePath: keyFile });
    // env wins → no key file written
    expect(fs.existsSync(keyFile)).toBe(false);
    const k2 = loadOrCreateMasterKey({ keyFilePath: keyFile });
    expect(k1.equals(k2)).toBe(true);
  });

  it("loadOrCreateMasterKey generates a 0600 key file when none exists and reuses it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-key-"));
    const keyFile = path.join(dir, "secret.key");
    const k1 = loadOrCreateMasterKey({ keyFilePath: keyFile });
    expect(fs.existsSync(keyFile)).toBe(true);
    // 0600 permissions (owner read/write only)
    const mode = fs.statSync(keyFile).mode & 0o777;
    expect(mode).toBe(0o600);
    // Reused on the next call (same derived key)
    const k2 = loadOrCreateMasterKey({ keyFilePath: keyFile });
    expect(k1.equals(k2)).toBe(true);
  });
});
