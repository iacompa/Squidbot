import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import { MemoryGraphStore } from "../src/index.js";

let database: SquidDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

function createDb(): SquidDatabase {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-embed-"));
  database = initializeDatabase(path.join(dir, "squidbot.sqlite"));
  return database;
}

describe("MemoryGraphStore — pluggable embedding model (M2)", () => {
  it("uses an injected embedder for both vectorization and query, driving retrieval", () => {
    // A deliberately different embedder from the default hash one: a 3-axis
    // one-hot keyed on a keyword. Correct ranking proves the injected model is
    // what's actually used end-to-end (store + query), not the hardcoded one.
    const embed = vi.fn((text: string) => {
      if (/\bvictory\b/i.test(text)) return [1, 0, 0];
      if (/\bocean\b/i.test(text)) return [0, 1, 0];
      return [0, 0, 1];
    });
    const store = new MemoryGraphStore(createDb(), { embed });

    const victory = store.createNode({ type: "fact", title: "V", body: "a tale of victory" });
    store.createNode({ type: "fact", title: "O", body: "deep ocean currents" });

    const results = store.searchVector("victory", 5);
    expect(results[0]?.node.id).toBe(victory.id);
    // The seam is genuinely wired — the injected model was called for storage
    // (createNode → upsertVector) and for the query.
    expect(embed).toHaveBeenCalled();
  });

  it("falls back to the built-in deterministic embedder when none is injected", () => {
    const store = new MemoryGraphStore(createDb());
    const node = store.createNode({ type: "fact", title: "Alpha", body: "the alpha protocol" });
    // Default embedder still produces usable vector retrieval.
    const results = store.searchVector("alpha protocol", 5);
    expect(results.some((result) => result.node.id === node.id)).toBe(true);
  });
});
