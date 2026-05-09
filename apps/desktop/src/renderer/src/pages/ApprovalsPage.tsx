import { ShieldCheck } from "lucide-react";

export function ApprovalsPage() {
  return (
    <main className="page-panel">
      <header className="page-header">
        <div>
          <p className="section-label">Approvals</p>
          <h2>Pending actions</h2>
        </div>
      </header>

      <div className="empty-state">
        <ShieldCheck size={24} />
        <h3>No pending approvals</h3>
        <p>Writes are draft-only and terminal commands are dry-run only in this phase.</p>
      </div>
    </main>
  );
}
