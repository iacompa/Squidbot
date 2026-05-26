#!/usr/bin/env node
/**
 * Audits the renderer tree for imports that would only work in Electron
 * (electron, node:*). The web bundle (D.3 serve-web) needs the renderer
 * to be transport-agnostic — any electron / node:* import would fail at
 * runtime in a browser tab.
 *
 * Exits 0 if clean, 1 with file:line context if any forbidden import is found.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererRoot = path.join(__dirname, "..", "src", "renderer");

const FORBIDDEN = [
  { name: "electron", pattern: /from\s+["']electron["']/ },
  { name: "node:*", pattern: /from\s+["']node:[^"']+["']/ }
];

const issues = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      const content = fs.readFileSync(full, "utf8");
      const lines = content.split("\n");
      for (const { name, pattern } of FORBIDDEN) {
        lines.forEach((line, idx) => {
          if (pattern.test(line)) {
            issues.push({ file: full, line: idx + 1, name, text: line.trim() });
          }
        });
      }
    }
  }
}

walk(rendererRoot);

if (issues.length > 0) {
  console.error("Forbidden renderer imports found:");
  for (const issue of issues) {
    console.error(`  ${issue.file}:${issue.line}  (${issue.name})`);
    console.error(`    ${issue.text}`);
  }
  console.error(`\n${issues.length} issue${issues.length === 1 ? "" : "s"} — renderer must work in both Electron AND the web bundle.`);
  process.exit(1);
}

console.log("Renderer import audit: clean.");
