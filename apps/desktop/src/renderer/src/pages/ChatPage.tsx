import { FormEvent, useEffect, useMemo, useState } from "react";
import { FolderOpen, Send, Wrench } from "lucide-react";
import { squidbotApi } from "../lib/api";
import type { UiMessage } from "../types";
import type { ChatResponse, ModelAccountSummaryDto, SettingsDto, TraceDto } from "../../../shared/api";

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
  // The active model account, refreshed every send so chat-driven switches
  // (the user asks SquidBot to "switch to my OpenAI account") immediately
  // surface in the header without needing a page reload.
  const [activeAccount, setActiveAccount] = useState<ModelAccountSummaryDto | null>(null);

  // Refresh helper — used on mount and after every chat send (the model can
  // change the active account via the model.useAccount tool, and we want the
  // header to reflect that without a refresh).
  async function refreshActiveAccount(): Promise<void> {
    try {
      const resp = await squidbotApi.listModelAccounts();
      const active = resp.accounts.find((a) => a.name === resp.activeAccountName) ?? null;
      setActiveAccount(active);
    } catch {
      // Non-fatal — the header just falls back to the mock-provider label.
    }
  }

  useEffect(() => {
    void refreshActiveAccount();
  }, []);

  const workspaceLabel = useMemo(() => {
    if (!settings.workspacePath) {
      return "No workspace selected";
    }

    return settings.workspacePath;
  }, [settings.workspacePath]);

  /**
   * Header copy reflects who's actually answering. We avoid the misleading
   * "Mock agent session" string this used to show — that was a stale default
   * from before BYOK existed. Now it tells the user the model + provider in
   * play, or "Mock provider" honestly when no account is active.
   */
  const headerTitle = useMemo(() => {
    if (activeAccount) {
      return `${activeAccount.name}`;
    }
    return "Mock provider (offline)";
  }, [activeAccount]);

  const headerSubtitle = useMemo(() => {
    if (activeAccount) {
      return `${activeAccount.providerKind} · ${activeAccount.apiModel}`;
    }
    return "Add a model account in Settings to chat with a real LLM.";
  }, [activeAccount]);

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
      // The model may have called `model.useAccount` mid-turn to switch
      // providers — refresh the active-account state so the header reflects
      // it before the user sends the next message.
      void refreshActiveAccount();
    }
  }

  return (
    <main className="page-panel chat-page">
      <header className="page-header">
        <div>
          <p className="section-label">Chat</p>
          <h2>{headerTitle}</h2>
          <p className="page-subtitle chat-page__subtitle">{headerSubtitle}</p>
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
        {/* Typing indicator — three pulsing dots in an assistant-style bubble.
            Renders while we're awaiting the model's response. Lives at the
            bottom of the message-log so it naturally appears where the next
            assistant message will land. */}
        {isSending && (
          <article className="message-row assistant" aria-live="polite" aria-label="SquidBot is thinking">
            <div className="message-bubble chat-typing-bubble">
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
              <span className="chat-typing-label">
                {activeAccount ? `${activeAccount.name} is thinking…` : "Thinking…"}
              </span>
            </div>
          </article>
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
