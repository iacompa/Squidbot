import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Braces,
  CheckCircle2,
  Clock3,
  Database,
  FileDiff,
  GitCompareArrows,
  Plug,
  Search,
  Shield,
  Sparkles,
  TerminalSquare,
  Wrench
} from "lucide-react";
import type { TraceDto, TraceMetricsDto, TraceStepDto } from "../types";

type TraceViewerPageProps = {
  trace: TraceDto;
  metrics: TraceMetricsDto;
};

type TimelineFilter = {
  type: string;
  provider: string;
  tool: string;
  text: string;
};

function formatMs(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}s`;
  }
  return `${Math.round(value)}ms`;
}

function formatCost(value: number): string {
  return value > 0 ? `$${value.toFixed(4)}` : "$0.0000";
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  });
}

function hasRedaction(value: unknown): boolean {
  return JSON.stringify(value).includes("[REDACTED");
}

function eventIcon(type: string) {
  if (type.startsWith("model.")) {
    return Bot;
  }
  if (type.startsWith("tool.") || type === "test.run") {
    return Wrench;
  }
  if (type.startsWith("connector.")) {
    return Plug;
  }
  if (type.startsWith("sandbox.")) {
    return TerminalSquare;
  }
  if (type.startsWith("memory.")) {
    return Database;
  }
  if (type.startsWith("affordance.")) {
    return AlertTriangle;
  }
  if (type.startsWith("skill.")) {
    return Sparkles;
  }
  if (type === "reflection.created") {
    return GitCompareArrows;
  }
  return Braces;
}

function stepMatches(step: TraceStepDto, filter: TimelineFilter): boolean {
  if (filter.type && step.type !== filter.type) {
    return false;
  }
  if (filter.provider && String(step.detail.provider ?? step.detail.fromProvider ?? "") !== filter.provider) {
    return false;
  }
  if (filter.tool && String(step.detail.toolName ?? step.detail.command ?? step.detail.connectorName ?? "") !== filter.tool) {
    return false;
  }
  if (filter.text.trim() && !JSON.stringify(step).toLowerCase().includes(filter.text.trim().toLowerCase())) {
    return false;
  }
  return true;
}

function getPatch(step: TraceStepDto): string | null {
  const output = step.detail.output && typeof step.detail.output === "object" ? (step.detail.output as Record<string, unknown>) : null;
  if (typeof step.detail.patch === "string") {
    return step.detail.patch;
  }
  if (typeof step.detail.diff === "string") {
    return step.detail.diff;
  }
  if (typeof output?.patch === "string") {
    return output.patch;
  }
  return null;
}

function eventDuration(trace: TraceDto, step: TraceStepDto, index: number): number {
  if (typeof step.detail.durationMs === "number") {
    return step.detail.durationMs;
  }
  const next = trace.steps[index + 1];
  if (!next) {
    return 0;
  }
  return Math.max(0, new Date(next.timestamp).getTime() - new Date(step.timestamp).getTime());
}

function extractPlanRows(trace: TraceDto): Array<{ description: string; toolName: string; actual: string }> {
  const planStep = trace.steps.find((step) => step.type === "plan.generated");
  const plan = planStep?.detail.plan && typeof planStep.detail.plan === "object" ? (planStep.detail.plan as Record<string, unknown>) : null;
  const actions = Array.isArray(plan?.actions) ? (plan.actions as Array<Record<string, unknown>>) : [];
  const actualTools = new Set(
    trace.steps
      .filter((step) => step.type === "tool.call" || step.type === "tool.denied" || step.type === "sandbox.command")
      .map((step) => String(step.detail.toolName ?? step.detail.command ?? ""))
      .filter(Boolean)
  );

  return actions.map((action) => {
    const toolName = String(action.toolName ?? "unknown");
    return {
      description: String(action.description ?? toolName),
      toolName,
      actual: actualTools.has(toolName) ? "executed" : "not observed"
    };
  });
}

function BarRow({ label, value, max, detail }: { label: string; value: number; max: number; detail: string }) {
  const width = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 4;
  return (
    <div className="waterfall-row">
      <span>{label}</span>
      <div className="waterfall-track">
        <div className="waterfall-bar" style={{ width: `${width}%` }} />
      </div>
      <strong>{detail}</strong>
    </div>
  );
}

export function TraceViewerPage({ trace, metrics }: TraceViewerPageProps) {
  const [filter, setFilter] = useState<TimelineFilter>({ type: "", provider: "", tool: "", text: "" });
  const [selectedEventId, setSelectedEventId] = useState<string>(trace.steps[0]?.id ?? "");
  const eventTypes = useMemo(() => [...new Set(trace.steps.map((step) => step.type))].sort(), [trace.steps]);
  const providers = useMemo(
    () =>
      [
        ...new Set(
          trace.steps
            .map((step) => String(step.detail.provider ?? step.detail.fromProvider ?? ""))
            .filter((value) => value.trim())
        )
      ].sort(),
    [trace.steps]
  );
  const tools = useMemo(
    () =>
      [
        ...new Set(
          trace.steps
            .map((step) => String(step.detail.toolName ?? step.detail.command ?? step.detail.connectorName ?? ""))
            .filter((value) => value.trim())
        )
      ].sort(),
    [trace.steps]
  );
  const filteredSteps = useMemo(() => trace.steps.filter((step) => stepMatches(step, filter)), [trace.steps, filter]);
  const selectedEvent = trace.steps.find((step) => step.id === selectedEventId) ?? filteredSteps[0] ?? trace.steps[0] ?? null;
  const selectedIndex = selectedEvent ? trace.steps.findIndex((step) => step.id === selectedEvent.id) : -1;
  const selectedPatch = selectedEvent ? getPatch(selectedEvent) : null;
  const planRows = useMemo(() => extractPlanRows(trace), [trace]);
  const maxTypeDuration = metrics.eventTypeBreakdown.reduce((max, item) => Math.max(max, item.durationMs), 0);
  const maxProviderCost = metrics.providerBreakdown.reduce((max, item) => Math.max(max, item.cost), 0);

  return (
    <section className="trace-viewer">
      <div className="trace-filter-bar">
        <label className="search-input-row">
          <Search size={15} />
          <input
            aria-label="Search trace events"
            placeholder="Search prompts, tool args, outputs"
            value={filter.text}
            onChange={(event) => setFilter((current) => ({ ...current, text: event.target.value }))}
          />
        </label>
        <select
          aria-label="Event type"
          value={filter.type}
          onChange={(event) => setFilter((current) => ({ ...current, type: event.target.value }))}
        >
          <option value="">All event types</option>
          {eventTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <select
          aria-label="Provider"
          value={filter.provider}
          onChange={(event) => setFilter((current) => ({ ...current, provider: event.target.value }))}
        >
          <option value="">All providers</option>
          {providers.map((provider) => (
            <option key={provider} value={provider}>
              {provider}
            </option>
          ))}
        </select>
        <select
          aria-label="Tool"
          value={filter.tool}
          onChange={(event) => setFilter((current) => ({ ...current, tool: event.target.value }))}
        >
          <option value="">All tools</option>
          {tools.map((tool) => (
            <option key={tool} value={tool}>
              {tool}
            </option>
          ))}
        </select>
      </div>

      <div className="trace-metric-grid">
        <div>
          <span>Duration</span>
          <strong>{formatMs(metrics.durationMs)}</strong>
        </div>
        <div>
          <span>Cost estimate</span>
          <strong>{formatCost(metrics.totalCost)}</strong>
        </div>
        <div>
          <span>Tokens</span>
          <strong>{metrics.totalTokens}</strong>
        </div>
        <div>
          <span>Redactions</span>
          <strong>{trace.summary.redactionCount ?? 0}</strong>
        </div>
      </div>

      <div className="trace-workspace">
        <ol className="trace-timeline" aria-label="Trace timeline">
          {filteredSteps.map((step) => {
            const Icon = eventIcon(step.type);
            const index = trace.steps.findIndex((candidate) => candidate.id === step.id);
            return (
              <li key={step.id}>
                <button
                  className={`trace-event-button ${selectedEvent?.id === step.id ? "active" : ""}`}
                  onClick={() => setSelectedEventId(step.id)}
                  type="button"
                >
                  <Icon size={16} />
                  <span>
                    <strong>{step.label}</strong>
                    <small>
                      {step.type} · {formatTime(step.timestamp)} · {formatMs(eventDuration(trace, step, index))}
                    </small>
                  </span>
                  {hasRedaction(step.detail) ? <Shield className="redaction-shield" size={15} /> : null}
                </button>
              </li>
            );
          })}
        </ol>

        <aside className="trace-detail-pane">
          {selectedEvent ? (
            <>
              <div className="trace-detail-header">
                <div>
                  <p className="section-label">Event detail</p>
                  <h3>{selectedEvent.label}</h3>
                </div>
                <span className="severity-pill resolved">{selectedEvent.type}</span>
              </div>
              <div className="trace-detail-meta">
                <span>
                  <Clock3 size={14} />
                  {formatTime(selectedEvent.timestamp)}
                </span>
                <span>Step {selectedIndex + 1}</span>
                <span>{formatMs(eventDuration(trace, selectedEvent, selectedIndex))}</span>
                {hasRedaction(selectedEvent.detail) ? (
                  <span>
                    <Shield size={14} />
                    redacted
                  </span>
                ) : null}
              </div>
              {selectedEvent.type === "memory.retrieved" && typeof selectedEvent.detail.bulletin === "string" ? (
                <section className="trace-artifact">
                  <h4>Memory bulletin</h4>
                  <pre>{selectedEvent.detail.bulletin}</pre>
                </section>
              ) : null}
              {selectedPatch ? (
                <section className="trace-artifact diff-artifact">
                  <h4>Diff</h4>
                  <pre>{selectedPatch}</pre>
                </section>
              ) : null}
              <section className="trace-artifact">
                <h4>Metadata</h4>
                <pre>{JSON.stringify(selectedEvent.detail, null, 2)}</pre>
              </section>
            </>
          ) : (
            <div className="empty-state compact">
              <h3>No event selected</h3>
              <p>Use the timeline to inspect prompts, tool calls, outputs, approvals, and diffs.</p>
            </div>
          )}
        </aside>
      </div>

      <div className="trace-analysis-grid">
        <section className="trace-artifact">
          <h4>Cost waterfall</h4>
          {metrics.providerBreakdown.length === 0 ? (
            <p className="muted-copy">No cost-bearing provider calls recorded.</p>
          ) : (
            metrics.providerBreakdown.map((item) => (
              <BarRow
                detail={`${formatCost(item.cost)} · ${item.totalTokens} tokens`}
                key={`${item.provider}-${item.costOwner}`}
                label={`${item.provider} (${item.costOwner})`}
                max={maxProviderCost}
                value={item.cost}
              />
            ))
          )}
        </section>
        <section className="trace-artifact">
          <h4>Duration breakdown</h4>
          {metrics.eventTypeBreakdown.slice(0, 8).map((item) => (
            <BarRow
              detail={`${item.count} events · ${formatMs(item.durationMs)}`}
              key={item.type}
              label={item.type}
              max={maxTypeDuration}
              value={item.durationMs}
            />
          ))}
        </section>
      </div>

      {planRows.length ? (
        <section className="trace-artifact">
          <h4>Planned vs actual</h4>
          <div className="plan-actual-table">
            {planRows.map((row) => (
              <div key={`${row.toolName}-${row.description}`}>
                <span>
                  {row.actual === "executed" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                  {row.actual}
                </span>
                <strong>{row.toolName}</strong>
                <p>{row.description}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}
