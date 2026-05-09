import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { squidbotApi } from "../lib/api";
import type { TraceDto, TraceMetricsDto, TraceRunSummaryDto } from "../types";
import { TraceViewerPage } from "./TraceViewerPage";

type RunSort = "createdAt" | "duration" | "cost";

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function formatDuration(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
}

function statusClass(status: string): string {
  if (status === "success") {
    return "resolved";
  }
  if (status === "failed") {
    return "high";
  }
  return "medium";
}

export function RunListPage() {
  const [runs, setRuns] = useState<TraceRunSummaryDto[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedTrace, setSelectedTrace] = useState<TraceDto | null>(null);
  const [selectedMetrics, setSelectedMetrics] = useState<TraceMetricsDto | null>(null);
  const [sortBy, setSortBy] = useState<RunSort>("createdAt");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function refreshRuns(nextSort = sortBy): Promise<void> {
    setError(null);
    const nextRuns = await squidbotApi.listRuns({ limit: 100, sortBy: nextSort });
    setRuns(nextRuns);
    setSelectedRunId((current) => current ?? nextRuns[0]?.runId ?? null);
  }

  useEffect(() => {
    void refreshRuns().catch((nextError: unknown) => {
      setError(nextError instanceof Error ? nextError.message : "Unable to load runs.");
    });
  }, []);

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedTrace(null);
      setSelectedMetrics(null);
      return;
    }

    void Promise.all([squidbotApi.getTrace(selectedRunId), squidbotApi.getTraceMetrics(selectedRunId)])
      .then(([trace, metrics]) => {
        setSelectedTrace(trace);
        setSelectedMetrics(metrics);
      })
      .catch((nextError: unknown) => {
        setError(nextError instanceof Error ? nextError.message : "Unable to load trace.");
      });
  }, [selectedRunId]);

  const visibleRuns = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return runs.filter((run) => {
      if (statusFilter && run.status !== statusFilter) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return `${run.runId} ${run.task} ${run.provider} ${run.costOwner}`.toLowerCase().includes(normalizedQuery);
    });
  }, [runs, query, statusFilter]);

  return (
    <main className="page-panel run-list-page">
      <header className="page-header">
        <div>
          <p className="section-label">Trace dashboard</p>
          <h2>Runs</h2>
        </div>
        <button className="secondary-button" type="button" onClick={() => void refreshRuns()}>
          <RefreshCw size={17} />
          <span>Refresh</span>
        </button>
      </header>

      {error ? <div className="error-strip">{error}</div> : null}

      <section className="trace-filter-bar run-filter-bar">
        <label className="search-input-row">
          <Search size={15} />
          <input
            aria-label="Search runs"
            placeholder="Search run ID, task, provider"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select
          aria-label="Run status"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="">All statuses</option>
          <option value="success">Success</option>
          <option value="partial">Partial</option>
          <option value="failed">Failed</option>
          <option value="unknown">Unknown</option>
        </select>
        <select
          aria-label="Sort runs"
          value={sortBy}
          onChange={(event) => {
            const nextSort = event.target.value as RunSort;
            setSortBy(nextSort);
            void refreshRuns(nextSort);
          }}
        >
          <option value="createdAt">Newest</option>
          <option value="duration">Duration</option>
          <option value="cost">Cost</option>
        </select>
      </section>

      {runs.length === 0 ? (
        <div className="empty-state">
          <h3>No runs recorded</h3>
          <p>Run a chat or repo task to create a local trace.</p>
        </div>
      ) : (
        <section className="run-dashboard-layout">
          <div className="run-table-panel">
            <div className="run-table-head">
              <span>Status</span>
              <span>Task</span>
              <span>Provider</span>
              <span>Duration</span>
              <span>Cost</span>
            </div>
            <div className="run-table" role="table" aria-label="Recent runs">
              {visibleRuns.map((run) => (
                <button
                  className={`run-row ${selectedRunId === run.runId ? "active" : ""}`}
                  key={run.runId}
                  onClick={() => setSelectedRunId(run.runId)}
                  role="row"
                  type="button"
                >
                  <span className={`severity-pill ${statusClass(run.status)}`}>{run.status}</span>
                  <span>
                    <strong>{run.task}</strong>
                    <code>{run.runId}</code>
                    <small>{formatTimestamp(run.createdAt)}</small>
                  </span>
                  <span>{run.provider}</span>
                  <span>{formatDuration(run.durationMs)}</span>
                  <span>${run.totalCost.toFixed(4)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="trace-viewer-panel">
            {selectedTrace && selectedMetrics ? (
              <TraceViewerPage trace={selectedTrace} metrics={selectedMetrics} />
            ) : (
              <div className="empty-state compact">
                <h3>No run selected</h3>
                <p>Select a run to inspect its ordered events, details, costs, durations, and diffs.</p>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
