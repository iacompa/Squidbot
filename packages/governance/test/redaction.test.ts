import { describe, expect, it } from "vitest";
import { redactValue } from "../src/index.js";

describe("governance redaction", () => {
  it("redacts token-like and email values", () => {
    const redacted = redactValue({ token: "sk-test-1234567890abcdef", email: "person@example.com" }).value;
    expect(JSON.stringify(redacted)).not.toContain("sk-test-1234567890abcdef");
    expect(JSON.stringify(redacted)).not.toContain("person@example.com");
  });
});
