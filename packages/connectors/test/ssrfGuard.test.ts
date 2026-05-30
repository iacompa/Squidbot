import { describe, it, expect } from "vitest";
import { assertPublicHttpUrl, SsrfError } from "../src/ssrfGuard.js";

describe("assertPublicHttpUrl", () => {
  it.each([
    "http://localhost/x",
    "http://127.0.0.1/x",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.1/x",
    "http://192.168.1.1/x",
    "http://172.16.0.1/x",
    "http://172.31.255.254/x",
    "http://[::1]/x",
    "http://[fc00::1]/x",
    "http://[fe80::1]/x",
    // IPv4-mapped IPv6 — the WHATWG URL parser normalizes these to the hex
    // form (::ffff:7f00:1), which the dotted-quad-only check used to miss.
    "http://[::ffff:127.0.0.1]/x",
    "http://[::ffff:169.254.169.254]/latest/meta-data/",
    // Trailing-dot FQDN forms resolve identically to the bare host.
    "http://localhost./x",
    "http://127.0.0.1./x",
    "ftp://example.com/x",
    "file:///etc/passwd",
    "javascript:alert(1)"
  ])("rejects %s", (url) => {
    expect(() => assertPublicHttpUrl(url)).toThrow(SsrfError);
  });

  it.each([
    "https://api.github.com/repos",
    "https://api.openai.com/v1/chat/completions",
    "https://example.com/x",
    "http://example.com/x",
    "https://173.194.222.139/x" // public Google IPv4
  ])("allows %s", (url) => {
    expect(() => assertPublicHttpUrl(url)).not.toThrow();
  });

  it("rejects 172.32.x.x — outside the private /12 range it is public", () => {
    // Sanity: 172.32 is public; 172.16-31 is private.
    expect(() => assertPublicHttpUrl("http://172.32.0.1/")).not.toThrow();
  });

  it("allows http loopback when allowPrivate is explicitly set", () => {
    expect(() => assertPublicHttpUrl("http://localhost/x", { allowPrivate: true })).not.toThrow();
  });

  it("returns the parsed URL on success", () => {
    const url = assertPublicHttpUrl("https://example.com/x?y=1");
    expect(url.hostname).toBe("example.com");
    expect(url.searchParams.get("y")).toBe("1");
  });
});
