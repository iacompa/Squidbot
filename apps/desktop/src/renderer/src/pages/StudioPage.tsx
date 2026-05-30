import { useEffect, useMemo, useState } from "react";
import { Download, LayoutTemplate, RefreshCw } from "lucide-react";
import { squidbotApi } from "../lib/api";

/**
 * AI Studio — Blueprint Catalog. A blueprint packages agents, tools,
 * connectors, policies, datasets, benchmarks, and KPIs into a governed,
 * deployable workflow. This surface lists installed blueprints and shows
 * each one's composition, eval targets, and rollout status. The backend
 * (BlueprintRegistry + IPC) already exists; this is the operator-facing view.
 *
 * Loosely typed (`unknown[]` from the IPC) — we read only the fields we render.
 */
type StudioBlueprint = {
  slug: string;
  name: string;
  version: string;
  description?: string;
  owner?: string;
  tags?: string[];
  rollout?: { status?: string };
  agentRoles?: unknown[];
  tools?: unknown[];
  connectors?: unknown[];
  policies?: unknown[];
  datasets?: unknown[];
  benchmarks?: unknown[];
  kpis?: Array<{ name?: string; target?: number; unit?: string }>;
  graph?: { nodes?: unknown[]; edges?: unknown[] };
  auditTrail?: unknown[];
};

function count(value?: unknown[]): number {
  return Array.isArray(value) ? value.length : 0;
}

function rolloutClass(status?: string): string {
  if (status === "stable") return "low";
  if (status === "archived") return "high";
  return "medium";
}

export function StudioPage() {
  const [blueprints, setBlueprints] = useState<StudioBlueprint[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => blueprints.find((blueprint) => blueprint.slug === selectedSlug) ?? blueprints[0] ?? null,
    [blueprints, selectedSlug]
  );

  async function refresh(): Promise<void> {
    setError(null);
    const result = await squidbotApi.listBlueprints();
    const list = (result.blueprints as StudioBlueprint[]) ?? [];
    setBlueprints(list);
    setSelectedSlug((current) =>
      current && list.some((blueprint) => blueprint.slug === current) ? current : list[0]?.slug ?? null
    );
  }

  useEffect(() => {
    void refresh().catch((nextError: unknown) => {
      setError(nextError instanceof Error ? nextError.message : "Unable to load blueprints.");
    });
  }, []);

  async function handleExport(slug: string): Promise<void> {
    setExported(null);
    const result = await squidbotApi.exportBlueprint(slug);
    setExported(result.json);
  }

  async function handlePromote(slug: string, targetStatus: string): Promise<void> {
    setPromoting(true);
    setError(null);
    try {
      await squidbotApi.promoteBlueprint(slug, targetStatus);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Promotion failed.");
    } finally {
      setPromoting(false);
    }
  }

  return (
    <main className="page-panel">
      <header className="page-header">
        <div>
          <p className="section-label">AI Studio</p>
          <h2>Blueprint Catalog</h2>
        </div>
        <button className="secondary-button" type="button" onClick={() => void refresh()}>
          <RefreshCw size={17} />
          <span>Refresh</span>
        </button>
      </header>

      {error ? <div className="error-strip">{error}</div> : null}

      <section className="affordance-layout">
        <div className="memory-section affordance-table-section">
          <div className="memory-section-heading">
            <h3>Installed blueprints</h3>
            <span>{blueprints.length}</span>
          </div>
          {blueprints.length === 0 ? (
            <div className="empty-state compact">
              <LayoutTemplate size={20} />
              <h3>No blueprints installed</h3>
              <p>
                A blueprint packages agents, tools, connectors, policies, datasets, benchmarks, and KPIs into a
                governed, deployable workflow — so you can design, test, and roll one out with every step auditable.
                Neither OpenClaw nor Hermes ships this.
              </p>
            </div>
          ) : (
            <div className="affordance-table" role="table" aria-label="Installed blueprints">
              <div className="affordance-table-head" role="row">
                <span>Name</span>
                <span>Version</span>
                <span>Status</span>
                <span>Owner</span>
              </div>
              {blueprints.map((blueprint) => (
                <button
                  className={`affordance-row ${selected?.slug === blueprint.slug ? "active" : ""}`}
                  key={blueprint.slug}
                  type="button"
                  role="row"
                  onClick={() => {
                    setSelectedSlug(blueprint.slug);
                    setExported(null);
                  }}
                >
                  <strong>{blueprint.name}</strong>
                  <code>{blueprint.version}</code>
                  <span className={`severity-pill ${rolloutClass(blueprint.rollout?.status)}`}>
                    {blueprint.rollout?.status ?? "draft"}
                  </span>
                  <span>{blueprint.owner ?? "—"}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <aside className="memory-section affordance-detail-section">
          <div className="memory-section-heading">
            <h3>Details</h3>
            <span>{selected?.rollout?.status ?? "none"}</span>
          </div>
          {selected ? (
            <div className="affordance-detail">
              <div className="detail-kv">
                <span>Slug</span>
                <code>{selected.slug}</code>
              </div>
              <div className="detail-kv">
                <span>Owner</span>
                <strong>{selected.owner ?? "—"}</strong>
              </div>
              <div className="detail-kv">
                <span>Tags</span>
                <span>{(selected.tags ?? []).join(", ") || "—"}</span>
              </div>
              <div className="detail-kv">
                <span>Components</span>
                <span>
                  {count(selected.agentRoles)} agents · {count(selected.tools)} tools ·{" "}
                  {count(selected.connectors)} connectors · {count(selected.policies)} policies
                </span>
              </div>
              <div className="detail-kv">
                <span>Eval</span>
                <span>
                  {count(selected.benchmarks)} benchmarks · {count(selected.kpis)} KPIs ·{" "}
                  {count(selected.datasets)} datasets
                </span>
              </div>
              <div className="detail-kv">
                <span>Graph</span>
                <span>
                  {count(selected.graph?.nodes)} nodes · {count(selected.graph?.edges)} edges
                </span>
              </div>
              {selected.description ? <p>{selected.description}</p> : null}
              {Array.isArray(selected.kpis) && selected.kpis.length > 0 ? (
                <section className="trace-artifact">
                  <h4>KPI targets</h4>
                  <ul>
                    {selected.kpis.map((kpi, index) => (
                      <li key={index}>
                        {kpi.name}: target {kpi.target}
                        {kpi.unit ? ` ${kpi.unit}` : ""}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <div className="button-row">
                <button className="secondary-button" type="button" onClick={() => void handleExport(selected.slug)}>
                  <Download size={15} />
                  <span>Export JSON</span>
                </button>
                {selected.rollout?.status !== "stable" && selected.rollout?.status !== "archived" ? (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={promoting}
                    aria-label="Promote blueprint"
                    onClick={() => void handlePromote(selected.slug, selected.rollout?.status === "draft" ? "pilot" : "stable")}
                  >
                    {promoting ? "Promoting…" : selected.rollout?.status === "draft" ? "Promote to Pilot" : "Promote to Stable"}
                  </button>
                ) : null}
              </div>
              {exported ? (
                <section className="trace-artifact">
                  <h4>Exported manifest</h4>
                  <pre>{exported}</pre>
                </section>
              ) : null}
            </div>
          ) : (
            <div className="empty-state compact">
              <h3>No blueprint selected</h3>
              <p>Select a blueprint to inspect its agents, tools, connectors, policies, benchmarks, and KPIs.</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
