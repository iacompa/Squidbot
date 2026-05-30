// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsDto } from "../../../shared/api";

const baseSettings: SettingsDto = {
  appDataDir: "/tmp/example/.squidbot",
  databasePath: "/tmp/example/.squidbot/squidbot.sqlite",
  workspacePath: "/tmp/example",
  modelProvider: "api",
  byokEnabled: true,
  modelSettings: {
    provider: "api",
    apiKeyConfigured: true,
    apiUrl: "https://openrouter.ai/api/v1/chat/completions",
    apiModel: "google/gemini-2.0-flash-001",
    apiBudgetTokens: undefined,
    apiUsedTokens: 0,
    apiRemainingTokens: undefined,
    apiCost: 0,
    costOwner: "user-paid"
  },
  connectors: [],
  connectorSettings: {}
};

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "squidbot");
});

function mount(overrides: {
  activeAccount?: string | null;
  accounts?: unknown[];
  sendChatMessage?: (req: unknown) => Promise<unknown>;
  onChatToken?: (callback: (delta: string) => void) => () => void;
} = {}) {
  const accounts = overrides.accounts ?? [
    {
      id: "id_or_gemini",
      name: "OR Gemini",
      providerKind: "openrouter",
      apiUrl: "https://openrouter.ai/api/v1/chat/completions",
      apiModel: "google/gemini-2.0-flash-001",
      costPerToken: 0,
      dailyBudgetTokens: null,
      description: null,
      isActive: true,
      apiKeyConfigured: true,
      createdAt: "now",
      updatedAt: "now"
    }
  ];
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: {
      chooseWorkspace: vi.fn(),
      getSettings: vi.fn(async () => baseSettings),
      listModelAccounts: vi.fn(async () => ({
        activeAccountName: overrides.activeAccount === undefined ? "OR Gemini" : overrides.activeAccount,
        accounts
      })),
      sendChatMessage:
        overrides.sendChatMessage ??
        vi.fn(async () => ({
          sessionId: "sess_test",
          content: "Hi there! How can I help you today?",
          toolCalls: [],
          toolResults: [],
          trace: { runId: "r1", events: [], steps: [] }
        })),
      onChatToken: overrides.onChatToken ?? vi.fn(() => () => undefined)
    }
  });
}

describe("ChatPage — header reflects the active model account", () => {
  it("shows the active account name and provider/model when one is active", async () => {
    mount({ activeAccount: "OR Gemini" });
    const { ChatPage } = await import("./ChatPage");
    render(
      <ChatPage
        settings={baseSettings}
        sessionId={undefined}
        onSessionChange={vi.fn()}
        onTraceChange={vi.fn()}
        onSettingsChange={vi.fn()}
      />
    );
    await waitFor(() => {
      // Header title is the account name itself — clearer than "Mock agent
      // session" which used to be hardcoded regardless of who was answering.
      expect(screen.getByText("OR Gemini")).toBeTruthy();
    });
    // Subtitle shows the provider + model id so the user can verify which
    // exact model is on the hook for this conversation.
    expect(screen.getByText(/openrouter.*google\/gemini-2\.0-flash-001/i)).toBeTruthy();
  });

  it("falls back to 'Mock provider (offline)' when no account is active", async () => {
    mount({ activeAccount: null, accounts: [] });
    const { ChatPage } = await import("./ChatPage");
    render(
      <ChatPage
        settings={baseSettings}
        sessionId={undefined}
        onSessionChange={vi.fn()}
        onTraceChange={vi.fn()}
        onSettingsChange={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByText(/Mock provider \(offline\)/i)).toBeTruthy();
    });
    // And the subtitle nudges the user toward Settings, since that's the path
    // out of the offline state.
    expect(screen.getByText(/Add a model account in Settings/i)).toBeTruthy();
  });
});

describe("ChatPage — typing indicator during in-flight sends", () => {
  it("renders the three-dot 'thinking…' bubble while awaiting the response", async () => {
    // Hold the response open so we can observe the intermediate state. Without
    // this, the send resolves synchronously inside fireEvent and we'd never
    // see the indicator.
    let resolveSend: ((value: unknown) => void) | null = null;
    const sendChatMessage = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        })
    );
    mount({ sendChatMessage });
    const { ChatPage } = await import("./ChatPage");
    render(
      <ChatPage
        settings={baseSettings}
        sessionId={undefined}
        onSessionChange={vi.fn()}
        onTraceChange={vi.fn()}
        onSettingsChange={vi.fn()}
      />
    );

    // Wait for the active-account load to settle before sending — otherwise
    // the indicator's "OR Gemini is thinking…" label might race the resolve.
    await waitFor(() => screen.getByText("OR Gemini"));

    // Send a message.
    const input = screen.getByLabelText("Message") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.submit(input.closest("form")!);

    // The indicator should appear immediately, labelled with the active
    // account so the user knows who's working.
    await waitFor(() => {
      expect(screen.getByText("OR Gemini is thinking…")).toBeTruthy();
    });
    // ARIA label so screen readers announce the in-flight state.
    expect(screen.getByLabelText("SquidBot is thinking")).toBeTruthy();

    // Release the response and assert the indicator goes away after.
    resolveSend!({
      sessionId: "s",
      content: "Hi there!",
      toolCalls: [],
      toolResults: [],
      trace: { runId: "r1", events: [], steps: [] }
    });
    await waitFor(() => {
      expect(screen.queryByLabelText("SquidBot is thinking")).toBeNull();
    });
    // Final assistant message replaced the indicator.
    expect(screen.getByText("Hi there!")).toBeTruthy();
  });
});

describe("ChatPage — token streaming", () => {
  it("renders streamed tokens live in an assistant bubble before the final response lands", async () => {
    let emit: ((delta: string) => void) | null = null;
    const onChatToken = vi.fn((cb: (delta: string) => void) => {
      emit = cb;
      return () => undefined;
    });
    let resolveSend: ((value: unknown) => void) | null = null;
    const sendChatMessage = vi.fn(() => new Promise((resolve) => {
      resolveSend = resolve;
    }));
    mount({ sendChatMessage, onChatToken });
    const { ChatPage } = await import("./ChatPage");
    render(
      <ChatPage
        settings={baseSettings}
        sessionId={undefined}
        onSessionChange={vi.fn()}
        onTraceChange={vi.fn()}
        onSettingsChange={vi.fn()}
      />
    );
    await waitFor(() => screen.getByText("OR Gemini"));

    const input = screen.getByLabelText("Message") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.submit(input.closest("form")!);

    // The page subscribed to streamed tokens.
    await waitFor(() => expect(onChatToken).toHaveBeenCalled());

    // Feed deltas — they appear live in a responding bubble.
    act(() => {
      emit!("Hello ");
      emit!("world");
    });
    await waitFor(() => expect(screen.getByText("Hello world")).toBeTruthy());
    expect(screen.getByLabelText("SquidBot is responding")).toBeTruthy();

    // Final response lands; the streaming bubble is replaced by the message.
    resolveSend!({
      sessionId: "s",
      content: "Hello world",
      toolCalls: [],
      toolResults: [],
      trace: { runId: "r1", events: [], steps: [] }
    });
    await waitFor(() => expect(screen.queryByLabelText("SquidBot is responding")).toBeNull());
  });
});
