import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { CheckCircle2, PlayCircle, RotateCcw, Sparkles } from "lucide-react";
import { squidbotApi } from "../lib/api";
import type { SkillDetailDto, SkillDto, SkillEvaluationResultDto } from "../types";

/**
 * Reusable skills (procedural memory) panel. Used in two places:
 *   1. SkillsPage (standalone — the existing route).
 *   2. SettingsPage tab (Task 1.7 will render it inside the tabbed shell).
 *
 * The page wrapper owns the <main> + <header> chrome; this component returns
 * only the body content. The section exposes `refresh()` via a
 * `SkillsSectionHandle` ref so the owning page can keep its Refresh button
 * in the `page-header` strip (the original visual location) without the
 * section having to know about the button's chrome.
 */

export type SkillsSectionHandle = {
  refresh: () => Promise<void>;
};

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "None";
}

function statusClass(status: string): string {
  if (status === "approved") {
    return "resolved";
  }
  if (status === "archived") {
    return "high";
  }
  return "medium";
}

function formatRate(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export const SkillsSection = forwardRef<SkillsSectionHandle>((_props, ref) => {
  const [skills, setSkills] = useState<SkillDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillDetailDto | null>(null);
  const [latestEvaluation, setLatestEvaluation] = useState<SkillEvaluationResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedSkill = useMemo(() => skills.find((skill) => skill.id === selectedId) ?? skills[0] ?? null, [skills, selectedId]);

  async function refresh(): Promise<void> {
    setError(null);
    const nextSkills = await squidbotApi.listSkills();
    setSkills(nextSkills);
    const nextSelected = selectedId && nextSkills.some((skill) => skill.id === selectedId) ? selectedId : nextSkills[0]?.id ?? null;
    setSelectedId(nextSelected);
    if (nextSelected) {
      setDetail(await squidbotApi.getSkill(nextSelected));
    } else {
      setDetail(null);
    }
  }

  useEffect(() => {
    void refresh().catch((nextError: unknown) => setError(nextError instanceof Error ? nextError.message : "Unable to load skills."));
  }, []);

  useEffect(() => {
    if (!selectedSkill) {
      setDetail(null);
      return;
    }
    void squidbotApi
      .getSkill(selectedSkill.id)
      .then(setDetail)
      .catch((nextError: unknown) => setError(nextError instanceof Error ? nextError.message : "Unable to load skill."));
  }, [selectedSkill?.id]);

  // Expose `refresh` to the owning page so the Refresh button can live in
  // the page-header strip (its original location) while the data-loading
  // logic stays encapsulated here.
  useImperativeHandle(ref, () => ({ refresh }), []);

  async function evaluateSelected(): Promise<void> {
    if (!detail?.skill || !detail.version) {
      return;
    }
    const evaluation = await squidbotApi.evaluateSkill(detail.skill.id, detail.version.version);
    setLatestEvaluation(evaluation);
    setDetail(await squidbotApi.getSkill(detail.skill.id));
  }

  async function promoteSelected(): Promise<void> {
    if (!detail?.skill || !detail.version) {
      return;
    }
    await squidbotApi.promoteSkill(detail.skill.id, detail.version.version);
    await refresh();
  }

  async function rollbackTo(version: string): Promise<void> {
    if (!detail?.skill) {
      return;
    }
    await squidbotApi.rollbackSkill(detail.skill.id, version);
    await refresh();
  }

  async function runSelected(): Promise<void> {
    if (!detail?.skill || !detail.version) {
      return;
    }
    const result = await squidbotApi.runSkill(detail.skill.id, { version: detail.version.version, test: true });
    setError(`Skill run created ${result.runId}`);
  }

  return (
    <>
      {error ? <div className="error-strip">{error}</div> : null}

      <section className="affordance-layout skills-layout">
        <div className="memory-section affordance-table-section">
          <div className="memory-section-heading">
            <h3>Installed skills</h3>
            <span>{skills.length}</span>
          </div>
          {skills.length === 0 ? (
            <div className="empty-state compact">
              <h3>No skills yet</h3>
              <p>Capture a useful run with the CLI to create a draft skill package.</p>
            </div>
          ) : (
            <div className="affordance-table skill-table" role="table" aria-label="Skills">
              <div className="affordance-table-head" role="row">
                <span>Status</span>
                <span>Name</span>
                <span>Version</span>
                <span>Updated</span>
              </div>
              {skills.map((skill) => (
                <button
                  className={`affordance-row ${selectedSkill?.id === skill.id ? "active" : ""}`}
                  key={skill.id}
                  onClick={() => setSelectedId(skill.id)}
                  role="row"
                  type="button"
                >
                  <span className={`severity-pill ${statusClass(skill.status)}`}>{skill.status}</span>
                  <strong>{skill.name}</strong>
                  <span>{skill.currentVersion}</span>
                  <span>{formatTimestamp(skill.updatedAt)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <aside className="memory-section affordance-detail-section skill-detail-section">
          <div className="memory-section-heading">
            <h3>Skill detail</h3>
            <span>{detail?.version?.version ?? "none"}</span>
          </div>
          {detail?.skill && detail.version ? (
            <div className="affordance-detail skill-detail">
              <div className="detail-kv">
                <span>ID</span>
                <code>{detail.skill.id}</code>
              </div>
              <div className="detail-kv">
                <span>Status</span>
                <strong>{detail.skill.status}</strong>
              </div>
              <div className="detail-kv">
                <span>Author</span>
                <strong>{detail.version.manifest.author}</strong>
              </div>
              <p>{detail.version.manifest.description}</p>

              <div className="button-row">
                <button className="secondary-button" type="button" onClick={() => void evaluateSelected()}>
                  <Sparkles size={15} />
                  <span>Evaluate</span>
                </button>
                <button className="secondary-button" type="button" onClick={() => void promoteSelected()}>
                  <CheckCircle2 size={15} />
                  <span>Promote</span>
                </button>
                <button className="secondary-button" type="button" onClick={() => void runSelected()}>
                  <PlayCircle size={15} />
                  <span>Run Test</span>
                </button>
              </div>

              <section className="trace-artifact">
                <h4>Required tools</h4>
                <pre>{JSON.stringify(detail.version.manifest.requiredTools, null, 2)}</pre>
              </section>
              <section className="trace-artifact">
                <h4>Prompts</h4>
                <pre>{JSON.stringify(detail.version.prompts, null, 2)}</pre>
              </section>
              <section className="trace-artifact">
                <h4>Fixtures</h4>
                <pre>{JSON.stringify(detail.version.testFixtures, null, 2)}</pre>
              </section>
              <section className="trace-artifact">
                <h4>Evaluation</h4>
                <pre>{JSON.stringify(latestEvaluation ?? detail.version.evaluation ?? detail.evaluations[0]?.result ?? null, null, 2)}</pre>
              </section>
              <section className="trace-artifact">
                <h4>Versions</h4>
                <div className="version-list">
                  {detail.versions.map((version) => (
                    <button className="version-row" key={version.id} type="button" onClick={() => void rollbackTo(version.version)}>
                      <RotateCcw size={14} />
                      <span>{version.version}</span>
                      <span className={`severity-pill ${statusClass(version.status)}`}>{version.status}</span>
                      <span>{version.evaluation ? formatRate(version.evaluation.metrics.successRate) : "not evaluated"}</span>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <div className="empty-state compact">
              <h3>No skill selected</h3>
              <p>Select a skill to inspect its manifest, prompts, fixtures, and evaluation history.</p>
            </div>
          )}
        </aside>
      </section>
    </>
  );
});

SkillsSection.displayName = "SkillsSection";
