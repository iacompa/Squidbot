import { useState } from "react";
import { Check, Clipboard, Terminal } from "lucide-react";

export type TerminalSnippetProps = {
  command: string;
  label?: string;
  /** Optional explanation rendered above the command. */
  description?: string;
};

/**
 * Inline display of a terminal command with a single-click copy-to-clipboard
 * button. Used throughout the onboarding wizard, the Identity page, and the
 * "Try this next" suggestions so users can move work into a real shell when
 * they want to.
 *
 * This component never executes anything — it's read-only by design. For
 * actually *running* a command from inside the app, see TerminalRunner.
 */
export function TerminalSnippet({ command, label, description }: TerminalSnippetProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(command);
      } else {
        // Headless / older-environment fallback so we don't throw in tests.
        const textarea = document.createElement("textarea");
        textarea.value = command;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Silently swallow — copy failure is non-fatal; user can still select & copy.
    }
  }

  return (
    <div className="terminal-snippet">
      {(label || description) && (
        <div className="terminal-snippet__meta">
          {label && (
            <div className="terminal-snippet__label">
              <Terminal size={14} aria-hidden /> {label}
            </div>
          )}
          {description && <div className="terminal-snippet__description">{description}</div>}
        </div>
      )}
      <div className="terminal-snippet__row" role="group" aria-label={label ?? "Terminal command"}>
        <code className="terminal-snippet__command">{command}</code>
        <button
          className={`terminal-snippet__copy ${copied ? "is-copied" : ""}`}
          onClick={handleCopy}
          type="button"
          aria-label={copied ? "Copied" : "Copy command to clipboard"}
        >
          {copied ? <Check size={14} aria-hidden /> : <Clipboard size={14} aria-hidden />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
    </div>
  );
}
