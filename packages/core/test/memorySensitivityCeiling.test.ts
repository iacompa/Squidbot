import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import { MemoryGraphStore } from "@squidbot/memory";
import { externalModelSensitivityCeiling, getRelevantGraphMemories } from "../src/memory.js";

let database: SquidDatabase | null = null;
afterEach(() => {
  database?.close();
  database = null;
});

describe("externalModelSensitivityCeiling (M4)", () => {
  it("caps to 'restricted' for off-machine provider endpoints", () => {
    expect(externalModelSensitivityCeiling("https://api.anthropic.com/v1/messages")).toBe("restricted");
    expect(externalModelSensitivityCeiling("https://openrouter.ai/api/v1/chat/completions")).toBe("restricted");
  });

  it("returns undefined for local providers and missing URLs (full local access)", () => {
    expect(externalModelSensitivityCeiling("http://localhost:11434/v1/chat/completions")).toBeUndefined();
    expect(externalModelSensitivityCeiling("http://127.0.0.1:1234/v1")).toBeUndefined();
    expect(externalModelSensitivityCeiling(null)).toBeUndefined();
    expect(externalModelSensitivityCeiling(undefined)).toBeUndefined();
    expect(externalModelSensitivityCeiling("not a url")).toBeUndefined();
  });
});

describe("getRelevantGraphMemories sensitivity ceiling (M4)", () => {
  function seed(): SquidDatabase {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-m4-"));
    database = initializeDatabase(path.join(dir, "squidbot.sqlite"));
    const store = new MemoryGraphStore(database);
    store.createNode({ type: "fact", title: "Public note", body: "deploy schedule is public", sensitivity: "public" });
    store.createNode({ type: "fact", title: "Secret cred", body: "deploy secret api credential token", sensitivity: "secret" });
    return database;
  }

  it("excludes secret memories when a ceiling is applied (external model bound)", () => {
    const db = seed();
    const capped = getRelevantGraphMemories(db, "deploy", 10, "restricted");
    expect(capped.some((m) => m.title === "Secret cred")).toBe(false);
    expect(capped.some((m) => m.title === "Public note")).toBe(true);
  });

  it("returns all sensitivities when no ceiling is applied (local model)", () => {
    const db = seed();
    const uncapped = getRelevantGraphMemories(db, "deploy", 10);
    expect(uncapped.some((m) => m.title === "Secret cred")).toBe(true);
  });
});
