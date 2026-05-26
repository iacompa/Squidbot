import { isIP } from "node:net";

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

function isPrivateIPv4(addr: string): boolean {
  const parts = addr.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 0) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}

function isPrivateIPv6(addr: string): boolean {
  const lower = addr.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("::ffff:")) {
    const v4 = lower.slice("::ffff:".length);
    if (isIP(v4) === 4) return isPrivateIPv4(v4);
  }
  return false;
}

const PRIVATE_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);

export interface SsrfGuardOptions {
  allowPrivate?: boolean;
}

/**
 * Reject URLs that point at private/loopback/link-local hosts before any
 * outbound fetch. Protects against SSRF, cloud-metadata exfiltration
 * (169.254.169.254), and accidental LAN/loopback hits when a user pastes
 * a misconfigured baseUrl.
 *
 * Accepts http and https. Set `allowPrivate: true` only for tests that
 * deliberately need a loopback target — never in production callers.
 */
export function assertPublicHttpUrl(rawUrl: string, opts: SsrfGuardOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError(`Invalid URL: ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError(`Disallowed protocol: ${url.protocol}`);
  }

  if (opts.allowPrivate) return url;

  const hostname = url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;

  if (PRIVATE_HOSTNAMES.has(hostname.toLowerCase())) {
    throw new SsrfError(`Disallowed private host: ${hostname}`);
  }

  const ipKind = isIP(hostname);
  if (ipKind === 4 && isPrivateIPv4(hostname)) {
    throw new SsrfError(`Disallowed private IPv4: ${hostname}`);
  }
  if (ipKind === 6 && isPrivateIPv6(hostname)) {
    throw new SsrfError(`Disallowed private IPv6: ${hostname}`);
  }

  return url;
}
