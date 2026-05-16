import { useCallback, useEffect, useState } from "react";
import { Check, ShieldCheck, X } from "lucide-react";
import { squidbotApi } from "../lib/api";
import type { PendingApprovalDto } from "../../../shared/api";

export function ApprovalsPage() {
  const [pending, setPending] = useState<PendingApprovalDto[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await squidbotApi.listPendingApprovals();
      setPending(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function approve(item: PendingApprovalDto) {
    if (item.kind !== "sandbox-promotion" || !item.payload.sandboxId) return;
    setBusyId(item.id);
    try {
      await squidbotApi.approveSandbox(item.payload.sandboxId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function reject(item: PendingApprovalDto) {
    if (item.kind !== "sandbox-promotion" || !item.payload.sandboxId) return;
    setBusyId(item.id);
    try {
      await squidbotApi.rejectSandbox(item.payload.sandboxId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="page-panel approvals-page">
      <header className="page-header">
        <div>
          <p className="section-label">Approvals</p>
          <h2>Pending actions</h2>
          <p className="page-subtitle">
            SquidBot pauses risky operations and waits for your approval. Items in this queue are
            blocking real work — clear them when ready.
          </p>
        </div>
      </header>

      {error && <div className="error-strip">{error}</div>}

      {pending.length === 0 ? (
        <div className="empty-state">
          <ShieldCheck size={24} />
          <h3>No pending approvals</h3>
          <p>SquidBot will queue items here when it needs your sign-off on a risky action.</p>
        </div>
      ) : (
        <ul className="approval-list">
          {pending.map((item) => (
            <li className="approval-row" key={item.id}>
              <div className="approval-row__main">
                <div className="approval-row__title">
                  <strong>{item.title}</strong>
                  <span className={`chip chip--risk-${item.riskLevel}`}>{item.riskLevel}</span>
                </div>
                <div className="approval-row__summary">{item.summary}</div>
                <div className="approval-row__meta">
                  {item.kind} · {new Date(item.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="approval-row__actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void approve(item)}
                  disabled={busyId === item.id}
                >
                  <Check size={14} aria-hidden /> Approve
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => void reject(item)}
                  disabled={busyId === item.id}
                >
                  <X size={14} aria-hidden /> Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
