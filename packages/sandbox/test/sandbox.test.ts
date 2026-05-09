import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SandboxManager } from "../src/index.js";

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
});
