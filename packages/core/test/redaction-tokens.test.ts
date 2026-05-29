import { describe, expect, it } from "vitest";
import { redactSecrets } from "../src/redaction.js";

describe("redactSecrets — provider credential patterns (finding 2.1)", () => {
  it.each([
    ["GitHub PAT", "ghp_0123456789abcdefghijKLMNOPqrstuvwx12"],
    ["GitHub OAuth", "gho_0123456789abcdefghijKLMNOPqrstuvwx12"],
    ["Slack bot token", "xoxb-not-a-real-token-redaction-fixture"],
    ["AWS access key id", "AKIAIOSFODNN7EXAMPLE"],
    [
      "JWT",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
    ]
  ])("redacts a %s embedded in a connector response body", (_label, token) => {
    const out = redactSecrets(`{"result":"ok","token":"${token}"}`);
    expect(out).not.toContain(token);
    expect(out).toContain("[REDACTED]");
  });

  it("redacts a bearer token in an Authorization header line", () => {
    const out = redactSecrets("Authorization: Bearer abcDEF1234567890ghijKL");
    expect(out).not.toContain("abcDEF1234567890ghijKL");
  });

  it("does NOT over-redact ordinary prose, numbers, or short identifiers", () => {
    const text = "The quick brown fox jumps over the lazy dog. Build 12345 passed in commit a1b2c3.";
    expect(redactSecrets(text)).toBe(text);
  });
});
