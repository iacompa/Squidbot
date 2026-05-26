import { useEffect, useMemo, useState } from "react";
import { GitPullRequestArrow, MessageSquareText, PlayCircle, RefreshCw, ShieldAlert, UsersRound } from "lucide-react";
import { squidbotApi } from "../lib/api";
import type { BlackboardEntryDto, HumanHandoffDto, TeamDto, TeamRunDetailDto, TeamRunDto } from "../types";

const initialForm = {
  name: "Engineering Core Team",
  roles: "coordinator,researcher,implementer,tester,reviewer",
  workspacePath: "",
  task: "Fix calculator add function, explain the root cause, and verify tests"
};

function statusClass(status: string): string {
  if (status === "completed" || status === "answered") {
    return "resolved";
  }
  if (status === "failed" || status === "open") {
    return "high";
  }
  return "medium";
}

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "None";
}

export function TeamsPage() {
  const [teams, setTeams] = useState<TeamDto[]>([]);
  const [runs, setRuns] = useState<TeamRunDto[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TeamRunDetailDto | null>(null);
  const [form, setForm] = useState(initialForm);
  const [handoffs, setHandoffs] = useState<HumanHandoffDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const selectedTeam = useMemo(() => teams.find((team) => team.id === selectedTeamId) ?? teams[0] ?? null, [teams, selectedTeamId]);
  const selectedRun = useMemo(() => runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null, [runs, selectedRunId]);

  async function refresh(): Promise<void> {
    setError(null);
    const nextTeams = await squidbotApi.listTeams();
    setTeams(nextTeams);
    const nextSelectedTeam = selectedTeamId && nextTeams.some((team) => team.id === selectedTeamId) ? selectedTeamId : nextTeams[0]?.id ?? null;
    setSelectedTeamId(nextSelectedTeam);
    const nextRuns = await squidbotApi.listTeamRuns(nextSelectedTeam ?? undefined);
    setRuns(nextRuns);
    const nextSelectedRun = selectedRunId && nextRuns.some((run) => run.id === selectedRunId) ? selectedRunId : nextRuns[0]?.id ?? null;
    setSelectedRunId(nextSelectedRun);
    setDetail(nextSelectedRun ? await squidbotApi.getTeamRun(nextSelectedRun) : null);
    setHandoffs(await squidbotApi.listTeamHandoffs("open"));
  }

  useEffect(() => {
    void refresh().catch((nextError: unknown) => setError(nextError instanceof Error ? nextError.message : "Unable to load teams."));
  }, []);

  useEffect(() => {
    if (!selectedTeam) {
      setRuns([]);
      setSelectedRunId(null);
      setDetail(null);
      return;
    }

    // When the user switches teams, immediately blank the runs+detail panes
    // so the previous team's data never shows under the new team's heading.
    // The cancelled flag drops any late responses from the previous team's
    // fetch chain (which would otherwise race past the new fetch and
    // overwrite it).
    setRuns([]);
    setSelectedRunId(null);
    setDetail(null);
    let cancelled = false;

    void squidbotApi
      .listTeamRuns(selectedTeam.id)
      .then((nextRuns) => {
        if (cancelled) return null;
        setRuns(nextRuns);
        const nextRunId = nextRuns[0]?.id ?? null;
        setSelectedRunId(nextRunId);
        return nextRunId ? squidbotApi.getTeamRun(nextRunId) : Promise.resolve(null);
      })
      .then((nextDetail) => {
        if (cancelled) return;
        setDetail(nextDetail);
      })
      .catch((nextError: unknown) => {
        if (cancelled) return;
        setError(nextError instanceof Error ? nextError.message : "Unable to load team runs.");
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTeam?.id]);

  useEffect(() => {
    if (!selectedRun) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void squidbotApi
      .getTeamRun(selectedRun.id)
      .then((nextDetail) => {
        if (cancelled) return;
        setDetail(nextDetail);
      })
      .catch((nextError: unknown) => {
        if (cancelled) return;
        setError(nextError instanceof Error ? nextError.message : "Unable to load team run.");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRun?.id]);

  async function createTeam(): Promise<void> {
    const team = await squidbotApi.createTeam({
      name: form.name,
      roles: form.roles.split(",").map((role) => role.trim()).filter(Boolean)
    });
    setSelectedTeamId(team.id);
    await refresh();
  }

  async function runTeam(): Promise<void> {
    if (!selectedTeam) {
      return;
    }
    const result = await squidbotApi.runTeamTask({
      teamId: selectedTeam.id,
      workspacePath: form.workspacePath.trim() || null,
      task: form.task,
      mode: "sandbox"
    });
    setSelectedRunId(result.run.id);
    await refresh();
  }

  async function answerHandoff(handoff: HumanHandoffDto, responseText: string): Promise<void> {
    await squidbotApi.answerTeamHandoff(handoff.id, responseText);
    await refresh();
  }

  return (
    <main className="page-panel teams-page">
      <header className="page-header">
        <div>
          <p className="section-label">Multi-agent coordinator</p>
          <h2>Teams</h2>
        </div>
        <button className="secondary-button" type="button" onClick={() => void refresh()}>
          <RefreshCw size={17} />
          <span>Refresh</span>
        </button>
      </header>

      {error ? <div className="error-strip">{error}</div> : null}

      <section className="job-form-panel">
        <div className="job-form-grid">
          <label>
            <span>Team name</span>
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label>
            <span>Roles</span>
            <input value={form.roles} onChange={(event) => setForm({ ...form, roles: event.target.value })} />
          </label>
          <label>
            <span>Workspace</span>
            <input value={form.workspacePath} onChange={(event) => setForm({ ...form, workspacePath: event.target.value })} placeholder="Use selected workspace" />
          </label>
          <label>
            <span>Task</span>
            <input value={form.task} onChange={(event) => setForm({ ...form, task: event.target.value })} />
          </label>
        </div>
        <div className="button-row">
          <button className="secondary-button" type="button" onClick={() => void createTeam()}>
            <UsersRound size={15} />
            <span>Create Team</span>
          </button>
          <button className="primary-button" disabled={!selectedTeam} type="button" onClick={() => void runTeam()}>
            <PlayCircle size={15} />
            <span>Run Team Task</span>
          </button>
        </div>
      </section>

      <section className="affordance-layout jobs-layout">
        <div className="memory-section affordance-table-section">
          <div className="memory-section-heading">
            <h3>Teams</h3>
            <span>{teams.length}</span>
          </div>
          {teams.map((team) => (
            <button className={`affordance-row ${selectedTeam?.id === team.id ? "active" : ""}`} key={team.id} onClick={() => setSelectedTeamId(team.id)} type="button">
              <span className={`severity-pill ${statusClass(team.status)}`}>{team.status}</span>
              <strong>{team.name}</strong>
              <span>{team.manifest.roles.join(", ")}</span>
              <span>{formatTimestamp(team.updatedAt)}</span>
            </button>
          ))}

          <div className="memory-section-heading">
            <h3>Runs</h3>
            <span>{runs.length}</span>
          </div>
          {runs.map((run) => (
            <button className={`affordance-row ${selectedRun?.id === run.id ? "active" : ""}`} key={run.id} onClick={() => setSelectedRunId(run.id)} type="button">
              <span className={`severity-pill ${statusClass(run.status)}`}>{run.status}</span>
              <strong>{run.task}</strong>
              <span>{run.coordinatorRoleId ?? "coordinator"}</span>
              <span>{formatTimestamp(run.createdAt)}</span>
            </button>
          ))}
        </div>

        <aside className="memory-section affordance-detail-section job-detail-section">
          <div className="memory-section-heading">
            <h3>Run detail</h3>
            <span>{detail?.run.status ?? "none"}</span>
          </div>
          {detail ? (
            <div className="affordance-detail job-detail">
              <div className="detail-kv">
                <span>Run ID</span>
                <code>{detail.run.id}</code>
              </div>
              <div className="detail-kv">
                <span>Task</span>
                <strong>{detail.run.task}</strong>
              </div>
              <section className="trace-artifact">
                <h4>Subtasks</h4>
                <div className="team-stack">
                  {detail.subtasks.map((subtask) => (
                    <div className="team-card" key={subtask.id}>
                      <span className={`severity-pill ${statusClass(subtask.status)}`}>{subtask.status}</span>
                      <strong>{subtask.title}</strong>
                      <span>{subtask.assignedRoleId ?? "unassigned"}</span>
                    </div>
                  ))}
                </div>
              </section>
              <TeamEntrySection entries={detail.blackboardEntries} />
              <section className="trace-artifact">
                <h4>
                  <MessageSquareText size={15} /> Messages
                </h4>
                <pre>{JSON.stringify(detail.messages, null, 2)}</pre>
              </section>
              <section className="trace-artifact">
                <h4>
                  <ShieldAlert size={15} /> Conflicts
                </h4>
                <pre>{JSON.stringify(detail.conflicts, null, 2)}</pre>
              </section>
              <section className="trace-artifact">
                <h4>
                  <GitPullRequestArrow size={15} /> Handoffs
                </h4>
                {detail.handoffs.length === 0 ? <p>No handoffs for this run.</p> : null}
                {detail.handoffs.map((handoff) => (
                  <div className="team-card" key={handoff.id}>
                    <span className={`severity-pill ${statusClass(handoff.status)}`}>{handoff.status}</span>
                    <strong>{handoff.question}</strong>
                    {handoff.status === "open" ? (
                      <div className="button-row">
                        <button className="secondary-button" type="button" onClick={() => void answerHandoff(handoff, "approve fixture only")}>
                          Approve Fixture
                        </button>
                        <button className="secondary-button" type="button" onClick={() => void answerHandoff(handoff, "reject")}>
                          Reject
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </section>
            </div>
          ) : (
            <div className="empty-state compact">
              <h3>No team run selected</h3>
              <p>Create or run a team task to inspect subtasks, blackboard entries, conflicts, and handoffs.</p>
            </div>
          )}
        </aside>
      </section>

      {handoffs.length > 0 ? (
        <section className="trace-artifact">
          <h4>Open handoffs</h4>
          <pre>{JSON.stringify(handoffs, null, 2)}</pre>
        </section>
      ) : null}
    </main>
  );
}

function TeamEntrySection({ entries }: { entries: BlackboardEntryDto[] }) {
  const grouped = entries.reduce<Record<string, BlackboardEntryDto[]>>((accumulator, entry) => {
    accumulator[entry.type] = [...(accumulator[entry.type] ?? []), entry];
    return accumulator;
  }, {});
  return (
    <section className="trace-artifact">
      <h4>Blackboard</h4>
      <div className="team-stack">
        {Object.entries(grouped).map(([type, group]) => (
          <div className="team-card" key={type}>
            <span className="severity-pill medium">{type}</span>
            {group.map((entry) => (
              <div key={entry.id}>
                <strong>{entry.title}</strong>
                <p>{entry.body}</p>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
