import { describe, expect, it } from "vitest";
import {
  isPrivateOrLoopbackHostname,
  validateModelAccountApiUrl,
  validateProviderApiUrl
} from "./urlGuards";

describe("isPrivateOrLoopbackHostname", () => {
  it.each([
    ["localhost", true],
    ["127.0.0.1", true],
    ["127.1.2.3", true],
    ["0.0.0.0", true],
    ["::1", true],
    ["10.0.0.1", true],
    ["10.255.255.255", true],
    ["192.168.1.100", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["169.254.169.254", true],
    ["fe80::1", true],
    ["fd00::1", true],
    ["fc00::1", true],
    ["api.openai.com", false],
    ["api.anthropic.com", false],
    ["8.8.8.8", false],
    ["172.15.0.1", false],
    ["172.32.0.1", false]
  ])("classifies %s as private=%s", (host, expected) => {
    expect(isPrivateOrLoopbackHostname(host)).toBe(expected);
  });
});

describe("validateProviderApiUrl", () => {
  it("accepts https URLs to public hosts", () => {
    expect(validateProviderApiUrl("https://api.openai.com/v1/chat/completions")).toBeNull();
    expect(validateProviderApiUrl("https://openrouter.ai/api/v1/chat/completions")).toBeNull();
  });

  it("rejects empty or non-string input", () => {
    expect(validateProviderApiUrl("")).toContain("required");
    // @ts-expect-error — testing runtime non-string input
    expect(validateProviderApiUrl(null)).toContain("required");
  });

  it("rejects malformed URLs", () => {
    expect(validateProviderApiUrl("not-a-url")).toContain("Invalid");
  });

  it("rejects non-https schemes (Bearer token would travel in clear)", () => {
    expect(validateProviderApiUrl("http://api.openai.com/v1")).toContain("https");
    expect(validateProviderApiUrl("ftp://api.example.com")).toContain("https");
    expect(validateProviderApiUrl("file:///etc/passwd")).toContain("https");
  });

  it("rejects AWS IMDS exfiltration target", () => {
    const error = validateProviderApiUrl("https://169.254.169.254/latest/meta-data/iam/security-credentials/");
    expect(error).toContain("private/loopback");
  });

  it("rejects internal Kubernetes/Docker addresses", () => {
    expect(validateProviderApiUrl("https://10.0.0.5/v1")).toContain("private/loopback");
    expect(validateProviderApiUrl("https://192.168.1.1/v1")).toContain("private/loopback");
    expect(validateProviderApiUrl("https://localhost:6379/v1")).toContain("private/loopback");
  });
});

describe("validateModelAccountApiUrl (looser http-allowed variant)", () => {
  it("returns null for empty string (caller handles empty at higher layer)", () => {
    expect(validateModelAccountApiUrl("")).toBeNull();
  });

  it("accepts https public hosts", () => {
    expect(validateModelAccountApiUrl("https://api.openai.com/v1")).toBeNull();
  });

  it("accepts http public hosts (intentional gateway use)", () => {
    expect(validateModelAccountApiUrl("http://api.example.com/v1")).toBeNull();
  });

  it("rejects malformed URLs", () => {
    expect(validateModelAccountApiUrl("not-a-url")).toContain("Invalid");
  });

  it("rejects non-http(s) protocols", () => {
    expect(validateModelAccountApiUrl("ftp://api.example.com")).toContain("http or https");
    expect(validateModelAccountApiUrl("file:///etc/passwd")).toContain("http or https");
  });

  it("rejects private/loopback hosts even over http", () => {
    expect(validateModelAccountApiUrl("http://localhost:11434/v1")).toContain("private/loopback");
    expect(validateModelAccountApiUrl("http://127.0.0.1/v1")).toContain("private/loopback");
    expect(validateModelAccountApiUrl("http://169.254.169.254/")).toContain("private/loopback");
    expect(validateModelAccountApiUrl("https://10.0.0.5/v1")).toContain("private/loopback");
  });
});
