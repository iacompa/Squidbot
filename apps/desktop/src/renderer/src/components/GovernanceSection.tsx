import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { squidbotApi } from "../lib/api";
import type {
  GovernanceAuditEntryDto,
  GovernanceN8nIntegrationDto,
  GovernancePolicyDecisionDto,
  GovernanceRetentionPolicyDto,
  GovernanceRoleDto,
  GovernanceSecretRefDto,
  GovernanceStatusDto,
  GovernanceUserDto
} from "../types";

/**
 * Reusable governance / security-control-plane panel. Used in two places:
 *   1. GovernancePage (standalone — the existing route).
 *   2. SettingsPage tab (Task 1.7 will render it inside the tabbed shell).
 *
 * The page wrapper owns the <main> + <header> chrome; this component returns
 * only the body content. The section exposes both `refresh()` and
 * `simulate()` via a `GovernanceSectionHandle` ref so the owning page can
 * keep its Simulate + Refresh buttons in the `page-header` strip (the
 * original visual location) without the section having to know about the
 * button chrome.
 */

export type GovernanceSectionHandle = {
  refresh: () => Promise<void>;
  simulate: () => Promise<void>;
};

export const GovernanceSection = forwardRef<GovernanceSectionHandle>((_props, ref) => {
  const [status, setStatus] = useState<GovernanceStatusDto | null>(null);
  const [users, setUsers] = useState<GovernanceUserDto[]>([]);
  const [roles, setRoles] = useState<GovernanceRoleDto[]>([]);
  const [decisions, setDecisions] = useState<GovernancePolicyDecisionDto[]>([]);
  const [secrets, setSecrets] = useState<GovernanceSecretRefDto[]>([]);
  const [audit, setAudit] = useState<GovernanceAuditEntryDto[]>([]);
  const [retention, setRetention] = useState<GovernanceRetentionPolicyDto[]>([]);
  const [n8n, setN8n] = useState<GovernanceN8nIntegrationDto[]>([]);
  const [simulation, setSimulation] = useState<GovernancePolicyDecisionDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ownerUser = useMemo(() => users.find((user) => user.username === "local-admin") ?? users[0], [users]);

  async function refresh(): Promise<void> {
    setError(null);
    await squidbotApi.bootstrapGovernance();
    const [nextStatus, nextUsers, nextRoles, nextDecisions, nextSecrets, nextAudit, nextRetention, nextN8n] = await Promise.all([
      squidbotApi.getGovernanceStatus(),
      squidbotApi.listGovernanceUsers(),
      squidbotApi.listGovernanceRoles(),
      squidbotApi.listGovernancePolicyDecisions(),
      squidbotApi.listGovernanceSecrets(),
      squidbotApi.listGovernanceAudit(),
      squidbotApi.listGovernanceRetentionPolicies(),
      squidbotApi.listGovernanceN8nIntegrations()
    ]);
    setStatus(nextStatus);
    setUsers(nextUsers);
    setRoles(nextRoles);
    setDecisions(nextDecisions);
    setSecrets(nextSecrets);
    setAudit(nextAudit);
    setRetention(nextRetention);
    setN8n(nextN8n);
  }

  async function runSimulation(): Promise<void> {
    if (!ownerUser) return;
    const result = await squidbotApi.simulateGovernancePolicy({
      userId: ownerUser.id,
      action: "sandbox.promote",
      resource: "sandbox:sandbox_demo",
      riskLevel: "high"
    });
    setSimulation(result);
    await refresh();
  }

  useEffect(() => {
    void refresh().catch((nextError: unknown) => setError(nextError instanceof Error ? nextError.message : "Unable to load governance."));
  }, []);

  // Expose `refresh` and `simulate` to the owning page so the page-header
  // Simulate + Refresh buttons can stay in their original visual location
  // while the data-loading + simulation logic stays encapsulated here.
  useImperativeHandle(ref, () => ({ refresh, simulate: runSimulation }), [ownerUser]);

  return (
    <>
      {error ? <div className="error-strip">{error}</div> : null}

      <section className="metric-grid">
        <Metric label="Users" value={status?.users ?? 0} />
        <Metric label="Roles" value={status?.roles ?? 0} />
        <Metric label="Policy decisions" value={status?.decisions ?? 0} />
        <Metric label="Audit entries" value={status?.auditEntries ?? 0} />
      </section>

      <section className="affordance-layout skills-layout">
        <div className="memory-section affordance-table-section">
          <div className="memory-section-heading">
            <h3>Users and Roles</h3>
            <span>local tenant</span>
          </div>
          <div className="affordance-table skill-table">
            <div className="affordance-table-head">
              <span>Status</span>
              <span>User</span>
              <span>Auth</span>
              <span>Tenant</span>
            </div>
            {users.map((user) => (
              <div className="affordance-row" key={user.id}>
                <span className={`severity-pill ${user.status === "active" ? "resolved" : "high"}`}>{user.status}</span>
                <strong>{user.username}</strong>
                <span>{user.authType}</span>
                <span>{user.tenantId}</span>
              </div>
            ))}
          </div>

          <div className="memory-section-heading">
            <h3>Audit Ledger</h3>
            <span>tamper-evident</span>
          </div>
          <div className="event-list compact-list">
            {audit.slice(0, 8).map((entry) => (
              <div className="event-card" key={entry.id}>
                <span className="severity-pill resolved">#{entry.sequence}</span>
                <strong>{entry.action}</strong>
                <p>{entry.outcome} · {entry.actorType}:{entry.actorId}</p>
              </div>
            ))}
          </div>
        </div>

        <aside className="memory-section affordance-detail-section">
          <div className="memory-section-heading">
            <h3>Policy Simulator</h3>
            <span>{simulation?.decision ?? "ready"}</span>
          </div>
          <div className="affordance-detail">
            <div className="detail-kv">
              <span>Action</span>
              <strong>sandbox.promote</strong>
            </div>
            <div className="detail-kv">
              <span>Expected</span>
              <strong>approval required</strong>
            </div>
            {simulation ? (
              <>
                <div className="detail-kv">
                  <span>Decision</span>
                  <strong>{simulation.decision}</strong>
                </div>
                <p>{simulation.reason}</p>
              </>
            ) : null}
          </div>

          <div className="memory-section-heading">
            <h3>Secrets</h3>
            <span>{secrets.length}</span>
          </div>
          <div className="button-row">
            {secrets.length === 0 ? <span className="severity-pill medium">none stored</span> : secrets.map((secret) => <span className="severity-pill resolved" key={secret.id}>{secret.name}: [redacted]</span>)}
          </div>

          <div className="memory-section-heading">
            <h3>Retention</h3>
            <span>{retention.length}</span>
          </div>
          <div className="button-row">
            {retention.length === 0 ? <span className="severity-pill medium">no policies</span> : retention.map((policy) => <span className="severity-pill resolved" key={policy.id}>{policy.resourceType}: {policy.action}</span>)}
          </div>

          <div className="memory-section-heading">
            <h3>n8n Bridge</h3>
            <span>{n8n.length}</span>
          </div>
          <div className="button-row">
            {n8n.map((integration) => <span className={`severity-pill ${integration.enabled ? "resolved" : "medium"}`} key={integration.id}>{integration.name}</span>)}
          </div>

          <div className="memory-section-heading">
            <h3>Policy Decisions</h3>
            <span>{decisions.length}</span>
          </div>
          <div className="event-list compact-list">
            {decisions.slice(0, 4).map((decision) => (
              <div className="event-card" key={decision.id}>
                <strong>{decision.action}</strong>
                <p>{decision.decision}: {decision.reason}</p>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </>
  );
});

GovernanceSection.displayName = "GovernanceSection";

function Metric(props: { label: string; value: number }) {
  return (
    <div className="metric-card">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}
