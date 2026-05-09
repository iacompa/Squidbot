import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyDiscordInteraction, verifySlackRequest } from "../src/index.js";

describe("Webhook signature verification", () => {
  it("verifies Slack signatures and rejects missing, stale, and modified requests", () => {
    const body = "token=ignored&team_id=T123&text=/squid status";
    const signingSecret = "fake-slack-signing-secret";
    const timestamp = "1700000000";
    const signature = `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${body}`).digest("hex")}`;

    expect(
      verifySlackRequest({
        headers: {
          "X-Slack-Request-Timestamp": timestamp,
          "X-Slack-Signature": signature
        },
        body,
        signingSecret,
        nowSeconds: 1700000001
      }).ok
    ).toBe(true);

    expect(verifySlackRequest({ headers: {}, body, signingSecret, nowSeconds: 1700000001 }).status).toBe(401);
    expect(
      verifySlackRequest({
        headers: {
          "x-slack-request-timestamp": "1699990000",
          "x-slack-signature": signature
        },
        body,
        signingSecret,
        nowSeconds: 1700000001
      }).reason
    ).toMatch(/stale/);
    expect(
      verifySlackRequest({
        headers: {
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": signature
        },
        body: `${body}&extra=tampered`,
        signingSecret,
        nowSeconds: 1700000001
      }).status
    ).toBe(401);
  });

  it("verifies Discord Ed25519 signatures and rejects missing or modified interactions", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const body = JSON.stringify({ type: 1 });
    const timestamp = "1700000000";
    const signature = sign(null, Buffer.from(`${timestamp}${body}`), privateKey).toString("hex");
    const publicPem = publicKey.export({ format: "pem", type: "spki" }).toString();

    expect(
      verifyDiscordInteraction({
        headers: {
          "X-Signature-Timestamp": timestamp,
          "X-Signature-Ed25519": signature
        },
        body,
        publicKey: publicPem
      })
    ).toEqual({ ok: true, status: 200 });

    expect(verifyDiscordInteraction({ headers: {}, body, publicKey: publicPem }).status).toBe(401);
    expect(
      verifyDiscordInteraction({
        headers: {
          "x-signature-timestamp": timestamp,
          "x-signature-ed25519": signature
        },
        body: JSON.stringify({ type: 2 }),
        publicKey: publicPem
      }).reason
    ).toMatch(/invalid Discord signature/);
  });
});
