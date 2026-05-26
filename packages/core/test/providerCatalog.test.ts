import { describe, expect, it } from "vitest";
import { PROVIDER_MODEL_CATALOG, getDefaultModelForProvider } from "../src/providerCatalog.js";

describe("PROVIDER_MODEL_CATALOG", () => {
  const directProviders = ["anthropic", "deepseek", "gemini", "groq", "openai", "together", "xai"] as const;

  describe.each(directProviders)("%s", (provider) => {
    const catalog = PROVIDER_MODEL_CATALOG[provider];

    it("has at least 3 entries", () => {
      expect(catalog.length).toBeGreaterThanOrEqual(3);
    });

    it("has at least one flagship-tier entry", () => {
      expect(catalog.some((entry) => entry.tier === "flagship")).toBe(true);
    });

    it("attaches pricing to every entry", () => {
      for (const entry of catalog) {
        expect(entry.pricing, `${entry.id} missing pricing`).toBeDefined();
        expect(entry.pricing!.inputPerMTokens).toBeDefined();
        expect(entry.pricing!.outputPerMTokens).toBeDefined();
      }
    });

    it("has unique model ids", () => {
      const ids = catalog.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("exposes a non-null default model", () => {
      expect(getDefaultModelForProvider(provider)).not.toBeNull();
    });
  });

  it("openrouter sampler has at least 6 entries", () => {
    expect(PROVIDER_MODEL_CATALOG.openrouter.length).toBeGreaterThanOrEqual(6);
  });

  it("ollama and custom remain unaffected by the refresh", () => {
    expect(PROVIDER_MODEL_CATALOG.ollama.length).toBeGreaterThan(0);
    expect(PROVIDER_MODEL_CATALOG.custom.length).toBe(0);
  });
});
