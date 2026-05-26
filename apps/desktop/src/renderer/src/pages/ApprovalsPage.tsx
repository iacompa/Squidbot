import { useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, ShieldX, XCircle } from "lucide-react";
import { squidbotApi } from "../lib/api";
import type { SandboxDto } from "../types";

export function ApprovalsPage() {
  const [sandboxes, setSandboxes] = useState<SandboxDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);

  const selected = sandboxes.find((s) => s.id === selectedId) ?? sandboxes[0] ?? null;

  async function refresh(): Promise<void> {
    setError(null);
    const list = await squidbotApi.listSandboxes({ status: "active" });
    setSandboxes(list);
    setSelectedId((current) => (current && list.some((s) => s.id === current) ? current : list[0]?.id ?? null));
  }

  useEffect(() => {
    void refresh().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : "Unable to load pending approvals.");
    });
  }, []);

  async function approve(): Promise<void> {
    if (!selected || pending) return;
    setError(null);
    setPending("approve");
    try {
      await squidbotApi.approveSandbox(selected.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approve failed.");
    } finally {
      setPending(null);
    }
  }

  async function reject(): Promise<void> {
    if (!selected || pending) return;
    setError(null);
    setPending("reject");
    try {
      await squidbotApi.rejectSandbox(selected.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reject failed.");
    } finally {
      setPending(null);
    }
  }

  const busy = pending !== null;

  return (
    <main className="page-panel">
      <header className="page-header">
        <div>
          <p className="section-label">Approvals</p>
          <h2>Pending actions</h2>
        </div>
        <button className="secondary-button" type="button" onClick={() => void refresh()}>
          <RefreshCw size={17} />
          <span>Refresh</span>
        </button>
      </header>

      {error ? <div className="error-strip">{error}</div> : null}

      {sandboxes.length === 0 ? (
        <div className="empty-state">
          <ShieldX size={24} />
          <h3>No pending approvals</h3>
          <p>Active sandboxes that require approval will appear here.</p>
        </div>
      ) : (
        <div className="two-column">
          <div className="list-panel">
            {sandboxes.map((sandbox) => (
              <button
                key={sandbox.id}
                type="button"
                className={`list-item ${selected?.id === sandbox.id ? "selected" : ""}`}
                onClick={() => setSelectedId(sandbox.id)}
              >
                <div className="list-item-header">
                  <span className="mono">{sandbox.id}</span>
                  <span className={`status-pill ${sandbox.status}`}>{sandbox.status}</span>
                </div>
                <div className="list-item-sub">{sandbox.workspacePath}</div>
              </button>
            ))}
          </div>

          <div className="detail-panel">
            {selected ? (
              <>
                <div className="detail-header">
                  <h3>{selected.id}</h3>
                  <div className="detail-actions">
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => void approve()}
                      disabled={busy}
                      aria-busy={pending === "approve"}
                    >
                      <CheckCircle2 size={16} /> {pending === "approve" ? "Approving…" : "Approve"}
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => void reject()}
                      disabled={busy}
                      aria-busy={pending === "reject"}
                    >
                      <XCircle size={16} /> {pending === "reject" ? "Rejecting…" : "Reject"}
                    </button>
                  </div>
                </div>
                <div className="detail-meta">
                  <div>Workspace: <span className="mono">{selected.workspacePath}</span></div>
                  <div>Created: {new Date(selected.createdAt).toLocaleString()}</div>
                  {selected.approvalId ? <div>Approval ID: <span className="mono">{selected.approvalId}</span></div> : null}
                </div>
                <pre className="diff-preview">{selected.diff}</pre>
              </>
            ) : null}
          </div>
        </div>
      )}
    </main>
  );
}
