import { useCallback, useEffect, useState } from "react";
import { Bot, RefreshCw, Sparkles } from "lucide-react";
import { squidbotApi } from "../lib/api";
import { TerminalRunner } from "../components/TerminalRunner";
import { TerminalSnippet } from "../components/TerminalSnippet";
import type { IdentityReportDto } from "../types";

/**
 * "About SquidBot" page. Shows what the agent thinks it is right now —
 * its identity card, the active enterprise profile, and its registered tool
 * capabilities. This is the GUI counterpart to `npm run whoami`.
 */
export function IdentityPage() {
  const [report, setReport] = useState<IdentityReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await squidbotApi.getIdentityReport();
      setReport(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="page identity-page">
      <header className="page-header">
        <div>
          <h2>Identity</h2>
          <p className="page-subtitle">Who SquidBot thinks it is right now — adapted to your active business profile.</p>
        </div>
        <button type="button" className="ghost-button" onClick={refresh} disabled={loading} aria-label="Refresh identity">
          <RefreshCw size={14} className={loading ? "spin" : ""} aria-hidden /> Refresh
        </button>
      </header>

      {error && <div className="page-error">{error}</div>}

      {report && (
        <div className="identity-grid">
          <section className="identity-card identity-card--primary" aria-label="Agent identity">
            <div className="identity-card__icon">
              <Bot size={20} aria-hidden />
            </div>
            <div>
              <div className="identity-card__name">{report.card.agentName}</div>
              <div className="identity-card__version">v{report.card.agentVersion}</div>
              <p className="identity-card__mission">{report.card.mission}</p>
            </div>
          </section>

          <section className="identity-card" aria-label="Active enterprise profile">
            <h3>Active profile</h3>
            {report.profile ? (
              <dl className="identity-list">
                <div>
                  <dt>Name</dt>
                  <dd>{report.profile.displayName}</dd>
                </div>
                <div>
                  <dt>Industry</dt>
                  <dd>{report.profile.industry}</dd>
                </div>
                {report.profile.role && (
                  <div>
                    <dt>Operator role</dt>
                    <dd>{report.profile.role}</dd>
                  </div>
                )}
                <div>
                  <dt>Sensitivity</dt>
                  <dd>{report.profile.sensitivity}</dd>
                </div>
                <div>
                  <dt>Read-only by default</dt>
                  <dd>{report.profile.readOnlyByDefault ? "yes" : "no"}</dd>
                </div>
                {report.profile.policyPacks.length > 0 && (
                  <div>
                    <dt>Policy packs</dt>
                    <dd>{report.profile.policyPacks.join(", ")}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="identity-empty">
                No profile is currently active.{" "}
                <span className="muted">SquidBot will still work for general tasks — head to Profiles to pick one or run onboarding.</span>
              </p>
            )}
          </section>

          <section className="identity-card identity-card--full" aria-label="Capabilities">
            <h3>
              <Sparkles size={14} aria-hidden /> Capabilities
            </h3>
            <p className="muted">
              {report.capabilities.toolCount} tool{report.capabilities.toolCount === 1 ? "" : "s"} registered with{" "}
              {report.capabilities.permissionScopes.length} permission scope
              {report.capabilities.permissionScopes.length === 1 ? "" : "s"}.
            </p>
            <div className="identity-permissions">
              {report.capabilities.permissionScopes.map((scope) => (
                <span key={scope} className="chip">
                  {scope}
                </span>
              ))}
            </div>
            <details className="identity-tools">
              <summary>Show all {report.capabilities.toolCount} tools</summary>
              <ul>
                {report.capabilities.tools.map((tool) => (
                  <li key={tool.name}>
                    <code>{tool.name}</code>
                    {tool.riskLevel && <span className={`risk risk-${tool.riskLevel}`}>{tool.riskLevel}</span>}
                  </li>
                ))}
              </ul>
            </details>
          </section>

          <section className="identity-card identity-card--full" aria-label="Equivalent terminal commands">
            <h3>Same thing from your terminal</h3>
            <TerminalSnippet command="npm run whoami" label="Whoami" description="Prints the identity card + active profile + capabilities to your shell." />
            <TerminalSnippet command="npm run profile -- list" label="List profiles" description="See every available enterprise profile." />
            <TerminalSnippet command="npm run profile -- create --name &quot;Acme Corp&quot; --activate" label="Make it yours" description="Create a custom profile for your specific business." />
          </section>

          <section className="identity-card identity-card--full" aria-label="Run inside the app">
            <h3>Or run inside the app</h3>
            <p className="muted">
              These commands run through the same audited IPC handlers the rest of SquidBot uses — no shell exec.
            </p>
            <TerminalRunner
              allowedCommands={["whoami", "profile.list", "profile.current"]}
              defaultCommandId="whoami"
              title="Identity-related commands"
            />
          </section>
        </div>
      )}
    </div>
  );
}
