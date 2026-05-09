import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, RefreshCw, ShieldAlert } from "lucide-react";
import { squidbotApi } from "../lib/api";
import type { AffordanceGapDto } from "../types";

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Open";
}

function severityClass(severity: string): string {
  if (severity === "high") {
    return "high";
  }
  if (severity === "low") {
    return "low";
  }
  return "medium";
}

export function AffordancePage() {
  const [status, setStatus] = useState<"open" | "resolved" | "wontfix" | "all">("open");
  const [gaps, setGaps] = useState<AffordanceGapDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedGap = useMemo(() => gaps.find((gap) => gap.id === selectedId) ?? gaps[0] ?? null, [gaps, selectedId]);

  async function refresh(): Promise<void> {
    setError(null);
    const nextGaps = await squidbotApi.listAffordanceGaps({ status });
    setGaps(nextGaps);
    setSelectedId((current) => (current && nextGaps.some((gap) => gap.id === current) ? current : nextGaps[0]?.id ?? null));
  }

  useEffect(() => {
    void refresh().catch((nextError: unknown) => {
      setError(nextError instanceof Error ? nextError.message : "Unable to load affordance gaps.");
    });
  }, [status]);

  async function resolveSelected(nextStatus: "resolved" | "wontfix" = "resolved"): Promise<void> {
    if (!selectedGap) {
      return;
    }
    await squidbotApi.resolveAffordanceGap(selectedGap.id, nextStatus);
    await refresh();
  }

  return (
    <main className="page-panel affordance-page">
      <header className="page-header">
        <div>
          <p className="section-label">Affordances</p>
          <h2>Gaps</h2>
        </div>
        <button className="secondary-button" type="button" onClick={() => void refresh()}>
          <RefreshCw size={17} />
          <span>Refresh</span>
        </button>
      </header>

      {error ? <div className="error-strip">{error}</div> : null}

      <section className="affordance-toolbar">
        <label>
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as "open" | "resolved" | "wontfix" | "all")}>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="wontfix">Won't fix</option>
            <option value="all">All</option>
          </select>
        </label>
        <div className="affordance-count">
          <ShieldAlert size={16} />
          <span>{gaps.length} gaps</span>
        </div>
      </section>

      <section className="affordance-layout">
        <div className="memory-section affordance-table-section">
          <div className="memory-section-heading">
            <h3>Detected gaps</h3>
            <span>{status}</span>
          </div>
          {gaps.length === 0 ? (
            <div className="empty-state compact">
              <h3>No gaps in this view</h3>
              <p>Runs that hit missing tools, permissions, connectors, or context will appear here.</p>
            </div>
          ) : (
            <div className="affordance-table" role="table" aria-label="Affordance gaps">
              <div className="affordance-table-head" role="row">
                <span>Type</span>
                <span>Name</span>
                <span>Severity</span>
                <span>Status</span>
                <span>Run</span>
              </div>
              {gaps.map((gap) => (
                <button
                  className={`affordance-row ${selectedGap?.id === gap.id ? "active" : ""}`}
                  key={gap.id}
                  onClick={() => setSelectedId(gap.id)}
                  role="row"
                  type="button"
                >
                  <span>{gap.type}</span>
                  <strong>{gap.name}</strong>
                  <span className={`severity-pill ${severityClass(gap.severity)}`}>{gap.severity}</span>
                  <span>{gap.status}</span>
                  <code>{gap.runId}</code>
                </button>
              ))}
            </div>
          )}
        </div>

        <aside className="memory-section affordance-detail-section">
          <div className="memory-section-heading">
            <h3>Details</h3>
            <span>{selectedGap?.severity ?? "none"}</span>
          </div>
          {selectedGap ? (
            <div className="affordance-detail">
              <div className="detail-kv">
                <span>ID</span>
                <code>{selectedGap.id}</code>
              </div>
              <div className="detail-kv">
                <span>Reflection</span>
                <code>{selectedGap.reflectionId ?? "none"}</code>
              </div>
              <div className="detail-kv">
                <span>Created</span>
                <strong>{formatTimestamp(selectedGap.createdAt)}</strong>
              </div>
              <div className="detail-kv">
                <span>Resolved</span>
                <strong>{formatTimestamp(selectedGap.resolvedAt)}</strong>
              </div>
              <p>{selectedGap.description}</p>
              <section className="trace-artifact">
                <h4>Context</h4>
                <pre>{JSON.stringify(selectedGap.context, null, 2)}</pre>
              </section>
              <div className="button-row">
                <button
                  className="secondary-button"
                  disabled={selectedGap.status !== "open"}
                  type="button"
                  onClick={() => void resolveSelected("resolved")}
                >
                  <CheckCircle2 size={15} />
                  <span>Resolve</span>
                </button>
                <button
                  className="secondary-button"
                  disabled={selectedGap.status !== "open"}
                  type="button"
                  onClick={() => void resolveSelected("wontfix")}
                >
                  <span>Won't fix</span>
                </button>
                <button className="secondary-button" disabled type="button">
                  <span>Propose skill</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state compact">
              <h3>No gap selected</h3>
              <p>Select a row to inspect the failure classification and source context.</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
