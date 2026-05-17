import type { ConnectorEndpoint, ConnectorManifest } from "./manifest.js";

export type ConnectorRuntimeSettings = {
  baseUrl: string;
  apiKey: string | null;
};

export type HttpCallResult =
  | { ok: true; status: number; durationMs: number; body: unknown }
  | {
      ok: false;
      code: "auth" | "forbidden" | "not_found" | "rate_limit" | "server_error" | "timeout" | "network" | "unknown";
      status?: number;
      durationMs: number;
      message: string;
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
    const response = await fetch(url, { method, headers, body, signal: controller.signal });
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
          : `HTTP ${response.status}`
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
