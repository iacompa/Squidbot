import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { startSlackWebhookServer, unwrapSlackWebhookPayloads } from "../src/slackWebhookServer.js";

const SIGNING_SECRET = "test-signing-secret";

function signSlackRequest(body: string, secret: string = SIGNING_SECRET): { signature: string; timestamp: string } {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  return { signature, timestamp };
}

describe("slackWebhookServer", () => {
  it("unwraps Slack event_callback envelopes and ignores bot messages", () => {
    const payloads = unwrapSlackWebhookPayloads({
      type: "event_callback",
      event: {
        type: "message",
        channel: "C123",
        user: "U123",
        text: "hello",
        ts: "1.0"
      }
    });
    expect(payloads).toHaveLength(1);
    expect((payloads[0] as Record<string, unknown>).text).toBe("hello");

    const ignored = unwrapSlackWebhookPayloads({
      type: "event_callback",
      event: { type: "message", subtype: "bot_message", bot_id: "B123", text: "bot" }
    });
    expect(ignored).toHaveLength(0);
  });

  it("refuses to start without a signing secret", () => {
    expect(() =>
      startSlackWebhookServer({
        port: 0,
        signingSecret: "",
        onPayload: async () => {}
      })
    ).toThrow(/signingSecret/);
  });

  it("rejects unsigned requests", async () => {
    const { ready, close } = startSlackWebhookServer({
      port: 0,
      signingSecret: SIGNING_SECRET,
      onPayload: async () => {}
    });
    const { port } = await ready;
    const response = await fetch(`http://127.0.0.1:${port}/slack/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "url_verification", challenge: "x" })
    });
    expect(response.status).toBe(401);
    await close();
  });

  it("rejects oversized requests", async () => {
    const { ready, close } = startSlackWebhookServer({
      port: 0,
      signingSecret: SIGNING_SECRET,
      onPayload: async () => {}
    });
    const { port } = await ready;
    const oversized = "x".repeat(600 * 1024);
    const { signature, timestamp } = signSlackRequest(oversized);
    let aborted = false;
    let status = 0;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/slack/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-slack-signature": signature,
          "x-slack-request-timestamp": timestamp
        },
        body: oversized
      });
      status = response.status;
    } catch (error) {
      // Server destroys the socket mid-upload — fetch surfaces this as ECONNRESET.
      aborted = true;
    }
    expect(aborted || status === 413).toBe(true);
    await close();
  });

  it("returns generic error and does not leak handler exception text", async () => {
    const { ready, close } = startSlackWebhookServer({
      port: 0,
      signingSecret: SIGNING_SECRET,
      logger: () => {},
      onPayload: async () => {
        throw new Error("internal-secret-detail-/path/to/db");
      }
    });
    const { port } = await ready;
    const body = JSON.stringify({ type: "event_callback", event: { type: "message" } });
    const { signature, timestamp } = signSlackRequest(body);
    const response = await fetch(`http://127.0.0.1:${port}/slack/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-slack-signature": signature,
        "x-slack-request-timestamp": timestamp
      },
      body
    });
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("internal-secret-detail");
    expect(text).not.toContain("/path/to/db");
    await close();
  });

  it("handles url_verification and ingests events when properly signed", async () => {
    const received: unknown[] = [];
    const { ready, close } = startSlackWebhookServer({
      port: 0,
      signingSecret: SIGNING_SECRET,
      onPayload: async (payload) => {
        received.push(...unwrapSlackWebhookPayloads(payload));
      }
    });
    const { port } = await ready;
    const base = `http://127.0.0.1:${port}/slack/events`;

    const challengeBody = JSON.stringify({ type: "url_verification", challenge: "challenge-token" });
    const challengeSig = signSlackRequest(challengeBody);
    const challengeResponse = await fetch(base, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-slack-signature": challengeSig.signature,
        "x-slack-request-timestamp": challengeSig.timestamp
      },
      body: challengeBody
    });
    expect(await challengeResponse.text()).toBe("challenge-token");

    const eventBody = JSON.stringify({
      type: "event_callback",
      event: { type: "message", channel: "C1", user: "U1", text: "ping", ts: "2.0" }
    });
    const eventSig = signSlackRequest(eventBody);
    await fetch(base, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-slack-signature": eventSig.signature,
        "x-slack-request-timestamp": eventSig.timestamp
      },
      body: eventBody
    });

    await close();
    expect(received).toHaveLength(1);
    expect((received[0] as Record<string, unknown>).text).toBe("ping");
  });
});
