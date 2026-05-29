import { useEffect, useMemo, useState } from "react";
import { Archive, CheckCircle2, GitMerge, Plus, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { squidbotApi } from "../lib/api";
import type {
  MemoryDto,
  MemoryGraphDetailDto,
  MemoryGraphNodeDto,
  MemoryGraphSearchResultDto,
  ReflectionDto
} from "../types";

type CandidateView = {
  type: string;
  title: string;
  body: string;
  confidence: number;
  approvedAt?: string;
  approvedMemoryId?: string;
  graphNodeId?: string;
};

function asCandidate(value: unknown): CandidateView | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.title !== "string" || typeof record.body !== "string") {
    return null;
  }
  return {
    type: typeof record.type === "string" ? record.type : "observation",
    title: record.title,
    body: record.body,
    confidence: typeof record.confidence === "number" ? record.confidence : 0.5,
    approvedAt: typeof record.approvedAt === "string" ? record.approvedAt : undefined,
    approvedMemoryId: typeof record.approvedMemoryId === "string" ? record.approvedMemoryId : undefined,
    graphNodeId: typeof record.graphNodeId === "string" ? record.graphNodeId : undefined
  };
}

type MemoryGraphPageProps = {
  embedded?: boolean;
};

export function MemoryGraphPage({ embedded = false }: MemoryGraphPageProps = {}) {
  const [nodes, setNodes] = useState<MemoryGraphNodeDto[]>([]);
  const [results, setResults] = useState<MemoryGraphSearchResultDto[]>([]);
  const [detail, setDetail] = useState<MemoryGraphDetailDto | null>(null);
  const [memories, setMemories] = useState<MemoryDto[]>([]);
  const [reflections, setReflections] = useState<ReflectionDto[]>([]);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"fts" | "vector" | "hybrid">("hybrid");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", body: "", confidence: "0.5", importance: "0.5", sensitivity: "public" });
  const [createDraft, setCreateDraft] = useState({ type: "fact", title: "", body: "" });
  const [mergeSourceId, setMergeSourceId] = useState("");
  const [approving, setApproving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshAll(): Promise<void> {
    setError(null);
    const [nextNodes, nextMemories, nextReflections] = await Promise.all([
      squidbotApi.listMemoryGraphNodes(),
      squidbotApi.listMemories(),
      squidbotApi.listReflections()
    ]);
    setNodes(nextNodes);
    setMemories(nextMemories);
    setReflections(nextReflections);
    if (!query.trim()) {
      setResults(nextNodes.map((node, index) => ({ node, score: 1 / (index + 1), source: "hybrid", rank: index + 1 })));
    }
  }

  useEffect(() => {
    void refreshAll().catch((nextError: unknown) => {
      setError(nextError instanceof Error ? nextError.message : "Unable to load memory graph.");
    });
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void squidbotApi
      .getMemoryGraphNode(selectedId)
      .then((nextDetail) => {
        setDetail(nextDetail);
        if (nextDetail) {
          setDraft({
            title: nextDetail.node.title,
            body: nextDetail.node.body,
            confidence: String(nextDetail.node.confidence),
            importance: String(nextDetail.node.importance),
            sensitivity: nextDetail.node.sensitivity
          });
        }
      })
      .catch((nextError: unknown) => setError(nextError instanceof Error ? nextError.message : "Unable to load node."));
  }, [selectedId]);

  async function runSearch(): Promise<void> {
    setError(null);
    const nextResults = query.trim()
      ? await squidbotApi.searchMemoryGraph(query, mode, 12)
      : nodes.map((node, index) => ({ node, score: 1 / (index + 1), source: "hybrid", rank: index + 1 }));
    setResults(nextResults);
    if (nextResults[0]) {
      setSelectedId(nextResults[0].node.id);
    }
  }

  async function saveNode(): Promise<void> {
    if (!detail) {
      return;
    }
    const node = await squidbotApi.updateMemoryGraphNode(detail.node.id, {
      title: draft.title,
      body: draft.body,
      confidence: Number(draft.confidence),
      importance: Number(draft.importance),
      sensitivity: draft.sensitivity
    });
    await refreshAll();
    setSelectedId(node.id);
  }

  async function createNode(): Promise<void> {
    const node = await squidbotApi.createMemoryGraphNode(createDraft);
    setCreateDraft({ type: "fact", title: "", body: "" });
    await refreshAll();
    setSelectedId(node.id);
  }

  async function archiveSelected(): Promise<void> {
    if (!detail) {
      return;
    }
    await squidbotApi.archiveMemoryGraphNode(detail.node.id);
    setSelectedId(null);
    await refreshAll();
  }

  async function deleteSelected(): Promise<void> {
    if (!detail) {
      return;
    }
    // Soft-delete is destructive (drops the node from active retrieval) — guard
    // it behind a confirmation so a stray click can't wipe a memory.
    if (
      typeof window !== "undefined" &&
      typeof window.confirm === "function" &&
      !window.confirm(`Delete memory node "${detail.node.title}"? It will be removed from active retrieval.`)
    ) {
      return;
    }
    await squidbotApi.deleteMemoryGraphNode(detail.node.id);
    setSelectedId(null);
    await refreshAll();
  }

  async function mergeSelected(): Promise<void> {
    if (!detail || !mergeSourceId.trim()) {
      return;
    }
    const node = await squidbotApi.mergeMemoryGraphNodes(detail.node.id, mergeSourceId.trim());
    setMergeSourceId("");
    await refreshAll();
    setSelectedId(node.id);
  }

  async function approveCandidate(reflectionId: string, candidateIndex: number): Promise<void> {
    const key = `${reflectionId}:${candidateIndex}`;
    setApproving(key);
    try {
      await squidbotApi.approveMemoryCandidate(reflectionId, candidateIndex);
      await refreshAll();
    } finally {
      setApproving(null);
    }
  }

  const candidateCount = useMemo(
    () => reflections.reduce((count, reflection) => count + reflection.memoryCandidates.length, 0),
    [reflections]
  );

  const body = (
    <>
      {error ? <div className="error-strip">{error}</div> : null}

      <section className="memory-graph-toolbar">
        <div className="search-input-row">
          <Search size={17} />
          <input
            aria-label="Search memory graph"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void runSearch();
              }
            }}
            placeholder="Search facts, decisions, risks, preferences..."
            value={query}
          />
        </div>
        <select value={mode} onChange={(event) => setMode(event.target.value as "fts" | "vector" | "hybrid")}>
          <option value="hybrid">Hybrid</option>
          <option value="fts">Text</option>
          <option value="vector">Vector</option>
        </select>
        <button className="secondary-button" type="button" onClick={() => void runSearch()}>
          <Search size={15} />
          <span>Search</span>
        </button>
      </section>

      <section className="memory-graph-grid">
        <div className="memory-section graph-results">
          <div className="memory-section-heading">
            <h3>Nodes</h3>
            <span>{results.length || nodes.length}</span>
          </div>
          <div className="memory-list">
            {(results.length ? results : nodes.map((node, index) => ({ node, score: 1 / (index + 1), source: "hybrid", rank: index + 1 }))).map((result) => (
              <button
                className={`memory-node-row ${selectedId === result.node.id ? "active" : ""}`}
                key={result.node.id}
                onClick={() => setSelectedId(result.node.id)}
                type="button"
              >
                <span>{result.node.type}</span>
                <strong>{result.node.title}</strong>
                <small>
                  confidence {result.node.confidence.toFixed(2)} · importance {result.node.importance.toFixed(2)}
                </small>
                <small>{new Date(result.node.updatedAt).toLocaleString()}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="memory-section graph-detail">
          <div className="memory-section-heading">
            <h3>Inspector</h3>
            <span>{detail?.node.type ?? "none"}</span>
          </div>
          {detail ? (
            <div className="memory-detail-editor">
              <label>
                <span>Title</span>
                <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
              </label>
              <label>
                <span>Body</span>
                <textarea value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
              </label>
              <div className="metadata-grid">
                <label>
                  <span>Confidence</span>
                  <input
                    max={1}
                    min={0}
                    step={0.01}
                    type="number"
                    value={draft.confidence}
                    onChange={(event) => setDraft({ ...draft, confidence: event.target.value })}
                  />
                </label>
                <label>
                  <span>Importance</span>
                  <input
                    max={1}
                    min={0}
                    step={0.01}
                    type="number"
                    value={draft.importance}
                    onChange={(event) => setDraft({ ...draft, importance: event.target.value })}
                  />
                </label>
                <label>
                  <span>Sensitivity</span>
                  <select value={draft.sensitivity} onChange={(event) => setDraft({ ...draft, sensitivity: event.target.value })}>
                    <option value="public">Public</option>
                    <option value="restricted">Restricted</option>
                    <option value="secret">Secret</option>
                  </select>
                </label>
              </div>
              <div className="button-row">
                <button className="secondary-button" type="button" onClick={() => void saveNode()}>
                  <Save size={15} />
                  <span>Save</span>
                </button>
                <button className="secondary-button" type="button" onClick={() => void archiveSelected()}>
                  <Archive size={15} />
                  <span>Archive</span>
                </button>
                <button className="secondary-button danger" type="button" onClick={() => void deleteSelected()}>
                  <Trash2 size={15} />
                  <span>Delete</span>
                </button>
              </div>

              <div className="merge-row">
                <input
                  aria-label="Source node id to merge"
                  onChange={(event) => setMergeSourceId(event.target.value)}
                  placeholder="Source node ID"
                  value={mergeSourceId}
                />
                <button className="secondary-button" type="button" onClick={() => void mergeSelected()}>
                  <GitMerge size={15} />
                  <span>Merge</span>
                </button>
              </div>

              <div className="adjacency-list">
                <h4>Connected nodes</h4>
                {detail.relatedNodes.length === 0 ? <p>No connected active nodes.</p> : null}
                {detail.relatedNodes.map((node) => {
                  const edge = detail.edges.find((item) => item.fromNodeId === node.id || item.toNodeId === node.id);
                  return (
                    <button key={node.id} type="button" onClick={() => setSelectedId(node.id)}>
                      <span>{edge?.type ?? "related"}</span>
                      <strong>{node.title}</strong>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="empty-state compact">
              <h3>No node selected</h3>
              <p>Select a result or create a node to inspect graph metadata.</p>
            </div>
          )}
        </div>

        <div className="memory-section graph-create">
          <div className="memory-section-heading">
            <h3>Create node</h3>
            <span>local</span>
          </div>
          <div className="memory-detail-editor">
            <label>
              <span>Type</span>
              <select value={createDraft.type} onChange={(event) => setCreateDraft({ ...createDraft, type: event.target.value })}>
                {["fact", "decision", "task", "goal", "skill", "preference", "risk", "user", "reflection"].map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Title</span>
              <input value={createDraft.title} onChange={(event) => setCreateDraft({ ...createDraft, title: event.target.value })} />
            </label>
            <label>
              <span>Body</span>
              <textarea value={createDraft.body} onChange={(event) => setCreateDraft({ ...createDraft, body: event.target.value })} />
            </label>
            <button className="secondary-button" type="button" onClick={() => void createNode()}>
              <Plus size={15} />
              <span>Create</span>
            </button>
          </div>
        </div>
      </section>

      <section className="memory-legacy-grid">
        <div className="memory-section">
          <div className="memory-section-heading">
            <h3>Approved legacy memories</h3>
            <span>{memories.length}</span>
          </div>
          <div className="memory-list">
            {memories.map((memory) => (
              <article className="memory-card" key={memory.id}>
                <div className="memory-card-title">
                  <span>{memory.type}</span>
                  <strong>{memory.title}</strong>
                </div>
                <p>{memory.body}</p>
                <div className="memory-meta">
                  <span>{memory.approvedAt ? new Date(memory.approvedAt).toLocaleString() : "Pending"}</span>
                  <span>confidence {memory.confidence.toFixed(2)}</span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="memory-section">
          <div className="memory-section-heading">
            <h3>Reflection candidates</h3>
            <span>{candidateCount}</span>
          </div>
          <div className="memory-list">
            {reflections.map((reflection) => (
              <article className="reflection-card" key={reflection.id}>
                <div className="memory-card-title">
                  <span>{new Date(reflection.createdAt).toLocaleDateString()}</span>
                  <strong>{reflection.task}</strong>
                </div>
                {reflection.affordanceIds.length > 0 ? (
                  <div className="connector-meta">
                    {reflection.affordanceIds.map((gapId) => (
                      <span key={String(gapId)}>{String(gapId)}</span>
                    ))}
                  </div>
                ) : null}
                <div className="candidate-list">
                  {reflection.memoryCandidates.map((rawCandidate, candidateIndex) => {
                    const candidate = asCandidate(rawCandidate);
                    if (!candidate) {
                      return null;
                    }
                    const key = `${reflection.id}:${candidateIndex}`;
                    const approved = Boolean(candidate.approvedMemoryId || candidate.approvedAt);
                    return (
                      <div className="candidate-row" key={key}>
                        <div>
                          <span>{candidate.type}</span>
                          <strong>{candidate.title}</strong>
                          <p>{candidate.body}</p>
                        </div>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={approved || approving === key}
                          onClick={() => void approveCandidate(reflection.id, candidateIndex)}
                        >
                          {approved ? <CheckCircle2 size={16} /> : null}
                          <span>{approved ? "Approved" : "Approve"}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );

  if (embedded) {
    return body;
  }

  return (
    <main className="page-panel memory-graph-page">
      <header className="page-header">
        <div>
          <p className="section-label">Memory</p>
          <h2>Semantic graph</h2>
        </div>
        <button className="secondary-button" type="button" onClick={() => void refreshAll()}>
          <RefreshCw size={17} />
          <span>Refresh</span>
        </button>
      </header>
      {body}
    </main>
  );
}
