import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, RefreshCw, ShieldX, XCircle } from "lucide-react";
import { squidbotApi } from "../lib/api";
import type { SandboxDto } from "../types";

type SandboxStatusFilter = "active" | "promoted" | "rejected" | "destroyed" | "failed" | "all";

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Pending";
}

function diffFileCount(diff: string): number {
  return [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].length;
}

function statusClass(status: string): string {
  if (status === "promoted") {
    return "resolved";
  }
  if (status === "failed" || status === "rejected") {
    return "high";
  }
  return "medium";
}

export function SandboxesPage() {
  const [status, setStatus] = useState<SandboxStatusFilter>("active");
  const [sandboxes, setSandboxes] = useState<SandboxDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedSandbox = useMemo(
    () => sandboxes.find((sandbox) => sandbox.id === selectedId) ?? sandboxes[0] ?? null,
    [sandboxes, selectedId]
  );

  async function refresh(): Promise<void> {
    setError(null);
    const nextSandboxes = await squidbotApi.listSandboxes({ status });
    setSandboxes(nextSandboxes);
    setSelectedId((current) =>
      current && nextSandboxes.some((sandbox) => sandbox.id === current) ? current : nextSandboxes[0]?.id ?? null
    );
  }

  useEffect(() => {
    void refresh().catch((nextError: unknown) => {
      setError(nextError instanceof Error ? nextError.message : "Unable to load sandboxes.");
    });
  }, [status]);

  async function approveSelected(): Promise<void> {
    if (!selectedSandbox) {
      return;
    }
    await squidbotApi.approveSandbox(selectedSandbox.id);
    await refresh();
  }

  async function rejectSelected(): Promise<void> {
    if (!selectedSandbox) {
      return;
    }
    await squidbotApi.rejectSandbox(selectedSandbox.id);
    await refresh();
  }

  return (
    <main className="page-panel sandboxes-page">
      <header className="page-header">
        <div>
          <p className="section-label">Staging world</p>
          <h2>Sandboxes</h2>
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
          <select value={status} onChange={(event) => setStatus(event.target.value as SandboxStatusFilter)}>
            <option value="active">Active</option>
            <option value="promoted">Promoted</option>
            <option value="rejected">Rejected</option>
            <option value="failed">Failed</option>
            <option value="all">All</option>
          </select>
        </label>
        <div className="affordance-count">
          <ShieldX size={16} />
          <span>{sandboxes.length} sandboxes</span>
        </div>
      </section>

      <section className="affordance-layout sandbox-layout">
        <div className="memory-section affordance-table-section">
          <div className="memory-section-heading">
            <h3>Staged work</h3>
            <span>{status}</span>
          </div>
          {sandboxes.length === 0 ? (
            <div className="empty-state compact">
              <h3>No sandboxes in this view</h3>
              <p>Patch-producing runs create staged work here before anything touches the real workspace.</p>
            </div>
          ) : (
            <div className="affordance-table sandbox-table" role="table" aria-label="Sandboxes">
              <div className="affordance-table-head" role="row">
                <span>Status</span>
                <span>ID</span>
                <span>Files</span>
                <span>Network</span>
                <span>Run</span>
              </div>
              {sandboxes.map((sandbox) => (
                <button
                  className={`affordance-row ${selectedSandbox?.id === sandbox.id ? "active" : ""}`}
                  key={sandbox.id}
                  onClick={() => setSelectedId(sandbox.id)}
                  role="row"
                  type="button"
                >
                  <span className={`severity-pill ${statusClass(sandbox.status)}`}>{sandbox.status}</span>
                  <strong>{sandbox.id}</strong>
                  <span>{diffFileCount(sandbox.diff)}</span>
                  <span>{sandbox.networkPolicy}</span>
                  <code>{sandbox.runId ?? "manual"}</code>
                </button>
              ))}
            </div>
          )}
        </div>

        <aside className="memory-section affordance-detail-section sandbox-detail-section">
          <div className="memory-section-heading">
            <h3>Details</h3>
            <span>{selectedSandbox?.status ?? "none"}</span>
          </div>
          {selectedSandbox ? (
            <div className="affordance-detail sandbox-detail">
              <div className="detail-kv">
                <span>ID</span>
                <code>{selectedSandbox.id}</code>
              </div>
              <div className="detail-kv">
                <span>Workspace</span>
                <code>{selectedSandbox.workspacePath}</code>
              </div>
              <div className="detail-kv">
                <span>Sandbox</span>
                <code>{selectedSandbox.sandboxPath}</code>
              </div>
              <div className="detail-kv">
                <span>Created</span>
                <strong>{formatTimestamp(selectedSandbox.createdAt)}</strong>
              </div>
              <div className="detail-kv">
                <span>Promoted</span>
                <strong>{formatTimestamp(selectedSandbox.promotedAt)}</strong>
              </div>
              <div className="detail-kv">
                <span>Destroyed</span>
                <strong>{formatTimestamp(selectedSandbox.destroyedAt)}</strong>
              </div>
              <section className="trace-artifact">
                <h4>Resource policy</h4>
                <pre>{JSON.stringify({ limits: selectedSandbox.resourceLimits, network: selectedSandbox.networkPolicy }, null, 2)}</pre>
              </section>
              <section className="trace-artifact">
                <h4>Test results</h4>
                <pre>{JSON.stringify(selectedSandbox.testResults, null, 2)}</pre>
              </section>
              <section className="trace-artifact diff-artifact">
                <h4>Diff</h4>
                <pre>{selectedSandbox.diff || "No diff generated yet."}</pre>
              </section>
              <div className="button-row">
                <button
                  className="secondary-button"
                  disabled={selectedSandbox.status !== "active" || !selectedSandbox.diff.trim()}
                  type="button"
                  onClick={() => void approveSelected()}
                >
                  <CheckCircle2 size={15} />
                  <span>Approve</span>
                </button>
                <button
                  className="secondary-button"
                  disabled={selectedSandbox.status !== "active"}
                  type="button"
                  onClick={() => void rejectSelected()}
                >
                  <XCircle size={15} />
                  <span>Reject</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state compact">
              <h3>No sandbox selected</h3>
              <p>Select staged work to inspect its diff, tests, and promotion state.</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
