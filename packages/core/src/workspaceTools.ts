import fs from "node:fs";
import path from "node:path";
import type { JsonObject } from "./types.js";
import { type ToolContext, type ToolRegistry } from "./toolRegistry.js";

const ignoredDirectories = new Set([".git", "node_modules", "dist", "build", ".next", "coverage"]);
const textFileExtensions = new Set([
  ".c",
  ".css",
  ".go",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".py",
  ".rs",
  ".sh",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml"
]);

function ensureWorkspacePath(workspacePath: string, relativePath = "."): string {
  const root = fs.realpathSync(workspacePath);
  const target = fs.realpathSync(path.resolve(root, relativePath));

  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error("Path is outside the selected workspace.");
  }

  return target;
}

function listFilesRecursive(root: string, current: string, output: string[], limit: number): void {
  if (output.length >= limit) {
    return;
  }

  const entries = fs.readdirSync(current, { withFileTypes: true });
  for (const entry of entries) {
    if (output.length >= limit) {
      return;
    }

    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute);

    if (entry.isDirectory()) {
      listFilesRecursive(root, absolute, output, limit);
    } else {
      output.push(relative);
    }
  }
}

function isLikelyTextFile(filePath: string): boolean {
  return textFileExtensions.has(path.extname(filePath).toLowerCase());
}

function createMatcher(pattern: string, useRegex: boolean): (input: string) => boolean {
  if (useRegex) {
    const regex = new RegExp(pattern, "i");
    return (input) => regex.test(input);
  }

  const lowered = pattern.toLowerCase();
  return (input) => input.toLowerCase().includes(lowered);
}

function createDraftPatchResult(args: JsonObject): { draftOnly: boolean; applied: boolean; patch: string } {
  const patch = typeof args.patch === "string" ? args.patch : "";
  if (!patch.trim()) {
    throw new Error("Patch is required.");
  }

  return {
    draftOnly: true,
    applied: false,
    patch
  };
}

export function registerWorkspaceTools(registry: ToolRegistry): void {
  registry.register({
    name: "workspace.listFiles",
    description: "Return a bounded list of files in the selected workspace.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 200 }
      }
    },
    permissionScopes: ["filesystem.read"],
    riskLevel: "low",
    handler: (args: JsonObject, context: ToolContext) => {
      const root = ensureWorkspacePath(context.workspacePath);
      const limit =
        typeof args.limit === "number" && Number.isFinite(args.limit) && args.limit > 0
          ? Math.min(Math.floor(args.limit), 500)
          : 200;
      const files: string[] = [];
      listFilesRecursive(root, root, files, limit);
      return { workspacePath: root, files, truncated: files.length >= limit };
    }
  });

  registry.register({
    name: "workspace.readFile",
    description: "Read a UTF-8 file inside the selected workspace.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string" }
      }
    },
    permissionScopes: ["filesystem.read"],
    riskLevel: "low",
    handler: (args: JsonObject, context: ToolContext) => {
      const requestedPath = typeof args.path === "string" ? args.path : "";
      const filePath = ensureWorkspacePath(context.workspacePath, requestedPath);
      const stat = fs.statSync(filePath);

      if (!stat.isFile()) {
        throw new Error("Requested path is not a file.");
      }

      if (stat.size > 128_000) {
        throw new Error("File is too large for this phase.");
      }

      return {
        path: requestedPath,
        content: fs.readFileSync(filePath, "utf8")
      };
    }
  });

  registry.register({
    name: "workspace.searchFiles",
    description: "Search file paths and text file contents inside the selected workspace.",
    inputSchema: {
      type: "object",
      required: ["pattern"],
      properties: {
        pattern: { type: "string" },
        regex: { type: "boolean", default: false },
        maxResults: { type: "number", default: 100 }
      }
    },
    permissionScopes: ["filesystem.read"],
    riskLevel: "low",
    handler: (args: JsonObject, context: ToolContext) => {
      const pattern = typeof args.pattern === "string" ? args.pattern : "";
      if (!pattern.trim()) {
        throw new Error("Search pattern is required.");
      }

      const root = ensureWorkspacePath(context.workspacePath);
      const maxResults =
        typeof args.maxResults === "number" && Number.isFinite(args.maxResults) && args.maxResults > 0
          ? Math.min(Math.floor(args.maxResults), 250)
          : 100;
      const matcher = createMatcher(pattern, args.regex === true);
      const files: string[] = [];
      listFilesRecursive(root, root, files, 1000);

      const matches: Array<{ path: string; line?: number; preview?: string; matched: "path" | "content" }> = [];

      for (const relativePath of files) {
        if (matches.length >= maxResults) {
          break;
        }

        if (matcher(relativePath)) {
          matches.push({ path: relativePath, matched: "path" });
          continue;
        }

        const absolutePath = path.join(root, relativePath);
        if (!isLikelyTextFile(absolutePath)) {
          continue;
        }

        const stat = fs.statSync(absolutePath);
        if (stat.size > 128_000) {
          continue;
        }

        const lines = fs.readFileSync(absolutePath, "utf8").split(/\r?\n/);
        const lineIndex = lines.findIndex((line) => matcher(line));
        if (lineIndex >= 0) {
          matches.push({
            path: relativePath,
            line: lineIndex + 1,
            preview: lines[lineIndex].trim().slice(0, 160),
            matched: "content"
          });
        }
      }

      return {
        pattern,
        regex: args.regex === true,
        matches,
        paths: [...new Set(matches.map((match) => match.path))],
        truncated: matches.length >= maxResults
      };
    }
  });

  registry.register({
    name: "workspace.proposePatch",
    description: "Return a unified diff as a draft without applying it.",
    inputSchema: {
      type: "object",
      required: ["patch"],
      properties: {
        patch: { type: "string" }
      }
    },
    permissionScopes: ["filesystem.write:draft"],
    riskLevel: "medium",
    handler: createDraftPatchResult
  });

  registry.register({
    name: "workspace.createPatch",
    description: "Create a draft unified diff without applying it.",
    inputSchema: {
      type: "object",
      required: ["patch"],
      properties: {
        patch: { type: "string" }
      }
    },
    permissionScopes: ["filesystem.write:draft"],
    riskLevel: "medium",
    handler: createDraftPatchResult
  });
}
