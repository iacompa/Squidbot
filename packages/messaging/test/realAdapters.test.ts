import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscordAdapter } from "../src/discordAdapter.js";
import { TelegramAdapter } from "../src/telegramAdapter.js";
import type { MessagingAdapterManifest, MessagingPlatform } from "../src/types.js";

function manifest(platform: MessagingPlatform): MessagingAdapterManifest {
  return { id: `${platform}-1`, platform } as unknown as MessagingAdapterManifest;
}

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

function mockFetch(payload: unknown, status = 200): () => { url: string; init?: RequestInit } | null {
  let captured: { url: string; init?: RequestInit } | null = null;
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return () => captured;
}

describe("DiscordAdapter — real outbound", () => {
  it("POSTs the message to the channel-messages endpoint with Bot auth and returns the message id", async () => {
    const captured = mockFetch({ id: "987654321" });
    const adapter = new DiscordAdapter(manifest("discord"), "disc-token");

    const result = await adapter.send({ channelId: "chan-42" }, { text: "hello discord" });

    const req = captured()!;
    expect(req.url).toBe("https://discord.com/api/v10/channels/chan-42/messages");
    expect((req.init?.headers as Record<string, string>).Authorization).toBe("Bot disc-token");
    expect(JSON.parse(String(req.init?.body))).toMatchObject({ content: "hello discord" });
    expect(result.ok).toBe(true);
    expect(result.externalMessageId).toBe("987654321");
  });

  it("fails cleanly without a token (no network call)", async () => {
    const captured = mockFetch({ id: "x" });
    const adapter = new DiscordAdapter(manifest("discord"));
    const prevEnv = process.env.DISCORD_BOT_TOKEN;
    delete process.env.DISCORD_BOT_TOKEN;
    try {
      const result = await adapter.send({ channelId: "c" }, { text: "hi" });
      expect(result.ok).toBe(false);
      expect(captured()).toBeNull();
    } finally {
      if (prevEnv !== undefined) process.env.DISCORD_BOT_TOKEN = prevEnv;
    }
  });

  it("surfaces a Discord API error body", async () => {
    mockFetch({ message: "Missing Access", code: 50001 }, 403);
    const adapter = new DiscordAdapter(manifest("discord"), "t");
    const result = await adapter.send({ channelId: "c" }, { text: "hi" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Missing Access|403/);
  });
});

describe("TelegramAdapter — real outbound", () => {
  it("POSTs sendMessage with chat_id/text and returns the message id", async () => {
    const captured = mockFetch({ ok: true, result: { message_id: 4242 } });
    const adapter = new TelegramAdapter(manifest("telegram"), "123:ABC");

    const result = await adapter.send({ channelId: "chat-9" }, { text: "hello telegram" });

    const req = captured()!;
    expect(req.url).toBe("https://api.telegram.org/bot123:ABC/sendMessage");
    expect(JSON.parse(String(req.init?.body))).toMatchObject({ chat_id: "chat-9", text: "hello telegram" });
    expect(result.ok).toBe(true);
    expect(result.externalMessageId).toBe("4242");
  });

  it("returns the Telegram error description when ok:false", async () => {
    mockFetch({ ok: false, description: "chat not found" });
    const adapter = new TelegramAdapter(manifest("telegram"), "123:ABC");
    const result = await adapter.send({ channelId: "c" }, { text: "hi" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/chat not found/);
  });
});
