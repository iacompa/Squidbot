import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function runRootNpm(args: string[], home: string): string {
  return execFileSync(npmCommand, args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOME: home,
      INIT_CWD: projectRoot
    },
    encoding: "utf8"
  });
}

function copyWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-cli-traces-workspace-"));
  fs.cpSync(path.join(projectRoot, "examples/buggy-python"), root, { recursive: true });
  return root;
}

describe("CLI traces", () => {
  it("lists, shows, searches, exports, and redacts traces", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-cli-traces-home-"));
    const workspace = copyWorkspace();
    const secret = "API_KEY=sk-abcdef1234567890 user@example.com";

    runRootNpm(["run", "--silent", "chat", "--", "--workspace", workspace, `list files ${secret}`], home);

    const listed = JSON.parse(runRootNpm(["run", "--silent", "traces", "--", "list"], home)) as {
      runs: Array<{ runId: string; task: string; provider: string }>;
    };
    expect(listed.runs.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(listed)).toContain("[REDACTED]");
    expect(JSON.stringify(listed)).not.toContain("sk-abcdef1234567890");
    expect(JSON.stringify(listed)).not.toContain("user@example.com");

    const runId = listed.runs[0].runId;
    const shown = JSON.parse(runRootNpm(["run", "--silent", "traces", "--", "show", runId], home)) as {
      trace: { runId: string; steps: Array<{ type: string; detail: unknown }> };
      metrics: { totalTokens: number };
    };
    expect(shown.trace.runId).toBe(runId);
    expect(shown.trace.steps.map((step) => step.type)).toContain("model.call");
    expect(JSON.stringify(shown)).toContain("[REDACTED]");
    expect(JSON.stringify(shown)).not.toContain("sk-abcdef1234567890");

    const search = JSON.parse(
      runRootNpm(["run", "--silent", "traces", "--", "search", "--type", "model.call", "--provider", "mock", "--text", "list"], home)
    ) as { results: unknown[] };
    expect(search.results.length).toBeGreaterThanOrEqual(1);

    const outPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-cli-trace-export-")), "trace.md");
    const exported = JSON.parse(
      runRootNpm(["run", "--silent", "traces", "--", "export", runId, "--format", "md", "--out", outPath], home)
    ) as { path: string; format: string };
    expect(exported.format).toBe("md");
    expect(fs.readFileSync(exported.path, "utf8")).toContain(`# Trace ${runId}`);
    expect(fs.readFileSync(exported.path, "utf8")).not.toContain("sk-abcdef1234567890");
  });
});
