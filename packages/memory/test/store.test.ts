import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import { MemoryGraphStore, memoryEdgeTypes, memoryNodeTypes } from "../src/index.js";

let database: SquidDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

function createStore(): MemoryGraphStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-memory-"));
  database = initializeDatabase(path.join(dir, "squidbot.sqlite"));
  return new MemoryGraphStore(database);
}

describe("MemoryGraphStore", () => {
  it("creates every supported node and edge type", () => {
    const store = createStore();
    const nodes = memoryNodeTypes.map((type) =>
      store.createNode({
        type,
        title: `${type} node`,
        body: `Body for ${type}`,
        confidence: 0.6,
        importance: 0.7
      })
    );

    for (const type of memoryEdgeTypes) {
      const edge = store.createEdge({
        fromNodeId: nodes[0].id,
        toNodeId: nodes[1].id,
        type
      });
      expect(edge.type).toBe(type);
    }

    expect(store.listNodes()).toHaveLength(memoryNodeTypes.length);
  });

  it("rejects invalid task-to-user contradiction edges", () => {
    const store = createStore();
    const task = store.createNode({ type: "task", title: "Task", body: "Run a task." });
    const user = store.createNode({ type: "user", title: "User", body: "User context." });
    const fact = store.createNode({ type: "fact", title: "Fact", body: "Fact context." });
    const edge = store.createEdge({ fromNodeId: fact.id, toNodeId: task.id, type: "depends_on" });

    expect(() =>
      store.createEdge({
        fromNodeId: task.id,
        toNodeId: user.id,
        type: "contradicts"
      })
    ).toThrow(/cannot contradict/i);
    expect(store.updateEdge(edge.id, { toNodeId: user.id, type: "confirms" })).toMatchObject({
      fromNodeId: fact.id,
      toNodeId: user.id,
      type: "confirms"
    });
  });

  it("merges nodes and redirects active edges", () => {
    const store = createStore();
    const target = store.createNode({ type: "fact", title: "Calculator bug", body: "The add function subtracts." });
    const source = store.createNode({ type: "fact", title: "Addition defect", body: "The plus operation returns subtraction." });
    const decision = store.createNode({ type: "decision", title: "Patch add", body: "Change the add function to use plus." });

    store.createEdge({ fromNodeId: source.id, toNodeId: decision.id, type: "confirms" });
    const merged = store.mergeNodes(target.id, source.id);
    const edges = store.listEdgesForNode(target.id);

    expect(merged.body).toContain(source.body);
    expect(store.getNode(source.id)).toBeNull();
    expect(store.getNode(source.id, { includeDeleted: true })).not.toBeNull();
    expect(edges.some((edge) => edge.fromNodeId === target.id && edge.toNodeId === decision.id)).toBe(true);
    expect(edges.every((edge) => edge.fromNodeId !== source.id && edge.toNodeId !== source.id)).toBe(true);
  });

  it("archives and soft-deletes nodes without returning them in active search", () => {
    const store = createStore();
    const archived = store.createNode({ type: "fact", title: "Archived calculator fact", body: "Calculator archived content." });
    const deleted = store.createNode({ type: "fact", title: "Deleted calculator fact", body: "Calculator deleted content." });
    const active = store.createNode({ type: "fact", title: "Active calculator fact", body: "Calculator active content." });

    store.archiveNode(archived.id);
    store.deleteNode(deleted.id);

    const resultIds = store.searchFTS("calculator", 10).map((result) => result.node.id);
    expect(resultIds).toContain(active.id);
    expect(resultIds).not.toContain(archived.id);
    expect(resultIds).not.toContain(deleted.id);
  });

  it("supports FTS, local vector, traversal, and hybrid retrieval", () => {
    const store = createStore();
    const fact = store.createNode({
      type: "fact",
      title: "Calculator bug: add subtracts",
      body: "In calculator.py, the add function subtracts instead of adding.",
      importance: 0.8
    });
    const decision = store.createNode({
      type: "decision",
      title: "Fix calculator add",
      body: "Change the calculator add implementation to return a plus b.",
      importance: 0.65
    });
    store.createNode({
      type: "fact",
      title: "Sales connector fixture",
      body: "Demo sales connector returns local records.",
      importance: 0.5
    });
    store.createEdge({ fromNodeId: decision.id, toNodeId: fact.id, type: "depends_on" });

    expect(store.searchFTS("calculator", 5).map((result) => result.node.id)).toContain(fact.id);
    expect(store.searchVector("addition defect", 2)[0]?.node.id).toBe(fact.id);
    expect(store.traverse(fact.id, 1).nodes.map((node) => node.id)).toContain(decision.id);
    expect(store.hybridSearch("addition defect", 5).map((result) => result.node.id)).toContain(decision.id);
  });
});
