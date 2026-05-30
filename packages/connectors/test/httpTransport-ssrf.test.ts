import { describe, it, expect, vi } from "vitest";
import { executeRealHttpCall } from "../src/httpTransport.js";
import { assertResolvedHostPublic, SsrfError } from "../src/ssrfGuard.js";
import type { ConnectorEndpoint, ConnectorManifest } from "../src/manifest.js";

const manifest = {
  name: "test",
  displayName: "Test",
  description: "fixture",
  baseUrl: "https://placeholder",
  auth: { type: "bearer" },
  endpoints: []
} as unknown as ConnectorManifest;

const endpoint: ConnectorEndpoint = {
  operationId: "ping",
  method: "GET",
  path: "/ping",
  summary: "fixture"
} as unknown as ConnectorEndpoint;

describe("executeRealHttpCall SSRF rejection", () => {
  it.each([
    "http://169.254.169.254",
    "http://localhost:8080",
    "http://127.0.0.1",
    "http://10.0.0.5",
    "http://192.168.1.1"
  ])("rejects %s without ever calling fetch", async (baseUrl) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await executeRealHttpCall(
      manifest,
      endpoint,
      {},
      { baseUrl, apiKey: "test-key" }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ssrf");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("blocks a redirect to a private host (no 302→metadata exfiltration)", async () => {
    // Public literal IP base (so the DNS pre-check is a no-op), but the server
    // responds with a 302 to the cloud-metadata endpoint. The manual-redirect
    // re-validation must refuse to follow it.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }) as Response
    );
    const result = await executeRealHttpCall(manifest, endpoint, {}, { baseUrl: "https://93.184.216.34", apiKey: "test-key" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ssrf");
    }
    fetchSpy.mockRestore();
  });

  it("assertResolvedHostPublic rejects a hostname that resolves to loopback", async () => {
    // localhost deterministically resolves to 127.0.0.1 / ::1 — a DNS name
    // pointing at a private address must be rejected after resolution.
    await expect(assertResolvedHostPublic("localhost")).rejects.toThrow(SsrfError);
  });

  it("does NOT reject public URLs (but we don't actually make a real call)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      }) as Response
    );
    const result = await executeRealHttpCall(
      manifest,
      endpoint,
      {},
      { baseUrl: "https://api.example.com", apiKey: "test-key" }
    );
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });
});
