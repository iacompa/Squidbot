export class McpCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpCommandError";
  }
}

const ALLOWED_COMMANDS = new Set([
  "npx",
  "uvx",
  "node",
  "python",
  "python3",
  "deno",
  "bun"
]);

// Reject anything that could end up interpreted by a shell. We're using
// child_process.spawn (no shell), but defense-in-depth matters if a
// downstream consumer ever passes shell: true. Also rejects newlines
// that could trick a logger into injecting fake log lines.
const SHELL_METACHAR = /[;&|`$<>(){}\\\n\r"']/;

export function validateMcpCommand(command: string, args: readonly string[]): void {
  if (typeof command !== "string" || command.length === 0) {
    throw new McpCommandError("MCP command must be a non-empty string");
  }
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new McpCommandError(
      `MCP command not allowlisted: ${command}. Allowed: ${Array.from(ALLOWED_COMMANDS).join(", ")}`
    );
  }
  for (const a of args) {
    if (typeof a !== "string") {
      throw new McpCommandError("MCP args must all be strings");
    }
    if (SHELL_METACHAR.test(a)) {
      throw new McpCommandError(`MCP arg contains shell metacharacters: ${a}`);
    }
  }
}

/**
 * Redact env values for the renderer DTO. The raw env is still passed to
 * spawn() server-side; only the values returned to the UI are masked,
 * since they often contain API keys (GITHUB_TOKEN, OPENAI_API_KEY, etc.).
 */
export function redactMcpEnv(env: Record<string, string> | undefined | null): Record<string, string> {
  if (!env) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    out[k] = v ? "***" : "";
  }
  return out;
}
