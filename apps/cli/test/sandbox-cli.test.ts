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

function copyBuggyWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-cli-sandbox-workspace-"));
  fs.cpSync(path.join(projectRoot, "examples/buggy-python"), root, { recursive: true });
  return root;
}

describe("CLI sandbox staging", () => {
  it("lists, inspects, approves, and rejects staged patch sandboxes", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-cli-sandbox-home-"));
    const workspace = copyBuggyWorkspace();

    runRootNpm(
      [
        "run",
        "--silent",
        "run",
        "--",
        "--workspace",
        workspace,
        "Fix calculator add function",
        "--test-command",
        "pytest"
      ],
      home
    );

    const listed = JSON.parse(runRootNpm(["run", "--silent", "sandbox", "--", "list"], home)) as {
      sandboxes: Array<{ id: string; workspacePath: string; status: string; diff: string; testResults: Array<{ exitCode: number }> }>;
    };
    const workspaceRealPath = fs.realpathSync(workspace);
    const staged = listed.sandboxes.find((sandbox) => sandbox.workspacePath === workspaceRealPath);

    expect(staged).toBeDefined();
    expect(staged).toMatchObject({ status: "active" });
    expect(staged!.diff).toContain("+    return a + b");
    expect(staged!.testResults.some((result) => result.exitCode === 0)).toBe(true);
    expect(fs.readFileSync(path.join(workspace, "calculator.py"), "utf8")).toContain("return a - b");

    const shown = JSON.parse(runRootNpm(["run", "--silent", "sandbox", "--", "status", staged!.id], home)) as {
      sandbox: { id: string; diff: string };
    };
    expect(shown.sandbox.id).toBe(staged!.id);
    expect(shown.sandbox.diff).toContain("+    return a + b");

    const approved = JSON.parse(runRootNpm(["run", "--silent", "sandbox", "--", "approve", staged!.id], home)) as {
      sandbox: { id: string; status: string; approvalId: string | null };
    };
    expect(approved.sandbox.status).toBe("promoted");
    expect(approved.sandbox.approvalId).toBeTruthy();
    expect(fs.readFileSync(path.join(workspace, "calculator.py"), "utf8")).toContain("return a + b");

    const rejectWorkspace = copyBuggyWorkspace();
    runRootNpm(
      [
        "run",
        "--silent",
        "run",
        "--",
        "--workspace",
        rejectWorkspace,
        "Fix calculator add function",
        "--test-command",
        "pytest"
      ],
      home
    );

    const rejectList = JSON.parse(runRootNpm(["run", "--silent", "sandbox", "--", "list"], home)) as {
      sandboxes: Array<{ id: string; workspacePath: string }>;
    };
    const toReject = rejectList.sandboxes.find((sandbox) => sandbox.workspacePath === fs.realpathSync(rejectWorkspace));
    expect(toReject).toBeDefined();

    const rejected = JSON.parse(runRootNpm(["run", "--silent", "sandbox", "--", "reject", toReject!.id], home)) as {
      sandbox: { status: string; destroyedAt: string | null };
    };
    expect(rejected.sandbox.status).toBe("rejected");
    expect(rejected.sandbox.destroyedAt).toBeTruthy();
    expect(fs.readFileSync(path.join(rejectWorkspace, "calculator.py"), "utf8")).toContain("return a - b");
  }, 30000);
});
