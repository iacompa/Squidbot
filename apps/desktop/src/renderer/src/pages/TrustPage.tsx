import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, ShieldCheck } from "lucide-react";
import { squidbotApi } from "../lib/api";
import { TerminalRunner } from "../components/TerminalRunner";
import { TerminalSnippet } from "../components/TerminalSnippet";
import type { CompliancePacketDto, TrustDigestDto, TrustReportDto } from "../types";

/**
 * Adaptive USD formatter so tiny sub-cent costs (typical of cheap models like
 * Gemini 2.0 Flash) still render as readable numbers, while normal-dollar
 * totals look like dollars. Mirrors `formatUsd` in @squidbot/governance.
 */
function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}`;
}

/**
 * "Trust & Security" page — the GUI counterpart to `npm run trust`.
 * Surfaces the live security posture (audit chain, policy packs, vault,
 * retention, affordance gaps, sandboxes, connectors) and lets the operator
 * generate a shareable signed digest or a SOC2 / GDPR evidence packet.
 */
export function TrustPage() {
  const [report, setReport] = useState<TrustReportDto | null>(null);
  const [digest, setDigest] = useState<TrustDigestDto | null>(null);
  const [packet, setPacket] = useState<CompliancePacketDto | null>(null);
  const [framework, setFramework] = useState<"soc2" | "gdpr" | "hipaa" | "pci_dss" | "iso27001">("soc2");
  const [loading, setLoading] = useState(false);
  const [generatingPacket, setGeneratingPacket] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextReport, nextDigest] = await Promise.all([
        squidbotApi.getTrustReport(),
        squidbotApi.getTrustDigest()
      ]);
      setReport(nextReport);
      setDigest(nextDigest);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleGeneratePacket(): Promise<void> {
    setGeneratingPacket(true);
    setError(null);
    try {
      const nextPacket = await squidbotApi.buildCompliancePacket(framework);
      setPacket(nextPacket);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGeneratingPacket(false);
    }
  }

  return (
    <div className="page trust-page">
      <header className="page-header">
        <div>
          <h2>Trust &amp; Security</h2>
          <p className="page-subtitle">Live posture, hash-chained audit log, and one-click compliance packets.</p>
        </div>
        <button type="button" className="ghost-button" onClick={refresh} disabled={loading} aria-label="Refresh trust report">
          <RefreshCw size={14} className={loading ? "spin" : ""} aria-hidden /> Refresh
        </button>
      </header>

      {error && <div className="page-error">{error}</div>}

      {report && (
        <div className="trust-grid">
          <section className={`trust-score trust-score--${report.healthLabel}`} aria-label="Health score">
            <ShieldCheck size={28} aria-hidden />
            <div>
              <div className="trust-score__label">{report.healthLabel.replace("_", " ")}</div>
              <div className="trust-score__value">
                {report.healthScore}
                <span>/100</span>
              </div>
              <div className="trust-score__profile">
                {report.profile.active ? (
                  <>
                    Profile: <strong>{report.profile.displayName}</strong> — sensitivity{" "}
                    {report.profile.sensitivity}
                  </>
                ) : (
                  <>No active profile.</>
                )}
              </div>
            </div>
          </section>

          {report.warnings.length > 0 && (
            <section className="trust-card trust-card--warnings" aria-label="Active warnings">
              <h3>Warnings</h3>
              <ul>
                {report.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="trust-card" aria-label="Audit ledger">
            <h3>Audit ledger</h3>
            <ul className="trust-stats">
              <li>
                <span>Entries</span>
                <strong>{report.audit.entryCount}</strong>
              </li>
              <li>
                <span>Last 24h</span>
                <strong>{report.audit.last24hCount}</strong>
              </li>
              <li>
                <span>Chain valid</span>
                <strong className={report.audit.chainValid ? "ok" : "bad"}>{report.audit.chainValid ? "yes" : "NO"}</strong>
              </li>
              <li>
                <span>Latest hash</span>
                <code className="hash-snippet">{report.audit.latestEntryHash?.slice(0, 12) ?? "(none)"}…</code>
              </li>
            </ul>
          </section>

          <section className="trust-card" aria-label="Policy">
            <h3>Policy</h3>
            <ul className="trust-stats">
              <li>
                <span>Built-in packs</span>
                <strong>{report.policy.policyPackCount}</strong>
              </li>
              <li>
                <span>ABAC rules</span>
                <strong>{report.policy.abacRuleCount}</strong>
              </li>
              <li>
                <span>Deny decisions</span>
                <strong>{report.policy.denyDecisionCount}</strong>
              </li>
              <li>
                <span>Last 24h denies</span>
                <strong>{report.policy.recentDenyDecisions}</strong>
              </li>
            </ul>
          </section>

          <section className="trust-card" aria-label="Vault">
            <h3>Vault</h3>
            <ul className="trust-stats">
              <li>
                <span>Secret references</span>
                <strong>{report.vault.secretReferenceCount}</strong>
              </li>
              <li>
                <span>Rotated</span>
                <strong>{report.vault.rotatedSecretCount}</strong>
              </li>
              <li>
                <span>Encrypted at rest</span>
                <strong className="ok">{report.vault.encryptedAtRest ? "yes" : "no"}</strong>
              </li>
              <li>
                <span>Algorithm</span>
                <code>{report.vault.algorithm}</code>
              </li>
            </ul>
          </section>

          <section className="trust-card" aria-label="Retention &amp; gaps">
            <h3>Retention &amp; gaps</h3>
            <ul className="trust-stats">
              <li>
                <span>Retention policies</span>
                <strong>{report.retention.policyCount}</strong>
              </li>
              <li>
                <span>Legal holds (active)</span>
                <strong>{report.retention.activeLegalHoldCount}</strong>
              </li>
              <li>
                <span>Open gaps</span>
                <strong>{report.affordanceGaps.openCount}</strong>
              </li>
              <li>
                <span>High-severity gaps</span>
                <strong className={report.affordanceGaps.highSeverityOpenCount > 0 ? "bad" : "ok"}>
                  {report.affordanceGaps.highSeverityOpenCount}
                </strong>
              </li>
            </ul>
          </section>

          <section className="trust-card trust-card--full" aria-label="Model spend">
            <h3>Model spend (BYOK)</h3>
            <p className="muted">
              Real cost reported by the upstream provider (e.g. OpenRouter's <code>usage.cost</code>) when available, with the
              local per-token heuristic as a fallback. Aggregated from the <code>model_usage</code> table by provider.
            </p>
            {report.modelCost.byProvider.length === 0 ? (
              <div className="muted">No paid model calls recorded yet — you've been on local/mock so far.</div>
            ) : (
              <>
                <ul className="trust-stats">
                  <li>
                    <span>Total spend</span>
                    <strong>{formatUsd(report.modelCost.totalCost)}</strong>
                  </li>
                  <li>
                    <span>Total tokens</span>
                    <strong>{report.modelCost.totalTokens.toLocaleString()}</strong>
                  </li>
                  <li>
                    <span>Usage rows</span>
                    <strong>{report.modelCost.totalRows}</strong>
                  </li>
                  <li>
                    <span>Providers</span>
                    <strong>{report.modelCost.byProvider.length}</strong>
                  </li>
                </ul>
                <table className="spend-table" aria-label="Per-provider spend">
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Cost</th>
                      <th>Tokens</th>
                      <th>Calls</th>
                      <th>Last used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.modelCost.byProvider.map((entry) => (
                      <tr key={entry.provider}>
                        <td>
                          <code>{entry.provider}</code>
                        </td>
                        <td>{formatUsd(entry.totalCost)}</td>
                        <td>{entry.totalTokens.toLocaleString()}</td>
                        <td>{entry.callCount}</td>
                        <td className="muted">{entry.lastUsedAt ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>

          {digest && (
            <section className="trust-card trust-card--full" aria-label="Shareable trust digest">
              <h3>Shareable trust digest</h3>
              <p className="muted">
                A signed snapshot of the current posture you can share with security reviewers. The hash changes only
                when the material posture changes — not on every refresh.
              </p>
              <div className="digest-row">
                <span>Hash</span>
                <code className="hash-snippet hash-snippet--full">{digest.hash}</code>
              </div>
              <div className="digest-row">
                <span>Schema</span>
                <code>{digest.schemaVersion}</code>
                <span>Generated</span>
                <code>{digest.generatedAt}</code>
              </div>
            </section>
          )}

          <section className="trust-card trust-card--full" aria-label="Compliance packet generator">
            <h3>Compliance evidence packet</h3>
            <p className="muted">
              Generate a SOC2, GDPR, HIPAA, PCI DSS, or ISO 27001 control-evidence packet drawn from the live audit ledger and policy state.
            </p>
            <div className="compliance-controls">
              <select
                value={framework}
                onChange={(event) =>
                  setFramework(event.target.value as "soc2" | "gdpr" | "hipaa" | "pci_dss" | "iso27001")
                }
                aria-label="Compliance framework"
              >
                <option value="soc2">SOC 2</option>
                <option value="gdpr">GDPR</option>
                <option value="hipaa">HIPAA</option>
                <option value="pci_dss">PCI DSS</option>
                <option value="iso27001">ISO 27001</option>
              </select>
              <button
                type="button"
                className="primary-button"
                onClick={handleGeneratePacket}
                disabled={generatingPacket}
              >
                {generatingPacket ? <RefreshCw size={14} className="spin" aria-hidden /> : <Download size={14} aria-hidden />}
                <span>{generatingPacket ? "Generating…" : "Generate packet"}</span>
              </button>
            </div>
            {packet && (
              <>
                <div className="compliance-summary">
                  <span>
                    <strong>{packet.framework.toUpperCase()}</strong> packet —{" "}
                    {packet.controls.filter((control) => control.status === "met").length} of {packet.controls.length} controls met automatically.
                  </span>
                  <code className="hash-snippet">{packet.digest.slice(0, 12)}…</code>
                </div>
                <details className="compliance-markdown">
                  <summary>Show packet markdown ({packet.markdown.length.toLocaleString()} characters)</summary>
                  <pre>{packet.markdown}</pre>
                </details>
              </>
            )}
          </section>

          <section className="trust-card trust-card--full" aria-label="Terminal commands">
            <h3>Same thing from your terminal</h3>
            <TerminalSnippet command="npm run trust -- summary" label="Trust summary" description="One-line health summary." />
            <TerminalSnippet
              command="npm run trust -- packet --framework=soc2 --out trust/soc2.md"
              label="Export SOC2 packet"
              description="Write a SOC2 packet markdown to disk so you can share it with a reviewer."
            />
            <TerminalRunner
              allowedCommands={["trust.summary", "trust.digest", "trust.report", "trust.packet.soc2", "trust.packet.gdpr"]}
              defaultCommandId="trust.summary"
              title="Run a trust command inside the app"
            />
          </section>
        </div>
      )}
    </div>
  );
}
