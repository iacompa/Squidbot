import { RefreshCw } from "lucide-react";
import type { TraceDto } from "../types";

type TracesPageProps = {
  trace: TraceDto | null;
  traces: TraceDto[];
  onRefresh: () => Promise<void>;
  onSelectTrace: (traceId: string) => void;
};

function getNestedRecord(value: unknown, key: string): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const nested = record[key];
  return nested && typeof nested === "object" ? (nested as Record<string, unknown>) : null;
}

function extractPatch(detail: Record<string, unknown>): string | null {
  const output = getNestedRecord(detail, "output");
  const directPatch = detail.patch;
  const outputPatch = output?.patch;
  if (typeof directPatch === "string") {
    return directPatch;
  }

  return typeof outputPatch === "string" ? outputPatch : null;
}

function extractTestResult(detail: Record<string, unknown>): Record<string, unknown> | null {
  return getNestedRecord(detail, "result") ?? getNestedRecord(detail, "output");
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isConnectorEvent(type: string): boolean {
  return type === "connector.call" || type === "connector.fixture" || type === "connector.denied";
}

function isModelEvent(type: string): boolean {
  return type.startsWith("model.");
}

function isSandboxEvent(type: string): boolean {
  return type.startsWith("sandbox.");
}

function traceDisplayTitle(trace: TraceDto): string {
  const firstUserStep = trace.steps.find((step) => step.type === "user.message" || step.type === "user.task");
  const firstUserDetail = firstUserStep?.detail ?? {};
  return getString(firstUserDetail.content) ?? getString(firstUserDetail.task) ?? `Run ${trace.runId}`;
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");
  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  });

  return time.replace(/(\d{1,2}:\d{2}:\d{2})(.*)/, `$1.${milliseconds}$2`);
}

function formatElapsed(startMs: number, timestamp: string): string {
  const elapsed = new Date(timestamp).getTime() - startMs;
  return `+${Math.max(0, elapsed)}ms`;
}

export function TracesPage({ trace, traces, onRefresh, onSelectTrace }: TracesPageProps) {
  const firstUserStep = trace?.steps.find((step) => step.type === "user.message" || step.type === "user.task");
  const firstUserDetail = firstUserStep?.detail ?? {};
  const traceTitle =
    getString(firstUserDetail.content) ?? getString(firstUserDetail.task) ?? (trace ? `Run ${trace.runId}` : null);
  const traceStartMs = trace?.steps[0] ? new Date(trace.steps[0].timestamp).getTime() : 0;
  const affordanceGapCount = trace?.steps.filter((step) => step.type === "affordance.gap").length ?? 0;
  const sandboxEventCount = trace?.steps.filter((step) => isSandboxEvent(step.type)).length ?? 0;

  return (
    <main className="page-panel">
      <header className="page-header">
        <div>
          <p className="section-label">Traces</p>
          <h2>Latest run</h2>
        </div>
        <button className="secondary-button" type="button" onClick={() => void onRefresh()}>
          <RefreshCw size={17} />
          <span>Refresh</span>
        </button>
      </header>

      {!trace ? (
        <div className="empty-state">
          <h3>No trace recorded</h3>
          <p>Send a chat message to create the first event trail.</p>
        </div>
      ) : (
        <section className="trace-layout">
          {traces.length > 1 ? (
            <label className="trace-picker">
              <span>Recent traces</span>
              <select value={trace.id} onChange={(event) => onSelectTrace(event.target.value)}>
                {traces.map((item) => (
                  <option key={item.id} value={item.id}>
                    {formatTimestamp(item.createdAt)} - {traceDisplayTitle(item)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="trace-summary">
            <div>
              <span>Latest trace</span>
              <strong>{traceTitle}</strong>
            </div>
            <div>
              <span>Recorded</span>
              <strong>{formatTimestamp(trace.createdAt)}</strong>
            </div>
          </div>

          <div className="trace-summary">
            <div>
              <span>Provider</span>
              <strong>{trace.summary.provider}</strong>
            </div>
            <div>
              <span>Cost owner</span>
              <strong>{trace.summary.costOwner}</strong>
            </div>
            <div>
              <span>Events</span>
              <strong>{trace.summary.eventCount}</strong>
            </div>
            <div>
              <span>Tools</span>
              <strong>{trace.summary.toolCallCount}</strong>
            </div>
            <div>
              <span>Gaps</span>
              <strong>{affordanceGapCount}</strong>
            </div>
            <div>
              <span>Sandbox</span>
              <strong>{sandboxEventCount}</strong>
            </div>
          </div>

          <ol className="trace-steps">
            {trace.steps.map((step, index) => (
              <li className="trace-step" key={step.id}>
                <div className="step-index">{index + 1}</div>
                <div className="step-body">
                  <div className="step-title-row">
                    <strong>{step.label}</strong>
                    <div className="step-time">
                      <time dateTime={step.timestamp}>{formatTimestamp(step.timestamp)}</time>
                      <em>{formatElapsed(traceStartMs, step.timestamp)}</em>
                    </div>
                  </div>
                  <code>{step.type}</code>
                  <details>
                    <summary>Details</summary>
                    {extractPatch(step.detail) ? (
                      <section className="trace-artifact">
                        <h4>Draft patch</h4>
                        <pre>{extractPatch(step.detail)}</pre>
                      </section>
                    ) : null}
                    {step.type === "test.run" && extractTestResult(step.detail) ? (
                      <section className="trace-artifact">
                        <h4>Test result</h4>
                        <div className="test-meta">
                          <span>Exit: {String(extractTestResult(step.detail)?.exitCode ?? "unknown")}</span>
                          <span>Mode: {extractTestResult(step.detail)?.dryRun ? "dry run" : "copied workspace"}</span>
                        </div>
                        {typeof extractTestResult(step.detail)?.stdout === "string" &&
                        String(extractTestResult(step.detail)?.stdout).trim() ? (
                          <pre>{String(extractTestResult(step.detail)?.stdout).trim()}</pre>
                        ) : null}
                        {typeof extractTestResult(step.detail)?.stderr === "string" &&
                        String(extractTestResult(step.detail)?.stderr).trim() ? (
                          <pre>{String(extractTestResult(step.detail)?.stderr).trim()}</pre>
                        ) : null}
                      </section>
                    ) : null}
                    {step.type === "memory.retrieved" && getString(step.detail.bulletin) ? (
                      <section className="trace-artifact">
                        <h4>Memory bulletin</h4>
                        <pre>{getString(step.detail.bulletin)}</pre>
                      </section>
                    ) : null}
                    {step.type === "reflection.created" ? (
                      <section className="trace-artifact">
                        <h4>Reflection</h4>
                        <div className="test-meta">
                          <span>{String(step.detail.outcome ?? "unknown")}</span>
                          <span>
                            candidates{" "}
                            {Array.isArray(step.detail.memoryCandidates) ? step.detail.memoryCandidates.length : 0}
                          </span>
                        </div>
                        {getString(step.detail.summary) ? <pre>{getString(step.detail.summary)}</pre> : null}
                      </section>
                    ) : null}
                    {step.type === "memory.candidate" && getNestedRecord(step.detail, "candidate") ? (
                      <section className="trace-artifact">
                        <h4>Memory candidate</h4>
                        <pre>{JSON.stringify(getNestedRecord(step.detail, "candidate"), null, 2)}</pre>
                      </section>
                    ) : null}
                    {step.type === "memory.approved" && getNestedRecord(step.detail, "candidate") ? (
                      <section className="trace-artifact">
                        <h4>Approved memory</h4>
                        <pre>{JSON.stringify(getNestedRecord(step.detail, "candidate"), null, 2)}</pre>
                      </section>
                    ) : null}
                    {step.type === "affordance.gap" && getNestedRecord(step.detail, "gap") ? (
                      <section className="trace-artifact">
                        <h4>Affordance gap</h4>
                        <div className="test-meta">
                          <span>{String(step.detail.gapType ?? "gap")}</span>
                          <span>{String(getNestedRecord(step.detail, "gap")?.severity ?? "medium")}</span>
                          <span>{String(getNestedRecord(step.detail, "gap")?.status ?? "open")}</span>
                        </div>
                        <pre>{JSON.stringify(getNestedRecord(step.detail, "gap"), null, 2)}</pre>
                      </section>
                    ) : null}
                    {isSandboxEvent(step.type) ? (
                      <section className="trace-artifact">
                        <h4>Sandbox</h4>
                        <div className="test-meta">
                          <span>{String(step.detail.sandboxId ?? "sandbox")}</span>
                          <span>{String(step.detail.exitCode ?? step.detail.status ?? step.type.replace("sandbox.", ""))}</span>
                          <span>{String(step.detail.networkPolicy ?? step.detail.reason ?? "staged")}</span>
                        </div>
                        <pre>{JSON.stringify(step.detail, null, 2)}</pre>
                      </section>
                    ) : null}
                    {isConnectorEvent(step.type) ? (
                      <section className="trace-artifact">
                        <h4>Connector event</h4>
                        <div className="test-meta">
                          <span>{String(step.detail.connectorName ?? "unknown")}</span>
                          <span>{String(step.detail.operationName ?? "operation")}</span>
                          <span>{String(step.detail.mode ?? step.type.replace("connector.", ""))}</span>
                        </div>
                        {step.type === "connector.fixture" && step.detail.response !== undefined ? (
                          <pre>{JSON.stringify(step.detail.response, null, 2)}</pre>
                        ) : null}
                        {step.type === "connector.denied" && getString(step.detail.reason) ? (
                          <pre>{getString(step.detail.reason)}</pre>
                        ) : null}
                      </section>
                    ) : null}
                    {isModelEvent(step.type) ? (
                      <section className="trace-artifact">
                        <h4>Model event</h4>
                        <div className="test-meta">
                          <span>{String(step.detail.provider ?? step.detail.fromProvider ?? "model")}</span>
                          <span>{String(step.detail.mode ?? step.type.replace("model.", ""))}</span>
                          <span>{String(step.detail.costOwner ?? "cost owner unknown")}</span>
                        </div>
                        {"tokenUsage" in step.detail || "tokenEstimate" in step.detail ? (
                          <pre>
                            {JSON.stringify(
                              {
                                tokenUsage: step.detail.tokenUsage,
                                tokenEstimate: step.detail.tokenEstimate,
                                costEstimate: step.detail.costEstimate,
                                budgetTokens: step.detail.budgetTokens,
                                remainingTokens: step.detail.remainingTokens
                              },
                              null,
                              2
                            )}
                          </pre>
                        ) : null}
                        {getString(step.detail.message) ? <pre>{getString(step.detail.message)}</pre> : null}
                        {getString(step.detail.reason) ? <pre>{getString(step.detail.reason)}</pre> : null}
                      </section>
                    ) : null}
                    <pre>{JSON.stringify(step.detail, null, 2)}</pre>
                  </details>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
