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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-contra-"));
  database = initializeDatabase(path.join(dir, "squidbot.sqlite"));
  return new MemoryGraphStore(database);
}

describe("MemoryGraphStore.detectContradictions (M3 / 1.4)", () => {
  it("surfaces a same-subject, polarity-flipped peer as a candidate", () => {
    const store = createStore();
    const a = store.createNode({ type: "decision", title: "Deploy policy", body: "We always deploy on Fridays." });
    const b = store.createNode({ type: "decision", title: "Deploy policy", body: "We never deploy on Fridays." });
    store.createNode({ type: "decision", title: "Testing", body: "Write unit tests for the API." });

    const candidates = store.detectContradictions(a.id);
    expect(candidates.map((c) => c.node.id)).toContain(b.id);
    expect(candidates[0].node.id).toBe(b.id);
    expect(candidates[0].evidence.polaritySignals.length).toBeGreaterThan(0);
  });

  it("does not surface paraphrases or unrelated nodes", () => {
    const store = createStore();
    const a = store.createNode({ type: "decision", title: "Deploy policy", body: "We deploy on Fridays." });
    store.createNode({ type: "decision", title: "Deploy policy", body: "Deployments happen on Fridays." });
    store.createNode({ type: "decision", title: "Testing", body: "Write unit tests for the API." });

    expect(store.detectContradictions(a.id)).toHaveLength(0);
  });

  it("only compares peers of the same node type", () => {
    const store = createStore();
    const decision = store.createNode({ type: "decision", title: "Deploy policy", body: "We always deploy on Fridays." });
    // Same words, opposite polarity, but a different node type — not a peer.
    store.createNode({ type: "fact", title: "Deploy policy", body: "We never deploy on Fridays." });

    expect(store.detectContradictions(decision.id)).toHaveLength(0);
  });

  it("excludes peers already linked by a contradicts edge (no re-prompt after review)", () => {
    const store = createStore();
    const a = store.createNode({ type: "decision", title: "Deploy policy", body: "We always deploy on Fridays." });
    const b = store.createNode({ type: "decision", title: "Deploy policy", body: "We never deploy on Fridays." });
    store.createEdge({ fromNodeId: a.id, toNodeId: b.id, type: "contradicts" });

    expect(store.detectContradictions(a.id)).toHaveLength(0);
  });
});
