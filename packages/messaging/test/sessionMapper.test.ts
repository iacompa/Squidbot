import { afterEach, describe, expect, it } from "vitest";
import type { SquidDatabase } from "@squidbot/db";
import { normalizeMessagingEvent, SessionMapper } from "../src/index.js";
import { setupMessaging, tempDatabase } from "./helpers.js";

let db: SquidDatabase | null = null;

afterEach(() => db?.close());

describe("Messaging session mapping", () => {
  it("creates and reuses channel/thread sessions", () => {
    db = tempDatabase();
    const store = setupMessaging(db);
    const mapper = new SessionMapper(store);
    const first = mapper.map(normalizeMessagingEvent({ platform: "slack", channel: "C1", user: "U1", thread_ts: "T1", text: "hello" }, "adapter_slack"));
    const second = mapper.map(normalizeMessagingEvent({ platform: "slack", channel: "C1", user: "U1", thread_ts: "T1", text: "again" }, "adapter_slack"));
    expect(first.channel.id).toBe(second.channel.id);
    expect(first.session.id).toBe(second.session.id);
  });
});
