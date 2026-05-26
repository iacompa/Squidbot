import { useEffect, useMemo, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
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

export function GovernancePage() {
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

  return (
    <main className="page-panel eval-page">
      <header className="page-header">
        <div>
          <p className="section-label">Governance</p>
          <h2>Security Control Plane</h2>
        </div>
        <div className="button-row">
          <button className="secondary-button" type="button" onClick={() => void runSimulation()}>
            <ShieldCheck size={17} />
            <span>Simulate</span>
          </button>
          <button className="secondary-button" type="button" onClick={() => void refresh()}>
            <RefreshCw size={17} />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      {error ? <div className="error-strip">{error}</div> : null}

      <section className="metric-grid">
        <Metric label="Users" value={status?.users ?? 0} />
        <Metric label="Roles" value={status?.roles ?? 0} />
        <Metric label="Policy decisions" value={status?.decisions ?? 0} />
        <Metric label="Audit entries" value={status?.auditEntries ?? 0} />
      </section>

      {status?.tenantIsolation?.enabled ? (
        <section className="trace-artifact">
          <h4>Tenant isolation</h4>
          <p className="muted-copy">
            Resources are scoped to tenant <strong>{status.tenantId}</strong>. Cross-tenant access is denied by default
            (default tenant: {status.tenantIsolation.defaultTenantId}).
          </p>
        </section>
      ) : null}

      {status?.ssoProviders?.length ? (
        <section className="affordance-layout skills-layout">
          <div className="memory-section affordance-table-section">
            <div className="memory-section-heading">
              <h3>SSO providers</h3>
              <span>enterprise perimeter</span>
            </div>
            <div className="affordance-table skill-table">
              <div className="affordance-table-head">
                <span>Status</span>
                <span>Provider</span>
                <span>Configured</span>
                <span>Detail</span>
              </div>
              {status.ssoProviders.map((provider) => (
                <div className="affordance-row" key={provider.id}>
                  <span className={`severity-pill ${provider.available ? "resolved" : "medium"}`}>
                    {provider.available ? "available" : "planned"}
                  </span>
                  <strong>{provider.label}</strong>
                  <span>{provider.configured ? "yes" : "no"}</span>
                  <span>{provider.detail}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

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
            {decisions.slice(0, 4).map((decision, index) => (
              <div className="event-card" key={decision.id ?? `${decision.action}-${decision.createdAt ?? index}`}>
                <strong>{decision.action}</strong>
                <p>{decision.decision}: {decision.reason}</p>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}

function Metric(props: { label: string; value: number }) {
  return (
    <div className="metric-card">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}
