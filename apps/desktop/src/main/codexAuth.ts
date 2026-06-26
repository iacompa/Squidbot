import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { CodexAuthStateDto, CodexDeviceAuthStartDto } from "../shared/api.js";

type JsonRpcMessage = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message?: string };
};

class CodexAppServerClient {
  private readonly process: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly pending = new Map<number, {
    resolve: (value: Record<string, unknown>) => void;
    reject: (reason?: unknown) => void;
  }>();
  private readonly notifications = new Map<string, Array<(params: Record<string, unknown>) => void>>();
  private buffer = "";

  constructor() {
    this.process = spawn("codex", ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.process.stdout.setEncoding("utf8");
    this.process.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.process.stderr.on("data", () => {
      // stderr is noisy during startup; request-specific errors come back
      // through JSON-RPC error objects.
    });
    this.process.on("exit", () => {
      for (const { reject } of this.pending.values()) {
        reject(new Error("Codex app-server exited unexpectedly."));
      }
      this.pending.clear();
    });
  }

  async initialize(): Promise<void> {
    await this.call("initialize", {
      clientInfo: {
        name: "squidbot_desktop",
        title: "SquidBot Desktop",
        version: "0.1.0"
      }
    });
    this.notify("initialized", {});
  }

  async call(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const payload = JSON.stringify({ method, id, params });
    this.process.stdin.write(`${payload}\n`);
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.process.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  on(method: string, handler: (params: Record<string, unknown>) => void): void {
    const handlers = this.notifications.get(method) ?? [];
    handlers.push(handler);
    this.notifications.set(method, handlers);
  }

  close(): void {
    this.process.kill();
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) break;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line) as JsonRpcMessage;
      if (typeof message.id === "number") {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message ?? "Codex app-server error"));
        } else {
          pending.resolve(message.result ?? {});
        }
        continue;
      }
      if (message.method) {
        const handlers = this.notifications.get(message.method) ?? [];
        for (const handler of handlers) {
          handler((message.params ?? {}) as Record<string, unknown>);
        }
      }
    }
  }
}

const pendingDeviceAuthLogins = new Map<string, { client: CodexAppServerClient; startedAt: number }>();

export async function getCodexAuthState(): Promise<CodexAuthStateDto> {
  try {
    const client = new CodexAppServerClient();
    await client.initialize();
    const result = await client.call("account/read", { refreshToken: false });
    client.close();
    const account = (result.account ?? null) as Record<string, unknown> | null;
    return {
      available: true,
      loggedIn: Boolean(account),
      authMode:
        account?.type === "chatgpt"
          ? "chatgpt"
          : account?.type === "apiKey"
            ? "apikey"
            : account
              ? "unknown"
              : null,
      planType: typeof account?.planType === "string" ? account.planType : null,
      email: typeof account?.email === "string" ? account.email : null,
      requiresOpenaiAuth: Boolean(result.requiresOpenaiAuth)
    };
  } catch (error) {
    return {
      available: false,
      loggedIn: false,
      authMode: null,
      planType: null,
      email: null,
      requiresOpenaiAuth: true,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function startCodexDeviceAuth(): Promise<CodexDeviceAuthStartDto> {
  const client = new CodexAppServerClient();
  await client.initialize();
  const result = await client.call("account/login/start", { type: "chatgptDeviceCode" });
  const loginId =
    typeof result.loginId === "string" && result.loginId
      ? result.loginId
      : randomUUID();
  pendingDeviceAuthLogins.set(loginId, { client, startedAt: Date.now() });
  client.on("account/login/completed", (params) => {
    const completedId = typeof params.loginId === "string" ? params.loginId : loginId;
    const active = pendingDeviceAuthLogins.get(completedId);
    active?.client.close();
    pendingDeviceAuthLogins.delete(completedId);
  });
  return {
    loginId,
    verificationUrl: String(result.verificationUrl ?? ""),
    userCode: String(result.userCode ?? "")
  };
}
