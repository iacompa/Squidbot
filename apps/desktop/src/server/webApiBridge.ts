import type { Express } from "express";
import express from "express";

export type WebApiBridgeAdapter = {
  /**
   * Invoke an IPC method by name. The adapter is responsible for
   * mapping the method to the right handler (the Electron main process
   * uses ipcMain.handle; a headless test harness might use a Map).
   */
  invoke: (method: string, ...args: unknown[]) => Promise<unknown>;
};

// Object/Function prototype member names that must never be dispatched —
// they enable prototype-pollution / unexpected built-in access if a method
// lookup ever indexes a plain object by the request path.
const UNSAFE_METHOD_NAMES = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toString",
  "toLocaleString",
  "valueOf"
]);

// Real IPC method names are camelCase identifiers (e.g. listBlueprints,
// model_useAccount). Anything else — dotted paths, dashes, leading digits,
// empty — is rejected.
const SAFE_METHOD_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/** True only for a well-formed, non-prototype-pollution IPC method name. */
export function isSafeBridgeMethod(method: string): boolean {
  return typeof method === "string" && SAFE_METHOD_PATTERN.test(method) && !UNSAFE_METHOD_NAMES.has(method);
}

/**
 * Mounts POST /api/:method routes on the given Express app. Each request
 * body is { args: unknown[] }; the response is the JSON result of the
 * corresponding IPC handler. Errors are returned as { error: string }
 * with HTTP 500.
 *
 * No auth in Phase 1 — assumes localhost only. Phase 6 (Deployment +
 * Observability) wraps this in TLS + session auth for production
 * multi-user deploys.
 */
export function mountWebApiBridge(app: Express, adapter: WebApiBridgeAdapter): void {
  app.use(express.json({ limit: "5mb" }));

  app.post("/api/:method", async (req, res) => {
    const { method } = req.params;
    // Reject prototype-pollution / malformed method names before dispatch.
    if (!isSafeBridgeMethod(method)) {
      res.status(400).json({ error: `Invalid method name: ${method}` });
      return;
    }
    const body = (req.body ?? {}) as { args?: unknown[] };
    const args = Array.isArray(body.args) ? body.args : [];
    try {
      const result = await adapter.invoke(method, ...args);
      res.json(result ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });
}
