import { spawn } from "node:child_process";
import type { ChatMessage, ModelProvider, ModelProviderRequest, ModelResponse } from "./base.js";
import { estimateRequestTokens, usageFromText } from "./util.js";

export type CodexModelProviderOptions = {
  modelName?: string | null;
  workspacePath?: string | null;
};

type CodexJsonEvent =
  | { type: "item.completed"; item?: { type?: string; text?: string } }
  | { type: "turn.completed"; usage?: { input_tokens?: number; output_tokens?: number; cached_input_tokens?: number } }
  | { type: string; [key: string]: unknown };

export class CodexModelProvider implements ModelProvider {
  readonly name = "codex";
  readonly modelName: string;
  readonly mode = "byok";
  readonly maxTokens = 128_000;
  readonly supportsTools = false;
  readonly costOwner = "user-paid";
  readonly costPerToken = 0;
  private readonly workspacePath?: string | null;

  constructor(options: CodexModelProviderOptions = {}) {
    this.modelName = options.modelName ?? "gpt-5.4";
    this.workspacePath = options.workspacePath;
  }

  estimateTokens = estimateRequestTokens;

  async isAvailable(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const child = spawn("codex", ["login", "status"], { stdio: ["ignore", "ignore", "ignore"] });
      child.on("error", () => resolve(false));
      child.on("exit", (code) => resolve(code === 0));
    });
  }

  async generate(request: ModelProviderRequest): Promise<ModelResponse> {
    const prompt = buildCodexPrompt(request.messages);
    const args = [
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "-C",
      this.workspacePath ?? process.cwd(),
      "-m",
      this.modelName,
      prompt
    ];

    const stdout = await runCodex(args);
    const events = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => safeParseCodexEvent(line))
      .filter((event): event is CodexJsonEvent => Boolean(event));

    const agentMessages = events.filter(isCodexAgentMessageEvent);
    const content =
      agentMessages
        .map((event) => event.item?.text ?? "")
        .filter(Boolean)
        .join("\n")
        .trim() || "Codex returned no assistant text.";

    const turnCompleted = [...events].reverse().find(isCodexTurnCompletedEvent);
    const promptTokens = turnCompleted?.usage?.input_tokens ?? estimateRequestTokens(request.messages, request.tools);
    const completionTokens =
      turnCompleted?.usage?.output_tokens ?? usageFromText(promptTokens, content).completionTokens;

    return {
      provider: this.name,
      modelName: this.modelName,
      mode: this.mode,
      costOwner: this.costOwner,
      content,
      toolCalls: [],
      tokenUsage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens
      }
    };
  }
}

function buildCodexPrompt(messages: ChatMessage[]): string {
  return [
    "You are answering inside SquidBot via a Codex-backed provider.",
    "Reply directly to the latest user request using the repository context when useful.",
    "Do not mention internal provider plumbing unless the user asked.",
    "",
    ...messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
  ].join("\n\n");
}

function safeParseCodexEvent(line: string): CodexJsonEvent | null {
  try {
    return JSON.parse(line) as CodexJsonEvent;
  } catch {
    return null;
  }
}

function isCodexAgentMessageEvent(event: CodexJsonEvent): event is Extract<CodexJsonEvent, { type: "item.completed" }> {
  return (
    event.type === "item.completed"
    && typeof (event as { item?: { type?: string } }).item?.type === "string"
    && (event as { item?: { type?: string } }).item?.type === "agent_message"
  );
}

function isCodexTurnCompletedEvent(event: CodexJsonEvent): event is Extract<CodexJsonEvent, { type: "turn.completed" }> {
  return event.type === "turn.completed";
}

function runCodex(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `codex exec failed with exit code ${code ?? "unknown"}`));
    });
  });
}
