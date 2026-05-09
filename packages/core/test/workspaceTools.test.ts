import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ToolRegistry, registerWorkspaceTools } from "../src/index.js";

function createWorkspace(): string {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-tools-"));
  fs.writeFileSync(path.join(workspacePath, "calculator.py"), "def add(a, b):\n    return a - b\n", "utf8");
  fs.writeFileSync(path.join(workspacePath, "README.md"), "# Calculator\n", "utf8");
  return workspacePath;
}

describe("workspace tools", () => {
  it("searches file paths and file contents", async () => {
    const workspacePath = createWorkspace();
    const registry = new ToolRegistry();
    registerWorkspaceTools(registry);

    const result = (await registry.execute(
      "workspace.searchFiles",
      { pattern: "def add", regex: false },
      { workspacePath }
    )) as { paths: string[] };

    expect(result.paths).toEqual(["calculator.py"]);
  });

  it("creates draft patches without modifying files", async () => {
    const workspacePath = createWorkspace();
    const registry = new ToolRegistry();
    registerWorkspaceTools(registry);
    const original = fs.readFileSync(path.join(workspacePath, "calculator.py"), "utf8");

    const result = (await registry.execute(
      "workspace.createPatch",
      {
        patch: "--- a/calculator.py\n+++ b/calculator.py\n@@\n-    return a - b\n+    return a + b\n"
      },
      { workspacePath }
    )) as { draftOnly: boolean; applied: boolean; patch: string };

    expect(result.draftOnly).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.patch).toContain("return a + b");
    expect(fs.readFileSync(path.join(workspacePath, "calculator.py"), "utf8")).toBe(original);
  });
});
