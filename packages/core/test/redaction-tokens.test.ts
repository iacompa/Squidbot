import { describe, expect, it } from "vitest";
import { redactSecrets, redactValue } from "../src/redaction.js";

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

describe("redactSecrets — additional credential & PII formats", () => {
  it.each([
    ["Groq", "gsk_0123456789abcdefghijKLMNOPqrstuvwx0123456789ab"],
    ["xAI", "xai-0123456789abcdefghijKLMNOPqrstuvwx0123456789"],
    ["Google AI", "AIzaSyA0123456789_abcdefghij-KLMNOPqrstu"]
  ])("redacts a %s API key", (_label, token) => {
    const out = redactSecrets(`provider key=${token}`);
    expect(out).not.toContain(token);
    expect(out).toContain("[REDACTED]");
  });

  it("redacts a PEM private key block", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEAsecretkeymaterialXYZ\n-----END RSA PRIVATE KEY-----";
    const out = redactSecrets(`config: ${pem}`);
    expect(out).not.toContain("MIIEpAIBAAKCAQEAsecretkeymaterialXYZ");
  });

  it("redacts a Luhn-valid credit-card PAN", () => {
    // 4242 4242 4242 4242 is the canonical Luhn-valid test card.
    const out = redactSecrets("payment card 4242 4242 4242 4242 charged");
    expect(out).not.toContain("4242 4242 4242 4242");
    expect(out).toContain("[REDACTED_PAN]");
  });
});

describe("redactValue — sensitive key names (nested / prefixed)", () => {
  it("redacts string values under sensitive key names regardless of prefix or nesting", () => {
    const result = redactValue({
      dbPassword: "hunter2hunter2",
      githubToken: "tokvalue1234567",
      nested: { userApiKey: "keyvalue1234567" },
      note: "hello world"
    });
    const json = JSON.stringify(result.value);
    expect(json).not.toContain("hunter2hunter2");
    expect(json).not.toContain("tokvalue1234567");
    expect(json).not.toContain("keyvalue1234567");
    expect(json).toContain("hello world"); // ordinary field preserved (no over-redaction)
  });

  it("redacts the bare 'auth' and 'bearer' key names but not 'author'", () => {
    const result = redactValue({ auth: "Basic dXNlcjpwYXNz", bearer: "rawtokenvalue12345", author: "Jane Doe" });
    const json = JSON.stringify(result.value);
    expect(json).not.toContain("Basic dXNlcjpwYXNz");
    expect(json).not.toContain("rawtokenvalue12345");
    expect(json).toContain("Jane Doe"); // 'author' must NOT be over-redacted
  });
});
