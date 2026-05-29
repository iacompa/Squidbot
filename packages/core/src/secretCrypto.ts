import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";

/**
 * Encryption-at-rest for local secrets (BYOK API keys, connector credentials).
 *
 * Values are stored as `enc:v1:<ivB64>:<tagB64>:<ciphertextB64>` using
 * AES-256-GCM. The master key is sourced from OUTSIDE the SQLite database it
 * protects (env var or a 0600 key file) — storing the key in the same DB as
 * the ciphertext would be no better than plaintext.
 *
 * `decryptSecret` passes through non-prefixed (legacy plaintext) values
 * unchanged so existing rows keep working and get re-encrypted on next write.
 */

const ENC_PREFIX = "enc:v1:";
const DEFAULT_ENV_VAR = "SQUIDBOT_LOCAL_SECRET_KEY";

/** Derive a 32-byte AES-256 key from an arbitrary seed string. */
export function deriveSecretKey(seed: string): Buffer {
  return createHash("sha256").update(seed).digest();
}

export function isEncryptedSecret(value: string): boolean {
  return typeof value === "string" && value.startsWith(ENC_PREFIX);
}

export function encryptSecret(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptSecret(key: Buffer, value: string): string {
  if (!isEncryptedSecret(value)) {
    // Legacy plaintext written before encryption-at-rest existed. Return as-is
    // so the value keeps working; the next write will encrypt it.
    return value;
  }
  const [ivB64, tagB64, ctB64] = value.slice(ENC_PREFIX.length).split(":");
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error("Malformed encrypted secret.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

export type MasterKeyOptions = {
  /** Absolute path to the key file. Created with 0600 perms if missing. */
  keyFilePath?: string;
  /** Env var checked first. Default `SQUIDBOT_LOCAL_SECRET_KEY`. */
  envVar?: string;
};

/**
 * Resolve the local master key. Precedence:
 *   1. env var (production / CI inject this)
 *   2. a 0600 key file outside the database (generated once, reused)
 * Throws if neither a usable env var nor a `keyFilePath` is available.
 */
export function loadOrCreateMasterKey(options: MasterKeyOptions = {}): Buffer {
  const envVar = options.envVar ?? DEFAULT_ENV_VAR;
  const fromEnv = process.env[envVar];
  if (fromEnv && fromEnv.length > 0) {
    return deriveSecretKey(fromEnv);
  }

  const keyFilePath = options.keyFilePath;
  if (!keyFilePath) {
    throw new Error(`No master key source: set ${envVar} or provide a keyFilePath.`);
  }

  if (fs.existsSync(keyFilePath)) {
    const seed = fs.readFileSync(keyFilePath, "utf8").trim();
    if (seed.length > 0) {
      return deriveSecretKey(seed);
    }
  }

  const seed = randomBytes(32).toString("base64");
  fs.writeFileSync(keyFilePath, seed, { encoding: "utf8", mode: 0o600 });
  // writeFileSync's mode is subject to umask on some platforms — enforce 0600.
  fs.chmodSync(keyFilePath, 0o600);
  return deriveSecretKey(seed);
}

/** A bound encrypt/decrypt pair, convenient to thread into storage modules. */
export type SecretCipher = {
  encrypt(plaintext: string): string;
  decrypt(value: string): string;
};

export function createSecretCipher(key: Buffer): SecretCipher {
  return {
    encrypt: (plaintext: string) => encryptSecret(key, plaintext),
    decrypt: (value: string) => decryptSecret(key, value)
  };
}
