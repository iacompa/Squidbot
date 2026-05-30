import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SandboxManager,
  type SandboxBackend,
  type SandboxBackendRunOptions,
  type SandboxBackendRunResult
} from "../src/index.js";

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tmpWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-sb-backend-"));
  tempRoots.push(root);
  fs.writeFileSync(path.join(root, "hello.txt"), "hello", "utf8");
  return root;
}

describe("SandboxBackend interface contract (S1)", () => {
  it("SandboxManager accepts a custom backend and routes run() calls through it", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const customBackend: SandboxBackend = {
      name: "custom-test",
      async run(opts: SandboxBackendRunOptions): Promise<SandboxBackendRunResult> {
        calls.push({ command: opts.command, args: opts.args ?? [] });
        return { exitCode: 0, stdout: "custom-stdout", stderr: "" };
      }
    };

    const manager = new SandboxManager({ backend: customBackend });
    const sandbox = await manager.create(tmpWorkspace());
    const result = await manager.run(sandbox.id, "echo", ["hello"], { database: null as never });

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("echo");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("custom-stdout");
  });

  it("the default backend is the local spawner (backward-compatible)", async () => {
    const manager = new SandboxManager();
    // Just verify it creates without error — the full local-spawn tests are in sandbox.test.ts
    expect(manager.backendName).toBe("local");
  });

  it("a Docker-shaped backend satisfies the interface (compile-time proof via type assignment)", () => {
    // This test is a type-safety assertion: if DockerSandboxBackend compiles
    // and implements SandboxBackend, swapping backends requires no changes to
    // SandboxManager — only the constructor option changes.
    const dockerShaped: SandboxBackend = {
      name: "docker",
      async run(_opts: SandboxBackendRunOptions): Promise<SandboxBackendRunResult> {
        // Real implementation would: `docker run --rm --network none ...`
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    };
    expect(dockerShaped.name).toBe("docker");
  });
});
