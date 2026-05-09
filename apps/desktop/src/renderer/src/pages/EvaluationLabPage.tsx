import { useEffect, useMemo, useState } from "react";
import { FlaskConical, GitCompareArrows, RefreshCw, ShieldCheck, Trophy } from "lucide-react";
import { squidbotApi } from "../lib/api";
import type { EvalDatasetDto, EvalRunDetailDto, EvalRunDto, LeaderboardEntryDto, SkillVariantDto } from "../types";

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "None";
}

function formatScore(value: unknown): string {
  return typeof value === "number" ? value.toFixed(3) : "0.000";
}

function statusClass(status: string): string {
  if (status === "completed" || status === "passed" || status === "stable" || status === "canary") {
    return "resolved";
  }
  if (status === "failed" || status === "rejected") {
    return "high";
  }
  return "medium";
}

export function EvaluationLabPage() {
  const [datasets, setDatasets] = useState<EvalDatasetDto[]>([]);
  const [evalRuns, setEvalRuns] = useState<EvalRunDto[]>([]);
  const [variants, setVariants] = useState<SkillVariantDto[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntryDto[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<EvalRunDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedRun = useMemo(() => evalRuns.find((run) => run.id === selectedRunId) ?? evalRuns[0] ?? null, [evalRuns, selectedRunId]);
  const selectedDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === selectedRun?.datasetId) ?? datasets[0] ?? null,
    [datasets, selectedRun?.datasetId]
  );

  async function refresh(): Promise<void> {
    setError(null);
    const [nextDatasets, nextRuns, nextVariants] = await Promise.all([
      squidbotApi.listEvalDatasets(),
      squidbotApi.listEvalRuns(),
      squidbotApi.listSkillVariants()
    ]);
    setDatasets(nextDatasets);
    setEvalRuns(nextRuns);
    setVariants(nextVariants);
    const nextSelected = selectedRunId && nextRuns.some((run) => run.id === selectedRunId) ? selectedRunId : nextRuns[0]?.id ?? null;
    setSelectedRunId(nextSelected);
    setRunDetail(nextSelected ? await squidbotApi.getEvalRunDetail(nextSelected) : null);
    setLeaderboard(await squidbotApi.listEvalLeaderboard(nextDatasets[0] ? { datasetId: nextDatasets[0].id } : undefined));
  }

  useEffect(() => {
    void refresh().catch((nextError: unknown) => setError(nextError instanceof Error ? nextError.message : "Unable to load Evaluation Lab."));
  }, []);

  useEffect(() => {
    if (!selectedRun) {
      setRunDetail(null);
      return;
    }
    void squidbotApi
      .getEvalRunDetail(selectedRun.id)
      .then(setRunDetail)
      .catch((nextError: unknown) => setError(nextError instanceof Error ? nextError.message : "Unable to load evaluation run."));
  }, [selectedRun?.id]);

  async function selectRun(run: EvalRunDto): Promise<void> {
    setSelectedRunId(run.id);
    setRunDetail(await squidbotApi.getEvalRunDetail(run.id));
  }

  async function loadLeaderboard(datasetId: string): Promise<void> {
    setLeaderboard(await squidbotApi.listEvalLeaderboard({ datasetId }));
  }

  return (
    <main className="page-panel eval-page">
      <header className="page-header">
        <div>
          <p className="section-label">Evaluation Lab</p>
          <h2>Evals</h2>
        </div>
        <button className="secondary-button" type="button" onClick={() => void refresh()}>
          <RefreshCw size={17} />
          <span>Refresh</span>
        </button>
      </header>

      {error ? <div className="error-strip">{error}</div> : null}

      <section className="metric-grid">
        <div className="metric-card">
          <span>Datasets</span>
          <strong>{datasets.length}</strong>
        </div>
        <div className="metric-card">
          <span>Eval runs</span>
          <strong>{evalRuns.length}</strong>
        </div>
        <div className="metric-card">
          <span>Variants</span>
          <strong>{variants.length}</strong>
        </div>
        <div className="metric-card">
          <span>Top score</span>
          <strong>{formatScore(leaderboard[0]?.compositeScore)}</strong>
        </div>
      </section>

      <section className="affordance-layout skills-layout">
        <div className="memory-section affordance-table-section">
          <div className="memory-section-heading">
            <h3>Datasets</h3>
            <span>{datasets.length}</span>
          </div>
          <div className="version-list">
            {datasets.length === 0 ? (
              <div className="empty-state compact">
                <h3>No datasets installed</h3>
                <p>Install local benchmark datasets from the CLI to start recording evidence-backed evaluations.</p>
              </div>
            ) : (
              datasets.map((dataset) => (
                <button className="version-row" key={dataset.id} type="button" onClick={() => void loadLeaderboard(dataset.id)}>
                  <FlaskConical size={15} />
                  <span>{dataset.name}</span>
                  <span className="severity-pill resolved">{dataset.domain}</span>
                  <span>{dataset.version}</span>
                </button>
              ))
            )}
          </div>

          <div className="memory-section-heading">
            <h3>Eval runs</h3>
            <span>{evalRuns.length}</span>
          </div>
          <div className="affordance-table skill-table" role="table" aria-label="Evaluation runs">
            <div className="affordance-table-head" role="row">
              <span>Status</span>
              <span>Target</span>
              <span>Dataset</span>
              <span>Score</span>
            </div>
            {evalRuns.map((run) => (
              <button className={`affordance-row ${selectedRun?.id === run.id ? "active" : ""}`} key={run.id} onClick={() => void selectRun(run)} role="row" type="button">
                <span className={`severity-pill ${statusClass(run.status)}`}>{run.status}</span>
                <strong>{run.targetId}</strong>
                <span>{run.datasetId}</span>
                <span>{formatScore(run.metrics?.compositeScore)}</span>
              </button>
            ))}
          </div>
        </div>

        <aside className="memory-section affordance-detail-section skill-detail-section">
          <div className="memory-section-heading">
            <h3>Evidence</h3>
            <span>{selectedRun?.status ?? "none"}</span>
          </div>
          {runDetail ? (
            <div className="affordance-detail skill-detail">
              <div className="detail-kv">
                <span>Run</span>
                <code>{runDetail.evalRun.id}</code>
              </div>
              <div className="detail-kv">
                <span>Target</span>
                <strong>{runDetail.evalRun.targetId}</strong>
              </div>
              <div className="detail-kv">
                <span>Dataset</span>
                <strong>{runDetail.evalRun.datasetId}</strong>
              </div>
              <div className="button-row">
                <button className="secondary-button" type="button" disabled={runDetail.comparisons.length === 0}>
                  <GitCompareArrows size={15} />
                  <span>Compare</span>
                </button>
                <button className="secondary-button" type="button" disabled>
                  <ShieldCheck size={15} />
                  <span>Promote</span>
                </button>
                <button className="secondary-button" type="button" disabled>
                  <Trophy size={15} />
                  <span>Canary</span>
                </button>
              </div>
              <section className="trace-artifact">
                <h4>Metrics</h4>
                <pre>{JSON.stringify(runDetail.evalRun.metrics, null, 2)}</pre>
              </section>
              <section className="trace-artifact">
                <h4>Task results</h4>
                <pre>{JSON.stringify(runDetail.taskResults, null, 2)}</pre>
              </section>
              <section className="trace-artifact">
                <h4>Comparisons</h4>
                <pre>{JSON.stringify(runDetail.comparisons, null, 2)}</pre>
              </section>
            </div>
          ) : (
            <div className="empty-state compact">
              <h3>No eval run selected</h3>
              <p>Run a local benchmark from the CLI to inspect task results, safety gates, and promotion evidence here.</p>
            </div>
          )}
        </aside>
      </section>

      <section className="affordance-layout skills-layout">
        <div className="memory-section">
          <div className="memory-section-heading">
            <h3>Variants</h3>
            <span>{variants.length}</span>
          </div>
          <div className="version-list">
            {variants.map((variant) => (
              <div className="version-row" key={variant.id}>
                <span>{variant.name}</span>
                <span className={`severity-pill ${statusClass(variant.state)}`}>{variant.state}</span>
                <span>{variant.mutationType}</span>
                <code>{variant.skillId}</code>
              </div>
            ))}
          </div>
        </div>
        <div className="memory-section">
          <div className="memory-section-heading">
            <h3>Leaderboard</h3>
            <span>{selectedDataset?.id ?? "none"}</span>
          </div>
          <div className="version-list">
            {leaderboard.map((entry) => (
              <div className="version-row" key={entry.id}>
                <strong>#{entry.rank ?? "-"}</strong>
                <span>{entry.targetId}</span>
                <span>{formatScore(entry.compositeScore)}</span>
                <span>{formatTimestamp(entry.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
