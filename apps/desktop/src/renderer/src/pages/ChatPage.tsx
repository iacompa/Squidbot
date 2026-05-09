import { FormEvent, useMemo, useState } from "react";
import { FolderOpen, Send, Wrench } from "lucide-react";
import { squidbotApi } from "../lib/api";
import type { UiMessage } from "../types";
import type { ChatResponse, SettingsDto, TraceDto } from "../../../shared/api";

type ChatPageProps = {
  settings: SettingsDto;
  sessionId?: string;
  onSessionChange: (sessionId: string) => void;
  onTraceChange: (trace: TraceDto) => void;
  onSettingsChange: (settings: SettingsDto) => void;
};

function createMessageId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatToolOutput(result: ChatResponse["toolResults"][number]): string {
  if (!result.ok) {
    return "blocked or failed";
  }

  if (result.toolName === "workspace.listFiles") {
    const output = result.output as { files?: string[] };
    return `${output.files?.length ?? 0} files`;
  }

  if (result.toolName === "workspace.readFile") {
    const output = result.output as { path?: string };
    return output.path ?? "file read";
  }

  if (result.toolName === "workspace.proposePatch") {
    return "draft patch";
  }

  if (result.toolName === "terminal.dryRun") {
    return "not executed";
  }

  return "ok";
}

export function ChatPage({
  settings,
  sessionId,
  onSessionChange,
  onTraceChange,
  onSettingsChange
}: ChatPageProps) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("list files");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const workspaceLabel = useMemo(() => {
    if (!settings.workspacePath) {
      return "No workspace selected";
    }

    return settings.workspacePath;
  }, [settings.workspacePath]);

  async function chooseWorkspace(): Promise<void> {
    const selected = await squidbotApi.chooseWorkspace();
    if (selected) {
      const nextSettings = await squidbotApi.getSettings();
      onSettingsChange(nextSettings);
    }
  }

  async function sendMessage(event: FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isSending) {
      return;
    }

    setError(null);
    setIsSending(true);
    setInput("");
    setMessages((current) => [...current, { id: createMessageId(), role: "user", content: trimmed }]);

    try {
      const response = await squidbotApi.sendChatMessage({
        message: trimmed,
        workspacePath: settings.workspacePath,
        sessionId
      });

      onSessionChange(response.sessionId);
      onTraceChange(response.trace);
      setMessages((current) => [
        ...current,
        {
          id: createMessageId(),
          role: "assistant",
          content: response.content,
          toolCalls: response.toolCalls,
          toolResults: response.toolResults
        }
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to send message.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="page-panel chat-page">
      <header className="page-header">
        <div>
          <p className="section-label">Chat</p>
          <h2>Mock agent session</h2>
        </div>
        <button className="secondary-button" type="button" onClick={chooseWorkspace}>
          <FolderOpen size={17} />
          <span>Workspace</span>
        </button>
      </header>

      <div className="workspace-strip">
        <span>Workspace</span>
        <strong>{workspaceLabel}</strong>
      </div>

      <section className="message-log" aria-live="polite">
        {messages.length === 0 ? (
          <div className="empty-state compact">
            <h3>Ready for a local run</h3>
            <p>Try “list files” against the fixture workspace or any folder you choose.</p>
          </div>
        ) : (
          messages.map((message) => (
            <article className={`message-row ${message.role}`} key={message.id}>
              <div className="message-bubble">
                <pre>{message.content}</pre>
                {message.toolCalls && message.toolCalls.length > 0 ? (
                  <div className="tool-call-list">
                    {message.toolCalls.map((call) => {
                      const result = message.toolResults?.find((item) => item.callId === call.id);
                      return (
                        <span className="tool-chip" key={call.id}>
                          <Wrench size={14} />
                          {call.name}
                          {result ? <em>{formatToolOutput(result)}</em> : null}
                        </span>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </article>
          ))
        )}
      </section>

      {error ? <div className="error-strip">{error}</div> : null}

      <form className="chat-form" onSubmit={sendMessage}>
        <input
          aria-label="Message"
          disabled={isSending}
          onChange={(event) => setInput(event.target.value)}
          placeholder={settings.workspacePath ? "Ask the mock agent..." : "Choose a workspace first"}
          value={input}
        />
        <button className="primary-icon-button" disabled={isSending || !input.trim()} title="Send" type="submit">
          <Send size={19} />
        </button>
      </form>
    </main>
  );
}
