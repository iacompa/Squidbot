import { useEffect, useMemo, useState } from "react";
import { PauseCircle, PlayCircle, RefreshCw, Trash2 } from "lucide-react";
import { squidbotApi } from "../lib/api";
import type { JobDetailDto, JobDto } from "../types";

type JobStatusFilter = "active" | "paused" | "running" | "completed" | "all";

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "None";
}

function statusClass(status: string): string {
  if (status === "active" || status === "success") {
    return "resolved";
  }
  if (status === "failure" || status === "completed") {
    return "high";
  }
  return "medium";
}

const initialForm = {
  name: "",
  type: "task" as "task" | "skill",
  refId: "",
  version: "",
  schedule: "every weekday at 9am",
  workspacePath: "",
  testCommand: "",
  testMode: true
};

export function JobsPage() {
  const [status, setStatus] = useState<JobStatusFilter>("active");
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobDetailDto | null>(null);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState<string | null>(null);
  const selectedJob = useMemo(() => jobs.find((job) => job.id === selectedId) ?? jobs[0] ?? null, [jobs, selectedId]);

  async function refresh(): Promise<void> {
    setError(null);
    const nextJobs = await squidbotApi.listJobs({ status, limit: 100 });
    setJobs(nextJobs);
    const nextSelected = selectedId && nextJobs.some((job) => job.id === selectedId) ? selectedId : nextJobs[0]?.id ?? null;
    setSelectedId(nextSelected);
    setDetail(nextSelected ? await squidbotApi.getJob(nextSelected) : null);
  }

  useEffect(() => {
    void refresh().catch((nextError: unknown) => setError(nextError instanceof Error ? nextError.message : "Unable to load jobs."));
  }, [status]);

  useEffect(() => {
    if (!selectedJob) {
      setDetail(null);
      return;
    }
    void squidbotApi
      .getJob(selectedJob.id)
      .then(setDetail)
      .catch((nextError: unknown) => setError(nextError instanceof Error ? nextError.message : "Unable to load job."));
  }, [selectedJob?.id]);

  function reportError(prefix: string, caught: unknown): void {
    setError(`${prefix}: ${caught instanceof Error ? caught.message : String(caught)}`);
  }

  async function createJob(): Promise<void> {
    setError(null);
    try {
      const job = await squidbotApi.createJob({
        name: form.name,
        type: form.type,
        refId: form.refId,
        version: form.type === "skill" && form.version.trim() ? form.version.trim() : null,
        schedule: form.schedule,
        workspacePath: form.workspacePath.trim() || null,
        testCommand: form.testCommand.trim() || null,
        testMode: form.testMode
      });
      setForm({ ...initialForm, type: form.type });
      setStatus("all");
      setSelectedId(job.id);
      const nextJobs = await squidbotApi.listJobs({ status: "all", limit: 100 });
      setJobs(nextJobs);
      setDetail(await squidbotApi.getJob(job.id));
    } catch (caught) {
      reportError("Create job failed", caught);
    }
  }

  async function pauseSelected(): Promise<void> {
    if (!selectedJob) {
      return;
    }
    setError(null);
    try {
      await squidbotApi.pauseJob(selectedJob.id);
      await refresh();
    } catch (caught) {
      reportError("Pause failed", caught);
    }
  }

  async function resumeSelected(): Promise<void> {
    if (!selectedJob) {
      return;
    }
    setError(null);
    try {
      await squidbotApi.resumeJob(selectedJob.id);
      await refresh();
    } catch (caught) {
      reportError("Resume failed", caught);
    }
  }

  async function runSelectedNow(): Promise<void> {
    if (!selectedJob) {
      return;
    }
    setError(null);
    try {
      await squidbotApi.runJobNow(selectedJob.id);
      await refresh();
    } catch (caught) {
      reportError("Run-now failed", caught);
    }
  }

  async function removeSelected(): Promise<void> {
    if (!selectedJob) {
      return;
    }
    setError(null);
    try {
      await squidbotApi.removeJob(selectedJob.id);
      setSelectedId(null);
      await refresh();
    } catch (caught) {
      reportError("Remove failed", caught);
    }
  }

  return (
    <main className="page-panel jobs-page">
      <header className="page-header">
        <div>
          <p className="section-label">Local automation</p>
          <h2>Jobs</h2>
        </div>
        <button className="secondary-button" type="button" onClick={() => void refresh()}>
          <RefreshCw size={17} />
          <span>Refresh</span>
        </button>
      </header>

      {error ? <div className="error-strip">{error}</div> : null}

      <section className="affordance-toolbar">
        <label>
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as JobStatusFilter)}>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="all">All</option>
          </select>
        </label>
        <div className="affordance-count">
          <PlayCircle size={16} />
          <span>{jobs.length} jobs</span>
        </div>
      </section>

      <section className="job-form-panel">
        <div className="job-form-grid">
          <label>
            <span>Name</span>
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Daily repo check" />
          </label>
          <label>
            <span>Type</span>
            <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as "task" | "skill" })}>
              <option value="task">Task</option>
              <option value="skill">Skill</option>
            </select>
          </label>
          <label>
            <span>{form.type === "skill" ? "Skill ID" : "Task"}</span>
            <input
              value={form.refId}
              onChange={(event) => setForm({ ...form, refId: event.target.value })}
              placeholder={form.type === "skill" ? "skill_fix_add_bug" : "list files"}
            />
          </label>
          <label>
            <span>Version</span>
            <input disabled={form.type !== "skill"} value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })} placeholder="optional" />
          </label>
          <label>
            <span>Schedule</span>
            <input value={form.schedule} onChange={(event) => setForm({ ...form, schedule: event.target.value })} placeholder="*/15 * * * *" />
          </label>
          <label>
            <span>Workspace</span>
            <input value={form.workspacePath} onChange={(event) => setForm({ ...form, workspacePath: event.target.value })} placeholder="Use selected workspace" />
          </label>
          <label>
            <span>Test command</span>
            <input value={form.testCommand} onChange={(event) => setForm({ ...form, testCommand: event.target.value })} placeholder="pytest" />
          </label>
          <label className="checkbox-row">
            <input checked={form.testMode} type="checkbox" onChange={(event) => setForm({ ...form, testMode: event.target.checked })} />
            <span>Sandbox test mode</span>
          </label>
        </div>
        <button className="primary-button" type="button" onClick={() => void createJob()}>
          Create Job
        </button>
      </section>

      <section className="affordance-layout jobs-layout">
        <div className="memory-section affordance-table-section">
          <div className="memory-section-heading">
            <h3>Scheduled work</h3>
            <span>{status}</span>
          </div>
          {jobs.length === 0 ? (
            <div className="empty-state compact">
              <h3>No jobs in this view</h3>
              <p>Create a task or skill schedule to run local automation without any hosted scheduler.</p>
            </div>
          ) : (
            <div className="affordance-table job-table" role="table" aria-label="Jobs">
              <div className="affordance-table-head" role="row">
                <span>Status</span>
                <span>Name</span>
                <span>Type</span>
                <span>Next run</span>
                <span>Outcome</span>
              </div>
              {jobs.map((job) => (
                <button
                  className={`affordance-row ${selectedJob?.id === job.id ? "active" : ""}`}
                  key={job.id}
                  onClick={() => setSelectedId(job.id)}
                  role="row"
                  type="button"
                >
                  <span className={`severity-pill ${statusClass(job.status)}`}>{job.status}</span>
                  <strong>{job.name}</strong>
                  <span>{job.type}</span>
                  <span>{formatTimestamp(job.nextRunAt)}</span>
                  <span className={`severity-pill ${statusClass(job.lastOutcome)}`}>{job.lastOutcome}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <aside className="memory-section affordance-detail-section job-detail-section">
          <div className="memory-section-heading">
            <h3>Job detail</h3>
            <span>{detail?.job.status ?? "none"}</span>
          </div>
          {detail ? (
            <div className="affordance-detail job-detail">
              <div className="detail-kv">
                <span>ID</span>
                <code>{detail.job.id}</code>
              </div>
              <div className="detail-kv">
                <span>Reference</span>
                <code>
                  {detail.job.type}:{detail.job.refId}
                </code>
              </div>
              <div className="detail-kv">
                <span>Schedule</span>
                <strong>{detail.schedule.normalized}</strong>
              </div>
              <div className="detail-kv">
                <span>Workspace</span>
                <code>{detail.job.workspacePath ?? "Default workspace"}</code>
              </div>
              <div className="button-row">
                <button className="secondary-button" disabled={detail.job.status === "paused"} type="button" onClick={() => void pauseSelected()}>
                  <PauseCircle size={15} />
                  <span>Pause</span>
                </button>
                <button className="secondary-button" disabled={detail.job.status === "active"} type="button" onClick={() => void resumeSelected()}>
                  <PlayCircle size={15} />
                  <span>Resume</span>
                </button>
                <button className="secondary-button" type="button" onClick={() => void runSelectedNow()}>
                  <PlayCircle size={15} />
                  <span>Run Now</span>
                </button>
                <button className="secondary-button" type="button" onClick={() => void removeSelected()}>
                  <Trash2 size={15} />
                  <span>Remove</span>
                </button>
              </div>
              <section className="trace-artifact">
                <h4>Runs</h4>
                <pre>{JSON.stringify(detail.runs, null, 2)}</pre>
              </section>
              <section className="trace-artifact">
                <h4>Configuration</h4>
                <pre>{JSON.stringify(detail.job, null, 2)}</pre>
              </section>
            </div>
          ) : (
            <div className="empty-state compact">
              <h3>No job selected</h3>
              <p>Select scheduled work to inspect timing, history, and controls.</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
