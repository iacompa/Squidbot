import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { verifySlackRequest } from "./webhookSecurity.js";

const MAX_BODY_BYTES = 512 * 1024;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Unwrap Slack Events API envelopes into normalizer-ready event objects. */
export function unwrapSlackWebhookPayloads(payload: unknown): unknown[] {
  const record = asRecord(payload);
  if (record.type === "url_verification") {
    return [];
  }
  if (record.type === "event_callback") {
    const event = asRecord(record.event);
    if (event.subtype === "bot_message" || event.bot_id) {
      return [];
    }
    if (event.type === "message" && event.subtype && !["file_share", "thread_broadcast"].includes(String(event.subtype))) {
      return [];
    }
    return [{ ...event, platform: "slack" }];
  }
  if (record.platform === "slack" || record.channel || record.user) {
    return [payload];
  }
  return [payload];
}

export type SlackWebhookServerOptions = {
  port: number;
  signingSecret: string;
  onPayload: (payload: unknown) => Promise<void>;
  logger?: (level: "info" | "warn" | "error", message: string, detail?: unknown) => void;
};

class BodyTooLargeError extends Error {
  constructor() {
    super("body too large");
    this.name = "BodyTooLargeError";
  }
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        request.destroy();
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function headerMap(request: IncomingMessage): Record<string, string | string[] | undefined> {
  return request.headers as Record<string, string | string[] | undefined>;
}

export function startSlackWebhookServer(options: SlackWebhookServerOptions): {
  server: http.Server;
  ready: Promise<{ url: string; port: number }>;
  close: () => Promise<void>;
} {
  if (!options.signingSecret || !options.signingSecret.trim()) {
    throw new Error("slackWebhookServer requires a non-empty signingSecret.");
  }
  const server = http.createServer((request, response) => {
    void handleRequest(request, response, options);
  });

  const ready = new Promise<{ url: string; port: number }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      resolve({ url: `http://127.0.0.1:${port}/slack/events`, port });
    });
  });

  return {
    server,
    ready,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: SlackWebhookServerOptions
): Promise<void> {
  const log = options.logger ?? ((level, message, detail) => {
    if (level === "error") {
      console.error(`[slackWebhook] ${message}`, detail ?? "");
    }
  });

  if (request.method !== "POST" || !request.url?.startsWith("/slack/events")) {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: "not found" }));
    return;
  }

  let body: string;
  try {
    body = await readBody(request);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      response.writeHead(413, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: "payload too large" }));
      return;
    }
    log("error", "failed to read request body", error);
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: "invalid request" }));
    return;
  }

  const verified = verifySlackRequest({
    headers: headerMap(request),
    body,
    signingSecret: options.signingSecret
  });
  if (!verified.ok) {
    response.writeHead(verified.status, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: verified.reason }));
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: "invalid json" }));
    return;
  }

  if (payload.type === "url_verification" && typeof payload.challenge === "string") {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end(payload.challenge);
    return;
  }

  try {
    await options.onPayload(payload);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  } catch (error) {
    log("error", "onPayload handler failed", error);
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: "internal error" }));
  }
}
