import type { SquidDatabase } from "@squidbot/db";

// Observability export (O2). SquidBot keeps all telemetry local by default
// (chained-hash audit + trace replay are the built-in trust surface). This
// module turns that local data into the standard Prometheus text-exposition
// format, so an operator can scrape SquidBot into their own Prometheus /
// Grafana / OTel-collector stack — without the data ever leaving their infra.

export type MetricsSnapshot = {
  runsTotal: number;
  eventsByType: Record<string, number>;
  toolCallsTotal: number;
  toolDenialsTotal: number;
  errorsTotal: number;
  modelTokensByProvider: Record<string, number>;
  modelCostByProvider: Record<string, number>;
};

export function collectMetrics(database: SquidDatabase): MetricsSnapshot {
  const traces = database.listTraces(100_000, 0);
  const events = database.listEvents();
  const usage = database.listModelUsage(100_000);

  const eventsByType: Record<string, number> = {};
  for (const event of events) {
    eventsByType[event.type] = (eventsByType[event.type] ?? 0) + 1;
  }

  const modelTokensByProvider: Record<string, number> = {};
  const modelCostByProvider: Record<string, number> = {};
  for (const record of usage) {
    modelTokensByProvider[record.provider] = (modelTokensByProvider[record.provider] ?? 0) + record.tokens;
    modelCostByProvider[record.provider] = (modelCostByProvider[record.provider] ?? 0) + record.cost;
  }

  return {
    runsTotal: traces.length,
    eventsByType,
    toolCallsTotal: eventsByType["tool.call"] ?? 0,
    toolDenialsTotal: eventsByType["tool.denied"] ?? 0,
    errorsTotal: eventsByType["error"] ?? 0,
    modelTokensByProvider,
    modelCostByProvider
  };
}

export function exportPrometheusMetrics(database: SquidDatabase): string {
  const metrics = collectMetrics(database);
  const lines: string[] = [];

  const counter = (name: string, help: string, samples: Array<{ labels?: Record<string, string>; value: number }>): void => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} counter`);
    for (const sample of samples) {
      lines.push(`${name}${formatLabels(sample.labels)} ${formatValue(sample.value)}`);
    }
  };

  counter("squidbot_runs_total", "Total agent runs (traces) recorded.", [{ value: metrics.runsTotal }]);
  counter("squidbot_tool_calls_total", "Total tool invocations.", [{ value: metrics.toolCallsTotal }]);
  counter("squidbot_tool_denials_total", "Tool calls denied by governance/policy/validation.", [
    { value: metrics.toolDenialsTotal }
  ]);
  counter("squidbot_errors_total", "Errors recorded in the event log.", [{ value: metrics.errorsTotal }]);
  counter(
    "squidbot_events_total",
    "Event-log entries by type.",
    Object.entries(metrics.eventsByType).map(([type, value]) => ({ labels: { type }, value }))
  );
  counter(
    "squidbot_model_tokens_total",
    "Model tokens consumed, by provider.",
    Object.entries(metrics.modelTokensByProvider).map(([provider, value]) => ({ labels: { provider }, value }))
  );
  counter(
    "squidbot_model_cost_total",
    "Estimated model cost, by provider.",
    Object.entries(metrics.modelCostByProvider).map(([provider, value]) => ({ labels: { provider }, value }))
  );

  return `${lines.join("\n")}\n`;
}

function formatLabels(labels?: Record<string, string>): string {
  const entries = Object.entries(labels ?? {});
  if (entries.length === 0) {
    return "";
  }
  const rendered = entries.map(([key, value]) => `${key}="${escapeLabelValue(value)}"`).join(",");
  return `{${rendered}}`;
}

// Prometheus exposition rules: backslash, double-quote, and newline must be
// escaped in label values. Order matters — escape backslashes first.
function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}
