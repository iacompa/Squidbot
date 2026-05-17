import { describe, expect, it, vi } from "vitest";
import { executeRealHttpCall, applyPathTemplate } from "../src/httpTransport.js";
import type { ConnectorEndpoint, ConnectorManifest } from "../src/manifest.js";

function manifest(authType: "bearer" | "basic" | "apiKey" | "none" = "bearer"): ConnectorManifest {
  return {
    name: "test", systemType: "test", description: "test", protocol: "rest",
    auth: authType === "apiKey" ? { type: "apiKey", headerName: "X-API-Key" } : { type: authType },
    permissions: [], endpoints: [], dataClassifications: [],
    fixtureMode: false, costOwner: "free", readWrite: { read: [], write: [] }
  } as ConnectorManifest;
}

function endpoint(method: ConnectorEndpoint["method"], path: string): ConnectorEndpoint {
  return {
    operationId: "test", method, path, description: "test",
    permission: "low", inputSchema: {}, outputSchema: {}, dataClassifications: []
  } as ConnectorEndpoint;
}

describe("applyPathTemplate", () => {
  it("substitutes placeholders and returns residual args", () => {
    const { url, residual } = applyPathTemplate(
      "/repos/{owner}/{repo}/issues",
      { owner: "foo", repo: "bar", title: "x" }
    );
    expect(url).toBe("/repos/foo/bar/issues");
    expect(residual).toEqual({ title: "x" });
  });

  it("URL-encodes path segments", () => {
    const { url } = applyPathTemplate("/file/{path}", { path: "a b/c" });
    expect(url).toBe("/file/a%20b%2Fc");
  });
});

describe("executeRealHttpCall — auth", () => {
  function captureRequest(handler: (init: RequestInit) => Response): { restore: () => void; captured: () => RequestInit | null } {
    let captured: RequestInit | null = null;
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_url, init) => {
      captured = init ?? {};
      return handler(captured);
    }) as typeof fetch;
    return { restore: () => { globalThis.fetch = original; }, captured: () => captured };
  }

  it("sends Bearer token for auth.type='bearer'", async () => {
    const { restore, captured } = captureRequest(() =>
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })
    );
    try {
      await executeRealHttpCall(manifest("bearer"), endpoint("GET", "/user"), {}, { baseUrl: "https://api.example", apiKey: "sk-test" });
      const init = captured()!;
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    } finally { restore(); }
  });

  it("sends Basic auth header for auth.type='basic'", async () => {
    const { restore, captured } = captureRequest(() =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    );
    try {
      await executeRealHttpCall(manifest("basic"), endpoint("GET", "/me"), {}, { baseUrl: "https://api.example", apiKey: "tok" });
      const init = captured()!;
      // base64("x:tok") = "eDp0b2s="
      expect((init.headers as Record<string, string>).Authorization).toBe("Basic eDp0b2s=");
    } finally { restore(); }
  });

  it("sends custom header for auth.type='apiKey'", async () => {
    const { restore, captured } = captureRequest(() =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    );
    try {
      await executeRealHttpCall(manifest("apiKey"), endpoint("GET", "/x"), {}, { baseUrl: "https://api.example", apiKey: "k" });
      const init = captured()!;
      expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("k");
    } finally { restore(); }
  });
});

describe("executeRealHttpCall — body + path templating", () => {
  it("uses templated args in the URL and remaining args as JSON body for POST", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, init) => {
      capturedUrl = String(url);
      capturedBody = String(init?.body ?? "");
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      await executeRealHttpCall(
        manifest("bearer"),
        endpoint("POST", "/repos/{owner}/{repo}/issues"),
        { owner: "foo", repo: "bar", title: "Bug", body: "Details" },
        { baseUrl: "https://api.example", apiKey: "k" }
      );
      expect(capturedUrl).toBe("https://api.example/repos/foo/bar/issues");
      expect(JSON.parse(capturedBody)).toEqual({ title: "Bug", body: "Details" });
    } finally { globalThis.fetch = original; }
  });
});

describe("executeRealHttpCall — error normalization", () => {
  function withStatus(status: number, body = "x"): () => void {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(body, { status })) as typeof fetch;
    return () => { globalThis.fetch = original; };
  }

  it("returns code='auth' for 401", async () => {
    const restore = withStatus(401);
    try {
      const r = await executeRealHttpCall(manifest("bearer"), endpoint("GET", "/x"), {}, { baseUrl: "u", apiKey: "k" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("auth");
    } finally { restore(); }
  });
  it("returns code='forbidden' for 403", async () => {
    const restore = withStatus(403);
    try {
      const r = await executeRealHttpCall(manifest("bearer"), endpoint("GET", "/x"), {}, { baseUrl: "u", apiKey: "k" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("forbidden");
    } finally { restore(); }
  });
  it("returns code='not_found' for 404", async () => {
    const restore = withStatus(404);
    try {
      const r = await executeRealHttpCall(manifest("bearer"), endpoint("GET", "/x"), {}, { baseUrl: "u", apiKey: "k" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("not_found");
    } finally { restore(); }
  });
  it("returns code='rate_limit' for 429", async () => {
    const restore = withStatus(429);
    try {
      const r = await executeRealHttpCall(manifest("bearer"), endpoint("GET", "/x"), {}, { baseUrl: "u", apiKey: "k" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("rate_limit");
    } finally { restore(); }
  });
  it("returns code='server_error' for 500", async () => {
    const restore = withStatus(500);
    try {
      const r = await executeRealHttpCall(manifest("bearer"), endpoint("GET", "/x"), {}, { baseUrl: "u", apiKey: "k" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("server_error");
    } finally { restore(); }
  });
});
