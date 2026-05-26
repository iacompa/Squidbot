import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classifyNetworkPolicyBlock, inlineCodeLooksLikeNetwork, SandboxManager } from "../src/index.js";

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

function createFixtureWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-sandbox-fixture-"));
  tempRoots.push(root);
  fs.writeFileSync(path.join(root, "calculator.py"), "def add(a, b):\n    return a - b\n\n");
  fs.writeFileSync(
    path.join(root, "test_calculator.py"),
    "from calculator import add\n\n\ndef test_add():\n    assert add(2, 3) == 5\n"
  );
  return root;
}

describe("SandboxManager", () => {
  it("stages a patch, runs tests, produces a diff, and promotes once approved", async () => {
    const workspace = createFixtureWorkspace();
    const manager = new SandboxManager();
    const sandbox = await manager.create(workspace);
    tempRoots.push(path.dirname(sandbox.path));

    await manager.applyPatch(
      sandbox,
      "--- a/calculator.py\n+++ b/calculator.py\n@@\n def add(a, b):\n-    return a - b\n+    return a + b\n"
    );
    const testResult = await manager.runCommand(sandbox, "pytest", [], { timeoutMs: 20_000 });
    const diff = await manager.diff(sandbox);

    expect(testResult.exitCode).toBe(0);
    expect(diff).toContain("+    return a + b");
    expect(fs.readFileSync(path.join(workspace, "calculator.py"), "utf8")).toContain("return a - b");

    await manager.promote(sandbox, "approval_test");
    expect(fs.readFileSync(path.join(workspace, "calculator.py"), "utf8")).toContain("return a + b");
  });

  it("keeps concurrent sandboxes isolated and reject leaves the workspace unchanged", async () => {
    const workspace = createFixtureWorkspace();
    const manager = new SandboxManager();
    const first = await manager.create(workspace);
    const second = await manager.create(workspace);
    tempRoots.push(path.dirname(first.path), path.dirname(second.path));

    await manager.applyPatch(
      first,
      "--- a/calculator.py\n+++ b/calculator.py\n@@\n def add(a, b):\n-    return a - b\n+    return a + b\n"
    );
    await manager.applyPatch(
      second,
      "--- a/calculator.py\n+++ b/calculator.py\n@@\n def add(a, b):\n-    return a - b\n+    return 99\n"
    );

    expect(await manager.diff(first)).toContain("return a + b");
    expect(await manager.diff(second)).toContain("return 99");

    await manager.destroy(second);
    expect(fs.readFileSync(path.join(workspace, "calculator.py"), "utf8")).toContain("return a - b");

    await manager.promote(first, "approval_test");
    expect(fs.readFileSync(path.join(workspace, "calculator.py"), "utf8")).toContain("return a + b");
  });

  it("blocks obvious filesystem escapes and network commands under deny policy", async () => {
    const workspace = createFixtureWorkspace();
    const manager = new SandboxManager();
    const sandbox = await manager.create(workspace, { networkPolicy: "deny" });
    tempRoots.push(path.dirname(sandbox.path));

    const outsideRead = await manager.runCommand(sandbox, "cat", ["/etc/passwd"]);
    const outsideWrite = await manager.runCommand(sandbox, "touch", [path.join(os.tmpdir(), "squidbot-forbidden-write")]);
    const network = await manager.runCommand(sandbox, "curl", ["https://example.com"], { timeoutMs: 1000 });

    expect(outsideRead.exitCode).toBe(126);
    expect(outsideRead.blockedByPolicy).toBe(true);
    expect(outsideWrite.exitCode).toBe(126);
    expect(outsideWrite.blockedByPolicy).toBe(true);
    expect(network.exitCode).toBe(126);
    expect(network.blockedByPolicy).toBe(true);
  });

  it("creates a local sandbox quickly enough for interactive staging", async () => {
    const workspace = createFixtureWorkspace();
    const manager = new SandboxManager();
    const startedAt = Date.now();
    const sandbox = await manager.create(workspace);
    tempRoots.push(path.dirname(sandbox.path));

    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it("blocks git network subcommands under deny policy", async () => {
    const workspace = createFixtureWorkspace();
    const manager = new SandboxManager();
    const sandbox = await manager.create(workspace, { networkPolicy: "deny" });
    tempRoots.push(path.dirname(sandbox.path));

    const result = await manager.runCommand(sandbox, "git", ["clone", "https://example.com/repo.git"], { timeoutMs: 1000 });
    expect(result.exitCode).toBe(126);
    expect(result.blockedByPolicy).toBe(true);
    expect(result.stderr).toMatch(/network|policy|deny/i);
  });

  it("blocks npm install under deny policy", async () => {
    const workspace = createFixtureWorkspace();
    const manager = new SandboxManager();
    const sandbox = await manager.create(workspace, { networkPolicy: "deny" });
    tempRoots.push(path.dirname(sandbox.path));

    const result = await manager.runCommand(sandbox, "npm", ["install", "left-pad"], { timeoutMs: 1000 });
    expect(result.exitCode).toBe(126);
    expect(result.blockedByPolicy).toBe(true);
  });

  it("blocks python -c inline code under deny policy", async () => {
    const workspace = createFixtureWorkspace();
    const manager = new SandboxManager();
    const sandbox = await manager.create(workspace, { networkPolicy: "deny" });
    tempRoots.push(path.dirname(sandbox.path));

    const result = await manager.runCommand(sandbox, "python3", ["-c", "import urllib.request; urllib.request.urlopen('https://example.com')"], { timeoutMs: 1000 });
    expect(result.exitCode).toBe(126);
    expect(result.blockedByPolicy).toBe(true);
  });

  it("blocks node -e inline code under deny policy", async () => {
    const workspace = createFixtureWorkspace();
    const manager = new SandboxManager();
    const sandbox = await manager.create(workspace, { networkPolicy: "deny" });
    tempRoots.push(path.dirname(sandbox.path));

    const result = await manager.runCommand(sandbox, "node", ["-e", "fetch('https://example.com')"], { timeoutMs: 1000 });
    expect(result.exitCode).toBe(126);
    expect(result.blockedByPolicy).toBe(true);
  });

  it("permits offline git subcommands under deny policy", () => {
    // These should NOT be classified as network ops:
    expect(classifyNetworkPolicyBlock("git", ["status"]).blocked).toBe(false);
    expect(classifyNetworkPolicyBlock("git", ["log", "--oneline"]).blocked).toBe(false);
    expect(classifyNetworkPolicyBlock("git", ["diff"]).blocked).toBe(false);
    expect(classifyNetworkPolicyBlock("npm", ["test"]).blocked).toBe(false);
    expect(classifyNetworkPolicyBlock("npm", ["run", "build"]).blocked).toBe(false);
    expect(classifyNetworkPolicyBlock("python3", ["script.py"]).blocked).toBe(false);
    expect(classifyNetworkPolicyBlock("pytest", ["-q"]).blocked).toBe(false);
    // Inline code WITHOUT network indicators must pass:
    expect(
      classifyNetworkPolicyBlock("python3", ["-c", "from calculator import add; assert add(2,3)==5"]).blocked
    ).toBe(false);
    expect(classifyNetworkPolicyBlock("node", ["-e", "console.log(1+1)"]).blocked).toBe(false);
  });

  it("detects network indicators in inline code", () => {
    expect(inlineCodeLooksLikeNetwork("import urllib.request")).toBe(true);
    expect(inlineCodeLooksLikeNetwork("import requests; requests.get('...')")).toBe(true);
    expect(inlineCodeLooksLikeNetwork("require('http').get(...)")).toBe(true);
    expect(inlineCodeLooksLikeNetwork("fetch('https://...')")).toBe(true);
    expect(inlineCodeLooksLikeNetwork("__import__('urllib.request')")).toBe(true);
    expect(inlineCodeLooksLikeNetwork("Net::HTTP.get(...)")).toBe(true);
    // Should NOT trip on benign code:
    expect(inlineCodeLooksLikeNetwork("from calculator import add")).toBe(false);
    expect(inlineCodeLooksLikeNetwork("console.log('hello')")).toBe(false);
    expect(inlineCodeLooksLikeNetwork("print(1+1)")).toBe(false);
  });

  it("classifies pnpm/yarn/bun network ops", () => {
    expect(classifyNetworkPolicyBlock("pnpm", ["install"]).blocked).toBe(true);
    expect(classifyNetworkPolicyBlock("yarn", ["add", "react"]).blocked).toBe(true);
    expect(classifyNetworkPolicyBlock("bun", ["install"]).blocked).toBe(true);
    expect(classifyNetworkPolicyBlock("pip", ["install", "requests"]).blocked).toBe(true);
    expect(classifyNetworkPolicyBlock("cargo", ["fetch"]).blocked).toBe(true);
    expect(classifyNetworkPolicyBlock("ssh", ["host"]).blocked).toBe(true);
    expect(classifyNetworkPolicyBlock("rsync", ["-av", "host:/path", "."]).blocked).toBe(true);
  });

  it("refuses to copy a workspace that contains a symlink (no symlink survives in sandbox)", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-sandbox-symlink-"));
    tempRoots.push(workspace);
    fs.writeFileSync(path.join(workspace, "calculator.py"), "def add(a, b):\n    return a + b\n");
    // Create a symlink to /etc inside the workspace
    const symlinkTarget = "/etc";
    const symlinkInside = path.join(workspace, "danger");
    try {
      fs.symlinkSync(symlinkTarget, symlinkInside, "dir");
    } catch {
      // Symlink creation may fail on some CI hosts (e.g., Windows without dev mode); skip if so.
      return;
    }

    const manager = new SandboxManager();
    const sandbox = await manager.create(workspace);
    tempRoots.push(path.dirname(sandbox.path));

    // The symlink must NOT exist in the sandbox copy.
    const copiedSymlink = path.join(sandbox.path, "danger");
    expect(fs.existsSync(copiedSymlink)).toBe(false);

    // And the safe file IS copied
    expect(fs.existsSync(path.join(sandbox.path, "calculator.py"))).toBe(true);
  });
});
