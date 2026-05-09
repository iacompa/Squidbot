import type { SquidDatabase } from "@squidbot/db";

export const memoryNodeTypes = [
  "user",
  "goal",
  "task",
  "fact",
  "skill",
  "decision",
  "preference",
  "reflection",
  "risk"
] as const;

export const memoryEdgeTypes = ["updates", "depends_on", "contradicts", "confirms", "caused_by", "part_of"] as const;
export const memorySensitivityLevels = ["public", "restricted", "secret"] as const;

export type MemoryNodeType = (typeof memoryNodeTypes)[number];
export type MemoryEdgeType = (typeof memoryEdgeTypes)[number];
export type MemorySensitivity = (typeof memorySensitivityLevels)[number];

export type MemoryNodeRecord = {
  id: string;
  type: MemoryNodeType;
  title: string;
  body: string;
  confidence: number;
  importance: number;
  sensitivity: MemorySensitivity;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
  affordanceId: string | null;
};

export type MemoryEdgeRecord = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: MemoryEdgeType;
  createdAt: string;
  deletedAt: string | null;
};

export type MemorySearchResult = {
  node: MemoryNodeRecord;
  score: number;
  source: "fts" | "vector" | "hybrid" | "graph";
  rank: number;
};

export type MemoryTraversalResult = {
  nodes: MemoryNodeRecord[];
  edges: MemoryEdgeRecord[];
};

export type CreateMemoryNodeInput = {
  id?: string;
  type: MemoryNodeType | string;
  title: string;
  body: string;
  confidence?: number;
  importance?: number;
  sensitivity?: MemorySensitivity | string;
  createdAt?: string;
  affordanceId?: string | null;
};

export type UpdateMemoryNodeInput = Partial<{
  type: MemoryNodeType | string;
  title: string;
  body: string;
  confidence: number;
  importance: number;
  sensitivity: MemorySensitivity | string;
}>;

export type CreateMemoryEdgeInput = {
  id?: string;
  fromNodeId: string;
  toNodeId: string;
  type: MemoryEdgeType | string;
  createdAt?: string;
};

export type UpdateMemoryEdgeInput = Partial<{
  fromNodeId: string;
  toNodeId: string;
  type: MemoryEdgeType | string;
}>;

type StoredMemoryNode = {
  id: string;
  type: string;
  title: string;
  body: string;
  confidence: number;
  importance: number;
  sensitivity: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
  affordanceId: string | null;
};

type StoredMemoryEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: string;
  createdAt: string;
  deletedAt: string | null;
};

const VECTOR_DIMENSIONS = 96;
const RRF_K = 60;

export class MemoryGraphStore {
  private readonly database: SquidDatabase;

  constructor(database: SquidDatabase) {
    this.database = database;
  }

  createNode(input: CreateMemoryNodeInput): MemoryNodeRecord {
    const now = input.createdAt ?? new Date().toISOString();
    const node = {
      id: input.id ?? createMemoryId("memory_node"),
      type: assertNodeType(input.type),
      title: assertNonEmpty(input.title, "title"),
      body: assertNonEmpty(input.body, "body"),
      confidence: normalizeScore(input.confidence ?? 0.5, "confidence"),
      importance: normalizeScore(input.importance ?? 0.5, "importance"),
      sensitivity: assertSensitivity(input.sensitivity ?? "public"),
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      deletedAt: null,
      affordanceId: input.affordanceId ?? null
    };

    this.database.db
      .prepare(
        `INSERT INTO memories_nodes (
          id, type, title, body, confidence, importance, sensitivity, createdAt, updatedAt, archivedAt, deletedAt, affordanceId
        )
        VALUES (
          @id, @type, @title, @body, @confidence, @importance, @sensitivity, @createdAt, @updatedAt, @archivedAt, @deletedAt, @affordanceId
        )`
      )
      .run(node);
    this.upsertVector(node);
    return node;
  }

  updateNode(nodeId: string, input: UpdateMemoryNodeInput): MemoryNodeRecord {
    const current = this.requireNode(nodeId, { includeArchived: true });
    const updated: MemoryNodeRecord = {
      ...current,
      type: input.type === undefined ? current.type : assertNodeType(input.type),
      title: input.title === undefined ? current.title : assertNonEmpty(input.title, "title"),
      body: input.body === undefined ? current.body : assertNonEmpty(input.body, "body"),
      confidence: input.confidence === undefined ? current.confidence : normalizeScore(input.confidence, "confidence"),
      importance: input.importance === undefined ? current.importance : normalizeScore(input.importance, "importance"),
      sensitivity: input.sensitivity === undefined ? current.sensitivity : assertSensitivity(input.sensitivity),
      updatedAt: new Date().toISOString()
    };

    this.database.db
      .prepare(
        `UPDATE memories_nodes
         SET type = @type,
             title = @title,
             body = @body,
             confidence = @confidence,
             importance = @importance,
             sensitivity = @sensitivity,
             updatedAt = @updatedAt
         WHERE id = @id`
      )
      .run(updated);
    this.upsertVector(updated);
    return this.requireNode(nodeId, { includeArchived: true });
  }

  archiveNode(nodeId: string): MemoryNodeRecord {
    const now = new Date().toISOString();
    this.requireNode(nodeId, { includeArchived: true });
    this.database.db
      .prepare("UPDATE memories_nodes SET archivedAt = @now, updatedAt = @now WHERE id = @nodeId AND deletedAt IS NULL")
      .run({ nodeId, now });
    return this.requireNode(nodeId, { includeArchived: true });
  }

  deleteNode(nodeId: string): MemoryNodeRecord {
    const now = new Date().toISOString();
    this.requireNode(nodeId, { includeArchived: true });
    const transaction = this.database.db.transaction(() => {
      this.database.db
        .prepare("UPDATE memories_nodes SET deletedAt = @now, updatedAt = @now WHERE id = @nodeId AND deletedAt IS NULL")
        .run({ nodeId, now });
      this.database.db
        .prepare(
          `UPDATE memories_edges
           SET deletedAt = @now
           WHERE deletedAt IS NULL
             AND (fromNodeId = @nodeId OR toNodeId = @nodeId)`
        )
        .run({ nodeId, now });
    });
    transaction();
    return this.requireNode(nodeId, { includeDeleted: true, includeArchived: true });
  }

  createEdge(input: CreateMemoryEdgeInput): MemoryEdgeRecord {
    const from = this.requireNode(input.fromNodeId);
    const to = this.requireNode(input.toNodeId);
    const type = assertEdgeType(input.type);
    validateRelationship(from, to, type);
    const edge = {
      id: input.id ?? createMemoryId("memory_edge"),
      fromNodeId: from.id,
      toNodeId: to.id,
      type,
      createdAt: input.createdAt ?? new Date().toISOString(),
      deletedAt: null
    };

    this.database.db
      .prepare(
        `INSERT INTO memories_edges (id, fromNodeId, toNodeId, type, createdAt, deletedAt)
         VALUES (@id, @fromNodeId, @toNodeId, @type, @createdAt, @deletedAt)`
      )
      .run(edge);
    return edge;
  }

  deleteEdge(edgeId: string): MemoryEdgeRecord {
    const edge = this.requireEdge(edgeId);
    const now = new Date().toISOString();
    this.database.db.prepare("UPDATE memories_edges SET deletedAt = @now WHERE id = @edgeId").run({ edgeId, now });
    return { ...edge, deletedAt: now };
  }

  updateEdge(edgeId: string, input: UpdateMemoryEdgeInput): MemoryEdgeRecord {
    const current = this.requireEdge(edgeId);
    const from = this.requireNode(input.fromNodeId ?? current.fromNodeId);
    const to = this.requireNode(input.toNodeId ?? current.toNodeId);
    const type = input.type === undefined ? current.type : assertEdgeType(input.type);
    validateRelationship(from, to, type);
    this.database.db
      .prepare(
        `UPDATE memories_edges
         SET fromNodeId = @fromNodeId,
             toNodeId = @toNodeId,
             type = @type
         WHERE id = @id
           AND deletedAt IS NULL`
      )
      .run({ id: edgeId, fromNodeId: from.id, toNodeId: to.id, type });
    return this.requireEdge(edgeId);
  }

  mergeNodes(targetNodeId: string, sourceNodeId: string): MemoryNodeRecord {
    if (targetNodeId === sourceNodeId) {
      throw new Error("Cannot merge a node into itself.");
    }

    const now = new Date().toISOString();
    const transaction = this.database.db.transaction(() => {
      const target = this.requireNode(targetNodeId, { includeArchived: true });
      const source = this.requireNode(sourceNodeId, { includeArchived: true });
      const mergedBody = target.body.includes(source.body)
        ? target.body
        : `${target.body}\n\nMerged from ${source.id}: ${source.body}`;
      const mergedTitle = target.title.includes(source.title) ? target.title : `${target.title} / ${source.title}`;
      this.database.db
        .prepare(
          `UPDATE memories_nodes
           SET title = @title,
               body = @body,
               confidence = @confidence,
               importance = @importance,
               updatedAt = @now
           WHERE id = @id`
        )
        .run({
          id: target.id,
          title: mergedTitle,
          body: mergedBody,
          confidence: Math.max(target.confidence, source.confidence),
          importance: Math.max(target.importance, source.importance),
          now
        });

      const edges = this.listEdgesForNode(source.id, { includeDeleted: false });
      for (const edge of edges) {
        const fromNodeId = edge.fromNodeId === source.id ? target.id : edge.fromNodeId;
        const toNodeId = edge.toNodeId === source.id ? target.id : edge.toNodeId;
        if (fromNodeId === toNodeId || this.hasActiveEdge(fromNodeId, toNodeId, edge.type)) {
          this.database.db.prepare("UPDATE memories_edges SET deletedAt = @now WHERE id = @id").run({ id: edge.id, now });
        } else {
          this.database.db
            .prepare("UPDATE memories_edges SET fromNodeId = @fromNodeId, toNodeId = @toNodeId WHERE id = @id")
            .run({ id: edge.id, fromNodeId, toNodeId });
        }
      }

      this.database.db
        .prepare("UPDATE memories_nodes SET deletedAt = @now, updatedAt = @now WHERE id = @sourceNodeId")
        .run({ sourceNodeId, now });
    });
    transaction();

    const updated = this.requireNode(targetNodeId, { includeArchived: true });
    this.upsertVector(updated);
    return updated;
  }

  getNode(nodeId: string, options: { includeDeleted?: boolean; includeArchived?: boolean } = {}): MemoryNodeRecord | null {
    const row = this.database.db.prepare("SELECT * FROM memories_nodes WHERE id = ?").get(nodeId) as StoredMemoryNode | undefined;
    if (!row) {
      return null;
    }

    const node = parseNode(row);
    if (!options.includeDeleted && node.deletedAt) {
      return null;
    }
    if (!options.includeArchived && node.archivedAt) {
      return null;
    }
    return node;
  }

  listNodes(options: { type?: string; includeDeleted?: boolean; includeArchived?: boolean; limit?: number } = {}): MemoryNodeRecord[] {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {
      limit: options.limit ?? 100
    };
    if (!options.includeDeleted) {
      clauses.push("deletedAt IS NULL");
    }
    if (!options.includeArchived) {
      clauses.push("archivedAt IS NULL");
    }
    if (options.type) {
      params.type = assertNodeType(options.type);
      clauses.push("type = @type");
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.database.db
      .prepare(`SELECT * FROM memories_nodes ${where} ORDER BY importance DESC, updatedAt DESC LIMIT @limit`)
      .all(params) as StoredMemoryNode[];
    return rows.map(parseNode);
  }

  getEdge(edgeId: string): MemoryEdgeRecord | null {
    const row = this.database.db.prepare("SELECT * FROM memories_edges WHERE id = ?").get(edgeId) as StoredMemoryEdge | undefined;
    return row ? parseEdge(row) : null;
  }

  listEdgesForNode(nodeId: string, options: { includeDeleted?: boolean } = {}): MemoryEdgeRecord[] {
    const rows = this.database.db
      .prepare(
        `SELECT *
         FROM memories_edges
         WHERE (fromNodeId = @nodeId OR toNodeId = @nodeId)
           ${options.includeDeleted ? "" : "AND deletedAt IS NULL"}
         ORDER BY createdAt ASC`
      )
      .all({ nodeId }) as StoredMemoryEdge[];
    return rows.map(parseEdge);
  }

  searchFTS(query: string, topK = 10): MemorySearchResult[] {
    const ftsQuery = toFtsQuery(query);
    if (!ftsQuery) {
      return this.listNodes({ limit: topK }).map((node, index) => ({
        node,
        score: 1 / (index + 1),
        source: "fts",
        rank: index + 1
      }));
    }

    const rows = this.database.db
      .prepare(
        `SELECT n.*, bm25(memories_nodes_fts) AS rankScore
         FROM memories_nodes_fts
         JOIN memories_nodes n ON n.rowid = memories_nodes_fts.rowid
         WHERE memories_nodes_fts MATCH @query
           AND n.deletedAt IS NULL
           AND n.archivedAt IS NULL
         ORDER BY rankScore ASC
         LIMIT @topK`
      )
      .all({ query: ftsQuery, topK }) as Array<StoredMemoryNode & { rankScore: number }>;

    return rows.map((row, index) => ({
      node: parseNode(row),
      score: 1 / (1 + Math.max(0, row.rankScore)),
      source: "fts",
      rank: index + 1
    }));
  }

  searchVector(query: string, topK = 10): MemorySearchResult[] {
    const queryVector = embedText(query);
    const rows = this.database.db
      .prepare(
        `SELECT n.*, v.vector
         FROM memories_nodes n
         JOIN memories_vectors v ON v.nodeId = n.id
         WHERE n.deletedAt IS NULL
           AND n.archivedAt IS NULL`
      )
      .all() as Array<StoredMemoryNode & { vector: string }>;

    return rows
      .map((row) => ({
        node: parseNode(row),
        score: cosineSimilarity(queryVector, parseVector(row.vector)),
        source: "vector" as const,
        rank: 0
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((result, index) => ({ ...result, rank: index + 1 }));
  }

  traverse(nodeId: string, depth = 1): MemoryTraversalResult {
    const start = this.requireNode(nodeId);
    const nodes = new Map<string, MemoryNodeRecord>([[start.id, start]]);
    const edges = new Map<string, MemoryEdgeRecord>();
    const visited = new Set<string>([start.id]);
    let frontier = [start.id];

    for (let level = 0; level < depth; level += 1) {
      const next: string[] = [];
      for (const currentId of frontier) {
        for (const edge of this.listEdgesForNode(currentId)) {
          edges.set(edge.id, edge);
          const relatedId = edge.fromNodeId === currentId ? edge.toNodeId : edge.fromNodeId;
          if (visited.has(relatedId)) {
            continue;
          }
          const related = this.getNode(relatedId);
          if (!related) {
            continue;
          }
          nodes.set(related.id, related);
          visited.add(related.id);
          next.push(related.id);
        }
      }
      frontier = next;
      if (frontier.length === 0) {
        break;
      }
    }

    return { nodes: [...nodes.values()], edges: [...edges.values()] };
  }

  hybridSearch(query: string, topK = 10): MemorySearchResult[] {
    const fts = this.searchFTS(query, Math.max(topK, 10));
    const vector = this.searchVector(query, Math.max(topK, 10));
    const scores = new Map<string, MemorySearchResult>();

    const addRanked = (items: MemorySearchResult[], weight: number): void => {
      items.forEach((item, index) => {
        const current = scores.get(item.node.id);
        const score = (current?.score ?? 0) + weight / (RRF_K + index + 1);
        scores.set(item.node.id, {
          node: item.node,
          score,
          source: "hybrid",
          rank: 0
        });
      });
    };

    addRanked(fts, 1.2);
    addRanked(vector, 1);

    for (const seed of [...scores.values()].sort((a, b) => b.score - a.score).slice(0, 3)) {
      for (const related of this.traverse(seed.node.id, 1).nodes) {
        if (related.id === seed.node.id) {
          continue;
        }
        const current = scores.get(related.id);
        scores.set(related.id, {
          node: related,
          score: (current?.score ?? 0) + seed.score * 0.35,
          source: "hybrid",
          rank: 0
        });
      }
    }

    return [...scores.values()]
      .sort((a, b) => b.score - a.score || b.node.importance - a.node.importance)
      .slice(0, topK)
      .map((result, index) => ({ ...result, rank: index + 1 }));
  }

  private requireNode(nodeId: string, options: { includeDeleted?: boolean; includeArchived?: boolean } = {}): MemoryNodeRecord {
    const node = this.getNode(nodeId, options);
    if (!node) {
      throw new Error(`Memory node not found: ${nodeId}`);
    }
    return node;
  }

  private requireEdge(edgeId: string): MemoryEdgeRecord {
    const edge = this.getEdge(edgeId);
    if (!edge || edge.deletedAt) {
      throw new Error(`Memory edge not found: ${edgeId}`);
    }
    return edge;
  }

  private upsertVector(node: MemoryNodeRecord): void {
    const vector = JSON.stringify(embedText(`${node.title}\n${node.body}`));
    this.database.db
      .prepare(
        `INSERT INTO memories_vectors (nodeId, vector, updatedAt)
         VALUES (@nodeId, @vector, @updatedAt)
         ON CONFLICT(nodeId) DO UPDATE SET
           vector = excluded.vector,
           updatedAt = excluded.updatedAt`
      )
      .run({ nodeId: node.id, vector, updatedAt: new Date().toISOString() });
  }

  private hasActiveEdge(fromNodeId: string, toNodeId: string, type: MemoryEdgeType): boolean {
    const row = this.database.db
      .prepare(
        `SELECT id
         FROM memories_edges
         WHERE fromNodeId = @fromNodeId
           AND toNodeId = @toNodeId
           AND type = @type
           AND deletedAt IS NULL
         LIMIT 1`
      )
      .get({ fromNodeId, toNodeId, type }) as { id: string } | undefined;
    return Boolean(row);
  }
}

export function embedText(text: string): number[] {
  const vector = Array.from({ length: VECTOR_DIMENSIONS }, () => 0);
  const tokens = tokenize(text);
  for (const token of tokens) {
    for (const expanded of expandToken(token)) {
      const hash = hashString(expanded);
      const index = Math.abs(hash) % VECTOR_DIMENSIONS;
      vector[index] += hash < 0 ? -1 : 1;
      const secondary = Math.abs(hashString(`${expanded}:secondary`)) % VECTOR_DIMENSIONS;
      vector[secondary] += 0.35;
    }
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude === 0 ? vector : vector.map((value) => Number((value / magnitude).toFixed(6)));
}

function parseNode(row: StoredMemoryNode): MemoryNodeRecord {
  return {
    id: row.id,
    type: assertNodeType(row.type),
    title: row.title,
    body: row.body,
    confidence: row.confidence,
    importance: row.importance,
    sensitivity: assertSensitivity(row.sensitivity),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
    deletedAt: row.deletedAt,
    affordanceId: row.affordanceId
  };
}

function parseEdge(row: StoredMemoryEdge): MemoryEdgeRecord {
  return {
    id: row.id,
    fromNodeId: row.fromNodeId,
    toNodeId: row.toNodeId,
    type: assertEdgeType(row.type),
    createdAt: row.createdAt,
    deletedAt: row.deletedAt
  };
}

function parseVector(value: string): number[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.map(Number) : [];
}

function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    dot += l * r;
    leftMagnitude += l * l;
    rightMagnitude += r * r;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function createMemoryId(prefix: "memory_node" | "memory_edge"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function assertNodeType(value: string): MemoryNodeType {
  if ((memoryNodeTypes as readonly string[]).includes(value)) {
    return value as MemoryNodeType;
  }
  throw new Error(`Invalid memory node type: ${value}`);
}

function assertEdgeType(value: string): MemoryEdgeType {
  if ((memoryEdgeTypes as readonly string[]).includes(value)) {
    return value as MemoryEdgeType;
  }
  throw new Error(`Invalid memory edge type: ${value}`);
}

function assertSensitivity(value: string): MemorySensitivity {
  if ((memorySensitivityLevels as readonly string[]).includes(value)) {
    return value as MemorySensitivity;
  }
  throw new Error(`Invalid memory sensitivity: ${value}`);
}

function assertNonEmpty(value: string, field: string): string {
  if (!value.trim()) {
    throw new Error(`Memory node ${field} must be non-empty.`);
  }
  return value.trim();
}

function normalizeScore(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${field} must be between 0 and 1.`);
  }
  return Number(value.toFixed(4));
}

function validateRelationship(from: MemoryNodeRecord, to: MemoryNodeRecord, type: MemoryEdgeType): void {
  if (from.id === to.id) {
    throw new Error("Memory edges cannot point to the same node.");
  }
  if (type === "contradicts" && ((from.type === "task" && to.type === "user") || (from.type === "user" && to.type === "task"))) {
    throw new Error("Invalid relationship: task and user nodes cannot contradict each other.");
  }
}

function toFtsQuery(query: string): string {
  return tokenize(query)
    .slice(0, 12)
    .map((token) => `${token}*`)
    .join(" OR ");
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .match(/[a-z0-9_]+/g)
    ?.filter((token) => token.length > 1) ?? [];
}

function expandToken(token: string): string[] {
  const normalized = stemToken(token);
  const synonyms: Record<string, string[]> = {
    add: ["addition", "sum", "plus", "calculator"],
    addition: ["add", "sum", "plus", "calculator"],
    bug: ["defect", "issue", "failure", "failing", "broken"],
    defect: ["bug", "issue", "failure"],
    fix: ["repair", "correct", "resolve"],
    customer: ["client", "account"],
    sales: ["revenue", "invoice", "deal"],
    connector: ["integration", "api", "tool"],
    pet: ["animal", "petstore"]
  };
  return [normalized, ...(synonyms[normalized] ?? [])];
}

function stemToken(token: string): string {
  if (token.endsWith("ing") && token.length > 5) {
    return token.slice(0, -3);
  }
  if (token.endsWith("ed") && token.length > 4) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}
