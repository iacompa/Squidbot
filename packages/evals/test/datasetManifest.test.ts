import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRoots, datasetManifest, datasetRoot } from "./helpers.js";
import { loadDatasetManifest, validateDatasetManifest } from "../src/index.js";

afterEach(cleanupTempRoots);

describe("Eval dataset manifest validation", () => {
  it("loads a valid zero-spend local dataset", () => {
    const root = datasetRoot();
    const manifest = loadDatasetManifest(root);
    expect(manifest.id).toBe("test-calculator-bugfix");
    expect(manifest.zeroSpend).toBe(true);
    expect(manifest.scoring.weights.taskSuccessRate).toBeGreaterThan(0);
  });

  it("rejects missing tasks, paid providers, and external fixtures", () => {
    expect(() => validateDatasetManifest({ ...datasetManifest(), tasks: [] })).toThrow(/at least one task/);
    expect(() =>
      validateDatasetManifest({
        ...datasetManifest(),
        constraints: { ...(datasetManifest().constraints as Record<string, unknown>), allowByok: true }
      })
    ).toThrow(/allowByok/);
    expect(() =>
      validateDatasetManifest({
        ...datasetManifest(),
        tasks: [
          {
            ...(datasetManifest().tasks as Array<Record<string, unknown>>)[0],
            fixture: { workspacePath: "https://example.com/repo.zip" }
          }
        ]
      })
    ).toThrow(/local/);
  });
});
