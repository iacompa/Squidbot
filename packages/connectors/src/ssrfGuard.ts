import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

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

/**
 * Extract the embedded IPv4 from an IPv4-mapped IPv6 address. The WHATWG URL
 * parser normalizes `::ffff:127.0.0.1` to the hex form `::ffff:7f00:1`, so we
 * accept BOTH the dotted-quad suffix and the two-hextet hex suffix. Returns the
 * dotted-quad string, or null if not an IPv4-mapped address.
 */
function mappedIPv4FromV6(lower: string): string | null {
  if (!lower.startsWith("::ffff:")) return null;
  const suffix = lower.slice("::ffff:".length);
  if (isIP(suffix) === 4) return suffix; // ::ffff:a.b.c.d
  const hextets = suffix.split(":");
  if (hextets.length === 2 && hextets.every((h) => /^[0-9a-f]{1,4}$/.test(h))) {
    const hi = parseInt(hextets[0], 16);
    const lo = parseInt(hextets[1], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

function isPrivateIPv6(addr: string): boolean {
  const lower = addr.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
  if (lower.startsWith("fe80:")) return true; // link-local
  const mapped = mappedIPv4FromV6(lower);
  if (mapped) return isPrivateIPv4(mapped); // ::ffff:127.0.0.1 → 127.0.0.1, etc.
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

  const bracketless = url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
  // Normalize a single trailing dot (FQDN form: "localhost." / "127.0.0.1.")
  // which resolves identically to the bare host but would otherwise dodge the
  // private-hostname and private-IP string checks below.
  const hostname = bracketless.replace(/\.$/, "");

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

/**
 * Resolve a DNS hostname and reject if ANY resolved address is private. The
 * string-level `assertPublicHttpUrl` check can be defeated by a hostname (e.g.
 * `internal.attacker.com` with an A record of 169.254.169.254) that only
 * reveals its private target after resolution. Literal IPs are already covered
 * by `assertPublicHttpUrl`, so this is a no-op for them.
 *
 * Residual: full TOCTOU/DNS-rebinding protection requires pinning the resolved
 * IP into the connection, which Node's `fetch` does not expose; resolving and
 * checking here closes the common "hostname → internal IP" hole.
 */
export async function assertResolvedHostPublic(hostname: string): Promise<void> {
  if (isIP(hostname) !== 0) return; // literal IP — already validated
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    return; // resolution failure surfaces later as a normal fetch/network error
  }
  for (const { address } of addresses) {
    const kind = isIP(address);
    if ((kind === 4 && isPrivateIPv4(address)) || (kind === 6 && isPrivateIPv6(address))) {
      throw new SsrfError(`Host ${hostname} resolves to a private address: ${address}`);
    }
  }
}
