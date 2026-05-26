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
