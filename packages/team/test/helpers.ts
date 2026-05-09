import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";

export const tempRoots: string[] = [];

export function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

export function cleanupTempRoots(): void {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export function tempDb(): SquidDatabase {
  const root = tempRoot("squidbot-team-db-");
  return initializeDatabase(path.join(root, "squidbot.sqlite"));
}

export function buggyPythonWorkspace(): string {
  const workspace = tempRoot("squidbot-team-workspace-");
  fs.writeFileSync(path.join(workspace, "calculator.py"), "def add(a, b):\n    return a - b\n\n\ndef subtract(a, b):\n    return a - b\n", "utf8");
  fs.writeFileSync(
    path.join(workspace, "test_calculator.py"),
    "from calculator import add, subtract\n\n\ndef test_add():\n    assert add(2, 3) == 5\n\n\ndef test_subtract():\n    assert subtract(5, 3) == 2\n",
    "utf8"
  );
  return workspace;
}
