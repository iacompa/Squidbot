import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeDatabase } from "@squidbot/db";
import {
  exportMigrationBundle,
  importMigrationBundle,
  checkForUpdates,
  type MigrationBundle
} from "../src/migrate.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-d2-"));
  tempDirs.push(dir);
  const db = initializeDatabase(path.join(dir, "squidbot.sqlite"));
  db.setSetting("model.provider", "local");
  db.setSetting("custom.key", "custom-value");
  return db;
}

describe("exportMigrationBundle (D2)", () => {
  it("exports settings and metadata to a portable bundle", () => {
    const db = tempDb();
    const bundle = exportMigrationBundle(db);
    expect(bundle.schemaVersion).toBeTruthy();
    expect(bundle.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(bundle.settings).toMatchObject({ "model.provider": "local", "custom.key": "custom-value" });
  });

  it("bundle serialises to valid JSON that can round-trip", () => {
    const db = tempDb();
    const json = JSON.stringify(exportMigrationBundle(db));
    const parsed = JSON.parse(json) as MigrationBundle;
    expect(parsed.settings["model.provider"]).toBe("local");
  });
});

describe("importMigrationBundle (D2)", () => {
  it("restores settings from a bundle into a fresh database", () => {
    const source = tempDb();
    const bundle = exportMigrationBundle(source);
    source.close();

    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-d2-import-"));
    tempDirs.push(dir2);
    const dest = initializeDatabase(path.join(dir2, "squidbot.sqlite"));
    importMigrationBundle(dest, bundle);

    expect(dest.getSetting("model.provider")).toBe("local");
    expect(dest.getSetting("custom.key")).toBe("custom-value");
    dest.close();
  });

  it("does NOT overwrite a setting that already exists in the destination (import is additive)", () => {
    const source = tempDb();
    const bundle = exportMigrationBundle(source);
    source.close();

    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-d2-additive-"));
    tempDirs.push(dir2);
    const dest = initializeDatabase(path.join(dir2, "squidbot.sqlite"));
    dest.setSetting("model.provider", "api");
    importMigrationBundle(dest, bundle, { overwrite: false });

    expect(dest.getSetting("model.provider")).toBe("api");
    dest.close();
  });
});

describe("checkForUpdates (D2)", () => {
  it("returns up-to-date when current version matches the registry", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ "dist-tags": { latest: "0.1.0" } }), { status: 200 }));
    const result = await checkForUpdates("0.1.0");
    expect(result.upToDate).toBe(true);
    expect(result.current).toBe("0.1.0");
  });

  it("returns update available when registry has a newer version", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ "dist-tags": { latest: "0.2.0" } }), { status: 200 }));
    const result = await checkForUpdates("0.1.0");
    expect(result.upToDate).toBe(false);
    expect(result.latest).toBe("0.2.0");
  });

  it("returns unknown when the registry is unreachable", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("network error"); });
    const result = await checkForUpdates("0.1.0");
    expect(result.upToDate).toBeNull();
    expect(result.error).toBeTruthy();
  });
});
