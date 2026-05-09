import { createHmac, createPublicKey, timingSafeEqual, verify as verifySignature } from "node:crypto";

export type WebhookVerificationResult = {
  ok: boolean;
  status: 200 | 401;
  reason?: string;
};

type HeaderMap = Record<string, string | string[] | undefined>;

function header(headers: HeaderMap, name: string): string | undefined {
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== expected) {
      continue;
    }
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }
  return undefined;
}

function unauthorized(reason: string): WebhookVerificationResult {
  return { ok: false, status: 401, reason };
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function verifySlackRequest(args: {
  headers: HeaderMap;
  body: string;
  signingSecret: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): WebhookVerificationResult {
  const timestamp = header(args.headers, "x-slack-request-timestamp");
  const signature = header(args.headers, "x-slack-signature");
  if (!timestamp || !signature) {
    return unauthorized("missing Slack signature headers");
  }

  const parsedTimestamp = Number(timestamp);
  if (!Number.isFinite(parsedTimestamp)) {
    return unauthorized("invalid Slack timestamp");
  }

  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = args.toleranceSeconds ?? 300;
  if (Math.abs(now - parsedTimestamp) > tolerance) {
    return unauthorized("stale Slack request timestamp");
  }

  const base = `v0:${timestamp}:${args.body}`;
  const expected = `v0=${createHmac("sha256", args.signingSecret).update(base).digest("hex")}`;
  if (!safeEqual(signature, expected)) {
    return unauthorized("invalid Slack signature");
  }
  return { ok: true, status: 200 };
}

function discordPublicKey(publicKey: string | Buffer) {
  if (Buffer.isBuffer(publicKey)) {
    const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
    return createPublicKey({ key: Buffer.concat([spkiPrefix, publicKey]), format: "der", type: "spki" });
  }
  if (publicKey.includes("BEGIN PUBLIC KEY")) {
    return createPublicKey(publicKey);
  }
  const raw = Buffer.from(publicKey, "hex");
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  return createPublicKey({ key: Buffer.concat([spkiPrefix, raw]), format: "der", type: "spki" });
}

export function verifyDiscordInteraction(args: {
  headers: HeaderMap;
  body: string;
  publicKey: string | Buffer;
}): WebhookVerificationResult {
  const timestamp = header(args.headers, "x-signature-timestamp");
  const signature = header(args.headers, "x-signature-ed25519");
  if (!timestamp || !signature) {
    return unauthorized("missing Discord signature headers");
  }

  try {
    const ok = verifySignature(
      null,
      Buffer.from(`${timestamp}${args.body}`),
      discordPublicKey(args.publicKey),
      Buffer.from(signature, "hex")
    );
    return ok ? { ok: true, status: 200 } : unauthorized("invalid Discord signature");
  } catch {
    return unauthorized("invalid Discord signature");
  }
}
