import type { JsonObject, ToolContext } from "@squidbot/core";
import type { ConnectorEndpoint, ConnectorManifest } from "./manifest.js";

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
