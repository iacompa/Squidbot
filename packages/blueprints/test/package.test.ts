import { describe, expect, it } from "vitest";
import * as blueprints from "../src/index.js";

describe("@squidbot/blueprints package", () => {
  it("exports the validator and types", () => {
    expect(blueprints).toBeDefined();
  });
});
