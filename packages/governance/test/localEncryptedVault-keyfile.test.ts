import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import { LocalEncryptedVault } from "../src/localEncryptedVault.js";

let database: SquidDatabase | null = null;
const ENV_KEY = "SQUIDBOT_LOCAL_SECRET_KEY";
let savedEnv: string | undefined;

afterEach(() => {
  database?.close();
  database = null;
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
});

function freshDb(): { db: SquidDatabase; dir: string } {
  savedEnv = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-vault-"));
  const db = initializeDatabase(path.join(dir, "squidbot.sqlite"));
  return { db, dir };
}

describe("LocalEncryptedVault master key file (1.3 — key out of the DB)", () => {
  it("stores the master key in a 0600 file, never in the settings table", () => {
    const { db, dir } = freshDb();
    database = db;
    const keyFilePath = path.join(dir, "vault.master.key");
    const vault = new LocalEncryptedVault(db, undefined, keyFilePath);
    vault.setSecret("api", "s3cr3t");

    expect(fs.existsSync(keyFilePath)).toBe(true);
    expect(fs.statSync(keyFilePath).mode & 0o777).toBe(0o600);
    const inDb = db.getSetting<string>("vault.localMasterKey");
    expect(inDb === null || inDb === "").toBe(true);
    expect(vault.getSecret("api", { reveal: true }).value).toBe("s3cr3t");
  });

  it("migrates a legacy in-DB key to the file and still decrypts existing secrets", () => {
    const { db, dir } = freshDb();
    database = db;
    // Legacy vault: master key lands in the DB settings table (the 1.3 bug).
    const legacyVault = new LocalEncryptedVault(db);
    legacyVault.setSecret("api", "legacy-secret");
    expect(db.getSetting<string>("vault.localMasterKey")).toBeTruthy();

    // A new vault constructed WITH a keyFilePath migrates the key out of the DB.
    const keyFilePath = path.join(dir, "vault.master.key");
    const migrated = new LocalEncryptedVault(db, undefined, keyFilePath);

    const inDb = db.getSetting<string>("vault.localMasterKey");
    expect(inDb === null || inDb === "").toBe(true);
    expect(fs.existsSync(keyFilePath)).toBe(true);
    // Crucially, the secret written under the OLD key still decrypts — proving
    // the migration preserved the key value rather than generating a new one.
    expect(migrated.getSecret("api", { reveal: true }).value).toBe("legacy-secret");
  });
});
