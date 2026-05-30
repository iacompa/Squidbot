import type { JsonObject, ToolContext } from "@squidbot/core";
import type { ConnectorEndpoint, ConnectorManifest } from "./manifest.js";
import { assertPublicHttpUrl, assertResolvedHostPublic, SsrfError } from "./ssrfGuard.js";

const DEFAULT_GITHUB_TIMEOUT_MS = 15_000;

const pathArgAliases: Record<string, string> = {
  pull_number: "pullNumber",
  issue_number: "issueNumber",
  workflow_id: "workflowId",
  run_id: "runId"
};

class MissingPathArgError extends Error {
  constructor(public readonly segment: string) {
    super(`Missing required path parameter: ${segment}`);
    this.name = "MissingPathArgError";
  }
}

function resolvePathArg(args: JsonObject, segment: string): string {
  const alias = pathArgAliases[segment] ?? segment;
  const value = args[alias] ?? args[segment];
  if (value === undefined || value === null || value === "") {
    throw new MissingPathArgError(segment);
  }
  return encodeURIComponent(String(value));
}

export function buildConnectorUrl(baseUrl: string, endpoint: ConnectorEndpoint, args: JsonObject): URL {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  let pathname = endpoint.path.replace(/\{([^}]+)\}/g, (_match, segment: string) => resolvePathArg(args, segment));
  const url = new URL(`${normalizedBase}${pathname.startsWith("/") ? "" : "/"}${pathname}`);

  if (endpoint.operationId === "searchCode" && typeof args.query === "string") {
    url.searchParams.set("q", args.query);
  }
  if (endpoint.operationId === "listIssues" && typeof args.state === "string") {
    url.searchParams.set("state", args.state);
  }

  return url;
}

function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower === "0.0.0.0" || lower === "::" || lower === "::1") {
    return true;
  }
  if (/^127\./.test(lower)) {
    return true;
  }
  if (/^10\./.test(lower)) {
    return true;
  }
  if (/^192\.168\./.test(lower)) {
    return true;
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(lower)) {
    return true;
  }
  if (/^169\.254\./.test(lower)) {
    return true;
  }
  if (/^fc[0-9a-f]{2}:/.test(lower) || /^fd[0-9a-f]{2}:/.test(lower)) {
    return true;
  }
  if (/^fe80:/.test(lower)) {
    return true;
  }
  return false;
}

export function isAllowedGithubHost(hostname: string, allowedHosts: string[]): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "api.github.com") {
    return true;
  }
  for (const allowed of allowedHosts) {
    const candidate = allowed.toLowerCase().trim();
    if (candidate && (lower === candidate || lower.endsWith(`.${candidate}`))) {
      return true;
    }
  }
  return false;
}

function getGithubAllowedHosts(context: ToolContext): string[] {
  const raw = context.getSetting?.<string>("github.allowedHosts");
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
}

function validateGithubUrl(url: URL, allowedHosts: string[]): { ok: true } | { ok: false; reason: string } {
  if (url.protocol !== "https:") {
    return { ok: false, reason: `Refusing non-HTTPS GitHub URL: ${url.protocol}` };
  }
  if (isPrivateHostname(url.hostname)) {
    return { ok: false, reason: `Refusing private/loopback GitHub host: ${url.hostname}` };
  }
  if (!isAllowedGithubHost(url.hostname, allowedHosts)) {
    return {
      ok: false,
      reason: `GitHub host not in allowlist: ${url.hostname}. Configure github.allowedHosts (comma-separated) to permit additional GHE hosts.`
    };
  }
  return { ok: true };
}

export async function executeGithubReadRequest(
  manifest: ConnectorManifest,
  endpoint: ConnectorEndpoint,
  args: JsonObject,
  context: ToolContext
): Promise<JsonObject> {
  const token = context.getSetting?.<string>("github.apiToken") ?? context.getSetting?.<string>("github.token");
  if (!token?.trim()) {
    return {
      connectorName: manifest.name,
      operationName: endpoint.operationId,
      mode: "fixture-fallback",
      fixture: false,
      executed: false,
      reason: "Set github.apiToken to enable read-only GitHub API calls."
    };
  }

  const baseUrl = context.getSetting?.<string>("github.baseUrl") ?? "https://api.github.com";
  let url: URL;
  try {
    url = buildConnectorUrl(baseUrl, endpoint, args);
  } catch (error) {
    if (error instanceof MissingPathArgError) {
      return {
        connectorName: manifest.name,
        operationName: endpoint.operationId,
        mode: "real",
        fixture: false,
        executed: false,
        error: `Missing required path parameter: ${error.segment}`
      };
    }
    return {
      connectorName: manifest.name,
      operationName: endpoint.operationId,
      mode: "real",
      fixture: false,
      executed: false,
      error: `Invalid connector URL: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  const allowedHosts = getGithubAllowedHosts(context);
  const validation = validateGithubUrl(url, allowedHosts);
  if (!validation.ok) {
    return {
      connectorName: manifest.name,
      operationName: endpoint.operationId,
      mode: "real",
      fixture: false,
      executed: false,
      error: validation.reason
    };
  }

  const timeoutMs = Number(context.getSetting?.<string>("github.timeoutMs")) || DEFAULT_GITHUB_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: endpoint.method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token.trim()}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "SquidBot-Connector"
      },
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timer);
    const aborted = (error as { name?: string } | null)?.name === "AbortError";
    return {
      connectorName: manifest.name,
      operationName: endpoint.operationId,
      mode: "real",
      fixture: false,
      executed: false,
      error: aborted ? `GitHub request timed out after ${timeoutMs}ms` : `GitHub request failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  clearTimeout(timer);

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    return {
      connectorName: manifest.name,
      operationName: endpoint.operationId,
      mode: "real",
      fixture: false,
      executed: true,
      status: response.status,
      error: typeof body === "object" && body && "message" in (body as Record<string, unknown>)
        ? String((body as Record<string, unknown>).message)
        : `GitHub API returned ${response.status}`,
      response: body
    };
  }

  return {
    connectorName: manifest.name,
    operationName: endpoint.operationId,
    mode: "real",
    fixture: false,
    executed: true,
    status: response.status,
    response: body
  };
}

export function isGithubReadOperation(manifest: ConnectorManifest, endpoint: ConnectorEndpoint): boolean {
  return manifest.name === "github" && manifest.readWrite.read.includes(endpoint.operationId);
}

export type ConnectorRuntimeSettings = {
  baseUrl: string;
  apiKey: string | null;
};

export type HttpCallResult =
  | { ok: true; status: number; durationMs: number; body: unknown }
  | {
      ok: false;
      code: "auth" | "forbidden" | "not_found" | "rate_limit" | "server_error" | "timeout" | "network" | "ssrf" | "unknown";
      status?: number;
      durationMs: number;
      message: string;
      /** The parsed server error response, preserved for diagnostics/traces. */
      body?: unknown;
    };

/**
 * Substitute {placeholder} tokens in a URL template with values from args.
 * Returns the URL with placeholders filled in (URL-encoded) and the residual
 * args (those NOT consumed by any placeholder).
 *
 * Example:
 *   applyPathTemplate("/repos/{owner}/{repo}/issues", { owner: "foo", repo: "bar", title: "x" })
 *   → { url: "/repos/foo/bar/issues", residual: { title: "x" } }
 *
 * Encodes each substituted value with encodeURIComponent so reserved chars
 * (space, /, ?, etc.) don't break the URL structure. Throws if a referenced
 * placeholder isn't present in args (a hard error, not silently empty).
 */
export function applyPathTemplate(
  template: string,
  args: Record<string, unknown>
): { url: string; residual: Record<string, unknown> } {
  const residual = { ...args };
  const url = template.replace(/\{([^}]+)\}/g, (_match, key) => {
    const value = residual[key];
    if (value === undefined || value === null) {
      throw new Error(`Missing required path argument: ${key}`);
    }
    delete residual[key];
    return encodeURIComponent(String(value));
  });
  return { url, residual };
}

function buildAuthHeader(manifest: ConnectorManifest, apiKey: string | null): Record<string, string> {
  if (!apiKey) return {};
  const auth = manifest.auth;
  switch (auth.type) {
    case "bearer":
      return { Authorization: `Bearer ${apiKey}` };
    case "basic": {
      // GitHub PATs, GitLab PATs, Atlassian API tokens all use the "x" username
      // convention. The user supplies just the token; we prepend "x:".
      const encoded = Buffer.from(`x:${apiKey}`, "utf8").toString("base64");
      return { Authorization: `Basic ${encoded}` };
    }
    case "apiKey": {
      const headerName = (auth as { headerName?: string }).headerName ?? "X-API-Key";
      return { [headerName]: apiKey };
    }
    case "none":
    default:
      return {};
  }
}

type HttpErrorCode = Extract<HttpCallResult, { ok: false }>["code"];

function codeForStatus(status: number): HttpErrorCode {
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server_error";
  return "unknown";
}

/**
 * Make a real HTTP call to a connector endpoint, using args to template the
 * URL and (for write methods) serialize the body. Returns a discriminated
 * union — ok:true with parsed body, or ok:false with a stable error code.
 *
 * Never throws — every failure mode maps to a code:
 *   401 → "auth"
 *   403 → "forbidden"
 *   404 → "not_found"
 *   429 → "rate_limit"
 *   5xx → "server_error"
 *   AbortError → "timeout"
 *   Other fetch errors → "network"
 *
 * Sensitive data (request/response bodies, auth headers) is NEVER logged or
 * emitted as an event from this module. Event emission is the caller's
 * responsibility (tools.ts does it after this returns, with only status +
 * duration + ok flag).
 */
export async function executeRealHttpCall(
  manifest: ConnectorManifest,
  endpoint: ConnectorEndpoint,
  args: Record<string, unknown>,
  settings: ConnectorRuntimeSettings,
  options: { timeoutMs?: number } = {}
): Promise<HttpCallResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const start = Date.now();

  let url: string;
  let residual: Record<string, unknown>;
  try {
    const templated = applyPathTemplate(endpoint.path, args);
    url = `${settings.baseUrl.replace(/\/$/, "")}${
      templated.url.startsWith("/") ? templated.url : "/" + templated.url
    }`;
    residual = templated.residual;
  } catch (err) {
    return {
      ok: false,
      code: "unknown",
      durationMs: Date.now() - start,
      message: err instanceof Error ? err.message : String(err)
    };
  }

  // SSRF guard: refuse to fetch private/loopback/link-local hosts. Catches
  // cloud-metadata exfiltration (169.254.169.254), misconfigured baseUrls
  // pointing at localhost, and accidental LAN hits. The generic connector
  // HTTP path was previously unprotected — the github-read SSRF guard is
  // narrower and was the only outbound defense.
  try {
    assertPublicHttpUrl(url);
    // Resolve the hostname and reject if it points at a private address — a
    // string check alone can't see a public-looking name with an internal A
    // record (DNS-based SSRF / metadata exfiltration).
    await assertResolvedHostPublic(new URL(url).hostname);
  } catch (err) {
    if (err instanceof SsrfError) {
      return {
        ok: false,
        code: "ssrf",
        durationMs: Date.now() - start,
        message: err.message
      };
    }
    throw err;
  }

  const method = endpoint.method.toUpperCase();
  const hasBody = method === "POST" || method === "PUT" || method === "PATCH";

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...buildAuthHeader(manifest, settings.apiKey)
  };

  let body: string | undefined;
  if (hasBody && Object.keys(residual).length > 0) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(residual);
  } else if (!hasBody && Object.keys(residual).length > 0) {
    // GET / DELETE — non-templated args become query-string params.
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(residual)) {
      params.append(k, String(v));
    }
    url += (url.includes("?") ? "&" : "?") + params.toString();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Follow redirects MANUALLY so each hop is re-validated against the SSRF
    // guard — `fetch`'s default redirect:"follow" would silently chase a 302
    // from a public host to 169.254.169.254 (cloud metadata). Auth headers are
    // dropped on a cross-origin hop so a redirect can't exfiltrate credentials.
    let currentUrl = url;
    let currentHeaders = headers;
    let response = await fetch(currentUrl, { method, headers: currentHeaders, body, signal: controller.signal, redirect: "manual" });
    let redirects = 0;
    while ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 5) {
      const location = new URL(response.headers.get("location") as string, currentUrl).toString();
      try {
        assertPublicHttpUrl(location);
        await assertResolvedHostPublic(new URL(location).hostname);
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof SsrfError) {
          return { ok: false, code: "ssrf", durationMs: Date.now() - start, message: `Redirect to disallowed host blocked: ${err.message}` };
        }
        throw err;
      }
      if (new URL(location).origin !== new URL(currentUrl).origin) {
        currentHeaders = Object.fromEntries(
          Object.entries(currentHeaders).filter(([k]) => k.toLowerCase() !== "authorization" && k.toLowerCase() !== "x-api-key")
        );
      }
      currentUrl = location;
      redirects += 1;
      response = await fetch(currentUrl, { method, headers: currentHeaders, body, signal: controller.signal, redirect: "manual" });
    }
    clearTimeout(timer);
    const durationMs = Date.now() - start;
    const contentType = response.headers.get("content-type") ?? "";
    const parsed = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : await response.text().catch(() => "");

    if (response.ok) {
      return { ok: true, status: response.status, durationMs, body: parsed };
    }
    return {
      ok: false,
      code: codeForStatus(response.status),
      status: response.status,
      durationMs,
      message: typeof parsed === "string"
        ? parsed.slice(0, 500)
        : parsed && typeof parsed === "object" && "message" in parsed
          ? String((parsed as Record<string, unknown>).message).slice(0, 500)
          : `HTTP ${response.status}`,
      // Preserve the full parsed error body — a structured error without a
      // `message` field was previously reduced to "HTTP <status>".
      body: parsed
    };
  } catch (err) {
    clearTimeout(timer);
    const durationMs = Date.now() - start;
    if (controller.signal.aborted) {
      return { ok: false, code: "timeout", durationMs, message: `Request timed out after ${timeoutMs}ms.` };
    }
    return {
      ok: false,
      code: "network",
      durationMs,
      message: err instanceof Error ? err.message : String(err)
    };
  }
}
