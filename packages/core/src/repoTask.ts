import fs from "node:fs";
import path from "node:path";
import type { WorkspaceSummary } from "./types.js";

const keyFileNames = [
  "README.md",
  "package.json",
  "pnpm-workspace.yaml",
  "pyproject.toml",
  "requirements.txt",
  "calculator.py",
  "test_calculator.py"
];

const ignoredDirectories = new Set([".git", "node_modules", "dist", "build", ".next", "coverage"]);

function readFirstLines(filePath: string, lineCount: number): string[] {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > 128_000) {
    return [];
  }

  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).slice(0, lineCount);
}

export function summarizeWorkspace(workspacePath: string): WorkspaceSummary {
  const root = fs.realpathSync(workspacePath);
  const entries = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => !ignoredDirectories.has(entry.name))
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
    .sort();

  const keyFiles = keyFileNames
    .filter((fileName) => fs.existsSync(path.join(root, fileName)))
    .map((fileName) => ({
      path: fileName,
      firstLines: readFirstLines(path.join(root, fileName), 8)
    }));

  if (keyFiles.length === 0) {
    const firstTopLevelFile = entries.find((entry) => !entry.endsWith("/"));
    if (firstTopLevelFile) {
      keyFiles.push({
        path: firstTopLevelFile,
        firstLines: readFirstLines(path.join(root, firstTopLevelFile), 8)
      });
    }
  }

  return {
    workspacePath: root,
    topLevelEntries: entries,
    keyFiles
  };
}
