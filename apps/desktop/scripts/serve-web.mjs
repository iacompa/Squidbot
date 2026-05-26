#!/usr/bin/env node
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mountWebApiBridge } from "../src/server/webApiBridge.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8080);
const rendererDist = path.join(__dirname, "..", "out", "renderer");

const app = express();

// Phase 1 placeholder adapter: returns empty/no-op responses for each IPC.
// Phase 6 wires this to the real Electron main-process IPC handlers (running
// headless inside a Node context with the same SquidDatabase + AgentRuntime).
const placeholderAdapter = {
  invoke: async (method) => {
    // Common methods the renderer calls on mount — return empty shapes that
    // pass through the renderer's prop types without crashing.
    if (method === "listModelAccounts") return { accounts: [], activeAccountName: null };
    if (method === "getProviderPresets") return [];
    if (method === "listPendingApprovals") return [];
    if (method === "listJobs") return { items: [], total: 0 };
    if (method === "getSettings") return { connectors: [], connectorSettings: {}, dataPath: "/tmp" };
    if (method === "listTraces") return [];
    if (method === "getIdentityReport") return { profile: null, audit: [], permissions: [], tools: [] };
    if (method === "listConnectors") return [];
    if (method === "listReflections") return [];
    if (method === "listMemories") return [];
    if (method === "getOnboardingQuestions") return [];
    if (method === "listSquidbotCommands") return [];
    // Generic fallback — return null so the renderer's null guards engage
    // without surfacing an error toast.
    return null;
  }
};

mountWebApiBridge(app, placeholderAdapter);

// Static renderer files. dotfiles: 'allow' is required because the absolute
// path may traverse hidden directories (e.g. `.claude/worktrees/...` during
// development) — without it, `send` 404s any request whose full path contains
// a component starting with '.'.
app.use(express.static(rendererDist, { dotfiles: "allow" }));

// SPA fallback — any unmatched GET serves index.html so the renderer's
// client-side routing (activePage state) works.
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(rendererDist, "index.html"), { dotfiles: "allow" });
});

app.listen(port, () => {
  console.log(`SquidBot web bundle at http://localhost:${port}`);
  console.log(`  Renderer files: ${rendererDist}`);
  console.log(`  API routes:     POST /api/<method>`);
  console.log(`  Phase 1 adapter: placeholder responses only`);
  console.log(`  Stop:           Ctrl+C`);
});
