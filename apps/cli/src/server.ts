import { timingSafeEqual } from "node:crypto";
import express from "express";
import type { SquidDatabase } from "@squidbot/db";
import { collectMetrics, exportPrometheusMetrics } from "@squidbot/core";
import { getCliVersion } from "./cliHelpers.js";

/** Constant-time Bearer-token comparison (avoids a timing side channel). */
function tokenMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Inline minimal web-bridge (avoids cross-app import boundary). Identical
// behaviour to apps/desktop/src/server/webApiBridge.ts.
const UNSAFE_METHODS = new Set(["__proto__", "prototype", "constructor", "hasOwnProperty",
  "isPrototypeOf", "propertyIsEnumerable", "toString", "toLocaleString", "valueOf"]);
function isSafeBridgeMethod(m: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(m) && !UNSAFE_METHODS.has(m);
}
type BridgeAdapter = { invoke: (method: string, ...args: unknown[]) => Promise<unknown> };
function mountBridge(app: ReturnType<typeof express>, adapter: BridgeAdapter): void {
  app.post("/api/:method", async (req, res) => {
    const { method } = req.params;
    if (!isSafeBridgeMethod(method)) { res.status(400).json({ error: `Invalid method: ${method}` }); return; }
    const args = Array.isArray((req.body as { args?: unknown[] }).args) ? (req.body as { args: unknown[] }).args : [];
    try { res.json((await adapter.invoke(method, ...args)) ?? null); }
    catch (err) { res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
  });
}

export type SquidbotServerOptions = {
  workspace: string;
  apiToken?: string;
  port?: number;
};

export type DockerfileResult = {
  dockerfile: string;
  dockerignore: string;
};

/**
 * Create a standalone Express application that exposes SquidBot over HTTP.
 * Use `createSquidbotServer(db, opts).listen(port)` to start a headless
 * daemon — this is the deployment surface for Docker / PM2 / systemd.
 *
 * Security: pass `apiToken` in options to require Bearer auth on every
 * request (including /health) — suitable for non-localhost deployments.
 */
export function createSquidbotServer(
  database: SquidDatabase,
  options: SquidbotServerOptions
): ReturnType<typeof express> {
  const app = express();
  app.use(express.json({ limit: "5mb" }));

  // Bearer-token guard (same as the desktop web bridge). Captured in a const so
  // it narrows to `string` inside the request closure.
  const requiredToken = options.apiToken;
  if (requiredToken) {
    app.use((req, res, next) => {
      const auth = req.headers.authorization ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
      if (!tokenMatches(token, requiredToken)) {
        res.status(401).json({ error: "Unauthorized: valid Bearer token required." });
        return;
      }
      next();
    });
  }

  // Health check — scraped by container orchestration.
  app.get("/health", (_req, res) => {
    res.json({ ok: true, version: getCliVersion(), workspace: options.workspace });
  });

  // Prometheus metrics — can be scraped by a sidecar.
  app.get("/metrics", (_req, res) => {
    res.type("text/plain; version=0.0.4; charset=utf-8");
    res.send(exportPrometheusMetrics(database));
  });

  // Headless IPC adapter: maps the method names callers use to the
  // database/core functions that back them. This is a subset of the
  // Electron IPC surface — enough for API clients, dashboards, and
  // automation scripts.
  mountBridge(app, {
    invoke: async (method, ...args) => {
      void args;
      switch (method) {
        case "getSettings":
          return {
            workspacePath: options.workspace,
            appDataDir: database.filePath ? String(database.filePath) : "",
            databasePath: String(database.filePath ?? ""),
            modelProvider: database.getSetting<string>("model.provider") ?? "local",
            byokEnabled: Boolean(database.getSetting("model.apiKey"))
          };
        case "listTraces":
          return database.listTraces(50, 0);
        case "getMetrics":
          return collectMetrics(database);
        case "exportPrometheus":
          return exportPrometheusMetrics(database);
        default:
          throw new Error(
            `Method '${method}' is not available in headless server mode. ` +
            "Use the Electron desktop app for the full IPC surface."
          );
      }
    }
  });

  // 404 for anything else.
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}

/**
 * Generate a minimal Dockerfile + .dockerignore for running SquidBot as a
 * containerised daemon. Call `npm run serve -- --port 8080` inside the container
 * to start the headless HTTP server.
 */
export function generateDockerfile(options: { port?: number } = {}): DockerfileResult {
  const port = options.port ?? 8080;
  const dockerfile = `# SquidBot headless daemon image.
# Build: docker build -t squidbot .
# Run:   docker run -p ${port}:${port} -e SQUIDBOT_TOKEN=<token> squidbot
FROM node:22-alpine
WORKDIR /app
# better-sqlite3 builds a native addon; alpine needs the build toolchain.
RUN apk add --no-cache python3 make g++
COPY package*.json ./
# Install ALL deps — the TypeScript entrypoint runs via tsx (a dev dependency),
# so --omit=dev would strip the loader and the image could not start.
RUN npm ci
COPY . .
ENV NODE_ENV=production
ENV PORT=${port}
EXPOSE ${port}
# Bind 0.0.0.0 inside the container so the published port is reachable; protect
# it with SQUIDBOT_TOKEN. tsx executes the .ts entrypoint (plain node cannot).
ENTRYPOINT ["npx", "tsx", "apps/cli/src/index.ts"]
CMD ["serve", "--port", "${port}", "--host", "0.0.0.0"]
`;

  const dockerignore = `.git
.github
node_modules
dist
*.log
.env
.env.*
apps/desktop
zz- insperation*
`;

  return { dockerfile, dockerignore };
}
