import { describe, expect, it, vi } from "vitest";
import { executeRealHttpCall } from "../src/httpTransport.js";

const manifest = { name: "demo", endpoints: [], auth: { type: "bearer" } } as never;
const endpoint = { operationId: "ping", method: "POST", path: "/ping" } as never;

describe("executeRealHttpCall error-body preservation (2.5)", () => {
  it("surfaces the full structured server error body, not just a status", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "validation_failed", details: ["field x is required"] }), {
          status: 422,
          headers: { "content-type": "application/json" }
        })
    ) as typeof fetch;
    try {
      const result = await executeRealHttpCall(
        manifest,
        endpoint,
        { x: 1 },
        { baseUrl: "https://api.example.com", apiKey: "k" }
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(422);
        // The full structured body must be preserved for diagnostics/traces,
        // not reduced to "HTTP 422".
        expect(result.body).toEqual({ error: "validation_failed", details: ["field x is required"] });
      }
    } finally {
      globalThis.fetch = original;
    }
  });
});
