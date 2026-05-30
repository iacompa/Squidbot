import { describe, it, expect } from "vitest";
import { validateToolArgs } from "../src/argValidation.js";

const schema = {
  type: "object",
  required: ["command"],
  properties: {
    command: { type: "string" },
    cwd: { type: "string" },
    retries: { type: "integer" },
    force: { type: "boolean" }
  }
};

describe("validateToolArgs", () => {
  it("accepts args that satisfy the schema", () => {
    expect(validateToolArgs(schema, { command: "ls", cwd: "/tmp" })).toEqual({ ok: true });
  });

  it("rejects a missing required property and names it", () => {
    const result = validateToolArgs(schema, { cwd: "/tmp" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(" ")).toContain("command");
  });

  it("rejects a known property of the wrong type", () => {
    const result = validateToolArgs(schema, { command: 123 });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(" ")).toMatch(/command.*string/);
  });

  it("collects multiple violations", () => {
    const result = validateToolArgs(schema, { retries: "soon", force: "yes" });
    expect(result.ok).toBe(false);
    // missing command + retries-not-integer + force-not-boolean = 3
    expect(result.ok === false && result.errors.length).toBe(3);
  });

  it("is permissive about unknown extra properties (additionalProperties defaults true)", () => {
    expect(validateToolArgs(schema, { command: "ls", undeclared: "fine" })).toEqual({ ok: true });
  });

  it("treats an absent optional property as valid", () => {
    expect(validateToolArgs(schema, { command: "ls" })).toEqual({ ok: true });
  });

  it("accepts any args for a non-object schema (under-validate rather than wrongly reject)", () => {
    expect(validateToolArgs({ type: "string" }, { anything: 1 })).toEqual({ ok: true });
  });

  it("distinguishes integer from float", () => {
    expect(validateToolArgs(schema, { command: "ls", retries: 3 })).toEqual({ ok: true });
    const result = validateToolArgs(schema, { command: "ls", retries: 3.5 });
    expect(result.ok).toBe(false);
  });
});
