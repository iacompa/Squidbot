export function isPrivateOrLoopbackHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower === "0.0.0.0" || lower === "::" || lower === "::1") return true;
  if (/^127\./.test(lower)) return true;
  if (/^10\./.test(lower)) return true;
  if (/^192\.168\./.test(lower)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(lower)) return true;
  if (/^169\.254\./.test(lower)) return true;
  if (/^fc[0-9a-f]{2}:/.test(lower) || /^fd[0-9a-f]{2}:/.test(lower)) return true;
  if (/^fe80:/.test(lower)) return true;
  return false;
}

/**
 * Strict variant for the legacy single-account `model.apiUrl` setting.
 * Requires https — the URL receives the user's API key on every chat turn.
 */
export function validateProviderApiUrl(rawUrl: string): string | null {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return "API URL is required.";
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return `Invalid provider URL: ${rawUrl}`;
  }
  if (parsed.protocol !== "https:") {
    return "Provider URL must use https:// to protect the API key in transit.";
  }
  if (isPrivateOrLoopbackHostname(parsed.hostname)) {
    return `Refusing to send API key to a private/loopback host: ${parsed.hostname}`;
  }
  return null;
}

/**
 * Looser variant for the multi-BYOK `upsertModelAccount` path. Accepts http
 * so users can point at a private gateway intentionally, but still rejects
 * private/loopback hosts (the audit found these were silently allowed and
 * would ship the API key on the next chat). Use the strict variant for any
 * path where http is not a legitimate use case.
 */
export function validateModelAccountApiUrl(rawUrl: string): string | null {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return null; // empty is OK at this layer; account-level enforcement happens elsewhere
  }
  if (rawUrl.trim() === "codex://local") {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return `Invalid apiUrl: ${rawUrl}`;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "apiUrl must use http, https, or codex://local protocol.";
  }
  if (isPrivateOrLoopbackHostname(parsed.hostname)) {
    return `Refusing apiUrl pointing at a private/loopback host: ${parsed.hostname}`;
  }
  return null;
}
