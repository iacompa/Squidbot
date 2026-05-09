import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ToolRegistry, registerTestTools } from "../src/index.js";

function createNodeTestWorkspace(): string {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-test-tool-"));
  fs.writeFileSync(
    path.join(workspacePath, "sample.test.mjs"),
    `import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('writes only inside sandbox copy', () => {
  fs.writeFileSync('generated.txt', 'sandbox');
  assert.equal(2 + 2, 4);
});
`,
    "utf8"
  );
  return workspacePath;
}

describe("test.run tool", () => {
  it("runs allowlisted tests in a workspace copy and captures output", async () => {
    const workspacePath = createNodeTestWorkspace();
    const registry = new ToolRegistry();
    registerTestTools(registry);

    const result = (await registry.execute("test.run", { command: "node --test", timeoutMs: 10000 }, { workspacePath })) as {
      executed: boolean;
      dryRun: boolean;
      exitCode: number;
      stdout: string;
    };

    expect(result.executed).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(`${result.stdout}`).toContain("writes only inside sandbox copy");
    expect(fs.existsSync(path.join(workspacePath, "generated.txt"))).toBe(false);
  });

  it("converts non-test commands to dry runs", async () => {
    const workspacePath = createNodeTestWorkspace();
    const registry = new ToolRegistry();
    registerTestTools(registry);

    const result = (await registry.execute("test.run", { command: "rm -rf ." }, { workspacePath })) as {
      executed: boolean;
      dryRun: boolean;
      reason: string;
    };

    expect(result.executed).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.reason).toContain("allowlist");
    expect(fs.existsSync(path.join(workspacePath, "sample.test.mjs"))).toBe(true);
  });
});
