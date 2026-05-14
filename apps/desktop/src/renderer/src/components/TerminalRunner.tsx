import { useEffect, useState } from "react";
import { Play, RefreshCw, Terminal } from "lucide-react";
import { squidbotApi } from "../lib/api";
import type { CommandRunResultDto, SquidbotCommandDescriptorDto, SquidbotCommandId } from "../types";

export type TerminalRunnerProps = {
  /**
   * If provided, only these whitelisted commands appear in the picker. Default
   * shows everything the backend exposes (the full safe-command registry).
   */
  allowedCommands?: SquidbotCommandId[];
  /** Default selected command id. */
  defaultCommandId?: SquidbotCommandId;
  /** Optional heading shown above the runner. */
  title?: string;
};

/**
 * Terminal-style panel embedded in the app: a command picker, a "Run" button,
 * and a styled output area. Every command runs through the audited IPC handler
 * `squidbot:runSquidbotCommand` — there is no raw shell anywhere.
 *
 * This lets users get the *feel* of a terminal (with familiar `npm run X`
 * commands) without leaving the app, while staying inside the policy boundary
 * the trust report itself describes.
 */
export function TerminalRunner({ allowedCommands, defaultCommandId, title }: TerminalRunnerProps) {
  const [available, setAvailable] = useState<SquidbotCommandDescriptorDto[]>([]);
  const [selected, setSelected] = useState<SquidbotCommandId | null>(defaultCommandId ?? null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CommandRunResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    squidbotApi
      .listSquidbotCommands()
      .then((all) => {
        if (cancelled) return;
        const filtered = allowedCommands
          ? all.filter((descriptor) => allowedCommands.includes(descriptor.id))
          : all;
        setAvailable(filtered);
        if (!selected && filtered.length > 0) {
          setSelected(filtered[0].id);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedCommands?.join(",")]);

  async function handleRun(): Promise<void> {
    if (!selected || running) return;
    setRunning(true);
    setError(null);
    try {
      const outcome = await squidbotApi.runSquidbotCommand(selected);
      setResult(outcome);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  const activeDescriptor = available.find((descriptor) => descriptor.id === selected) ?? null;

  return (
    <div className="terminal-runner">
      <div className="terminal-runner__header">
        <Terminal size={16} aria-hidden />
        <span>{title ?? "Run inside SquidBot"}</span>
      </div>
      <div className="terminal-runner__controls">
        <select
          className="terminal-runner__select"
          value={selected ?? ""}
          onChange={(event) => setSelected(event.target.value as SquidbotCommandId)}
          aria-label="Select a SquidBot command"
        >
          {available.length === 0 && <option value="">Loading…</option>}
          {available.map((descriptor) => (
            <option key={descriptor.id} value={descriptor.id}>
              {descriptor.label}
            </option>
          ))}
        </select>
        <button
          className="terminal-runner__run"
          onClick={handleRun}
          disabled={!selected || running}
          type="button"
          aria-label="Run the selected command"
        >
          {running ? <RefreshCw size={14} className="spin" aria-hidden /> : <Play size={14} aria-hidden />}
          <span>{running ? "Running…" : "Run"}</span>
        </button>
      </div>

      {activeDescriptor && (
        <div className="terminal-runner__hint">
          <code>{activeDescriptor.displayCommand}</code>
          <p>{activeDescriptor.description}</p>
        </div>
      )}

      {error && <div className="terminal-runner__error">{error}</div>}

      {result && (
        <pre
          className={`terminal-runner__output ${result.ok ? "" : "is-failed"}`}
          aria-label="Command output"
        >
          {result.output || "(no output)"}
        </pre>
      )}
    </div>
  );
}
