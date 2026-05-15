import { describe, expect, it, vi } from "vitest";
import { deriveModelsUrl, discoverProviderModels } from "../src/modelDiscovery.js";

describe("deriveModelsUrl", () => {
  it("rewrites /chat/completions to /models for OpenAI-compatible endpoints", () => {
    expect(deriveModelsUrl("https://openrouter.ai/api/v1/chat/completions")).toBe(
      "https://openrouter.ai/api/v1/models"
    );
    expect(deriveModelsUrl("https://api.openai.com/v1/chat/completions")).toBe(
      "https://api.openai.com/v1/models"
    );
    expect(deriveModelsUrl("https://api.groq.com/openai/v1/chat/completions")).toBe(
      "https://api.groq.com/openai/v1/models"
    );
  });

  it("appends /models when the URL doesn't end in /chat/completions", () => {
    expect(deriveModelsUrl("https://custom.example/api")).toBe(
      "https://custom.example/api/models"
    );
    expect(deriveModelsUrl("https://custom.example/api/")).toBe(
      "https://custom.example/api/models"
    );
  });
});

describe("discoverProviderModels", () => {
  function withFakeFetch(handler: (req: { url: string; init: RequestInit }) => Response): { restore: () => void } {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
      handler({ url: String(url), init: init ?? {} })
    ) as typeof fetch;
    return {
      restore: () => {
        globalThis.fetch = original;
      }
    };
  }

  it("returns the model ids from a successful OpenAI-style response", async () => {
    const { restore } = withFakeFetch(({ url, init }) => {
      // The function must hit the /models endpoint, not the chat one.
      expect(url).toBe("https://openrouter.ai/api/v1/models");
      // And it must send the bearer token.
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
      const body = JSON.stringify({
        data: [
          { id: "anthropic/claude-opus-4-5", object: "model" },
          { id: "openai/gpt-5", object: "model" },
          { id: "google/gemini-2.0-flash-001", object: "model" }
        ]
      });
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    });
    try {
      const result = await discoverProviderModels({
        apiUrl: "https://openrouter.ai/api/v1/chat/completions",
        apiKey: "sk-test"
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.models).toEqual([
          "anthropic/claude-opus-4-5",
          "openai/gpt-5",
          "google/gemini-2.0-flash-001"
        ]);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
      }
    } finally {
      restore();
    }
  });

  it("returns the auth error code on 401", async () => {
    const { restore } = withFakeFetch(() =>
      new Response("Unauthorized", { status: 401 })
    );
    try {
      const result = await discoverProviderModels({
        apiUrl: "https://api.openai.com/v1/chat/completions",
        apiKey: "sk-wrong"
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("auth");
      }
    } finally {
      restore();
    }
  });

  it("returns the not_found error code on 404 (provider has no /models endpoint)", async () => {
    const { restore } = withFakeFetch(() => new Response("Not found", { status: 404 }));
    try {
      const result = await discoverProviderModels({
        apiUrl: "https://provider-without-models.example/v1/chat/completions",
        apiKey: "k"
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("not_found");
      }
    } finally {
      restore();
    }
  });

  it("handles a top-level array body (off-spec but seen in the wild)", async () => {
    const { restore } = withFakeFetch(() =>
      new Response(JSON.stringify(["llama3.3:latest", "phi3:latest"]), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    try {
      const result = await discoverProviderModels({
        apiUrl: "http://localhost:11434/v1/chat/completions",
        apiKey: "ollama"
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.models).toEqual(["llama3.3:latest", "phi3:latest"]);
      }
    } finally {
      restore();
    }
  });

  it("returns a malformed code when the body is empty", async () => {
    const { restore } = withFakeFetch(() =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    try {
      const result = await discoverProviderModels({
        apiUrl: "https://provider.example/v1/chat/completions",
        apiKey: "k"
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("malformed");
      }
    } finally {
      restore();
    }
  });

  it("requires both apiUrl and apiKey", async () => {
    const a = await discoverProviderModels({ apiUrl: "", apiKey: "k" });
    expect(a.success).toBe(false);
    const b = await discoverProviderModels({ apiUrl: "u", apiKey: "" });
    expect(b.success).toBe(false);
  });
});
