import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import { MemoryGraphStore } from "../src/index.js";

let database: SquidDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

function createStore(): MemoryGraphStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-sens-"));
  database = initializeDatabase(path.join(dir, "squidbot.sqlite"));
  return new MemoryGraphStore(database);
}

describe("hybridSearch sensitivity scoping (1.6)", () => {
  it("excludes nodes above the caller's maxSensitivity, but returns them when unscoped", () => {
    const store = createStore();
    store.createNode({ type: "fact", title: "Alpha open", body: "the alpha protocol is open and public", sensitivity: "public" });
    store.createNode({ type: "fact", title: "Alpha secret", body: "the alpha protocol is classified secret", sensitivity: "secret" });

    // Scoped to public: the secret node must NOT appear.
    const scoped = store.hybridSearch("alpha protocol", 5, { maxSensitivity: "public" });
    expect(scoped.some((result) => result.node.sensitivity === "secret")).toBe(false);
    expect(scoped.some((result) => result.node.title === "Alpha open")).toBe(true);

    // Unscoped (default): both are returned — sensitivity isn't dropped from storage.
    const unscoped = store.hybridSearch("alpha protocol", 5);
    expect(unscoped.some((result) => result.node.sensitivity === "secret")).toBe(true);
  });
});
