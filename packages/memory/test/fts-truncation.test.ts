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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-fts-"));
  database = initializeDatabase(path.join(dir, "squidbot.sqlite"));
  return new MemoryGraphStore(database);
}

describe("searchFTS query-term coverage", () => {
  it("does not silently drop a distinctive term that appears past the 12th token", () => {
    const store = createStore();
    store.createNode({ type: "fact", title: "Reactor status", body: "The zephyrium core is stable." });

    // Twelve non-matching filler tokens, then the only term that can match as
    // the 13th. The old code sliced to 12 tokens and dropped it entirely.
    const query = "qqaa qqbb qqcc qqdd qqee qqff qqgg qqhh qqii qqjj qqkk qqll zephyrium";
    const results = store.searchFTS(query, 5);

    expect(results.some((result) => result.node.title === "Reactor status")).toBe(true);
  });
});
