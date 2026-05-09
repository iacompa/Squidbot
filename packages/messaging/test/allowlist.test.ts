import { afterEach, describe, expect, it } from "vitest";
import type { SquidDatabase } from "@squidbot/db";
import { MessagingAllowlist, normalizeMessagingEvent } from "../src/index.js";
import { setupMessaging, tempDatabase } from "./helpers.js";

let db: SquidDatabase | null = null;

afterEach(() => db?.close());

describe("Messaging allowlist", () => {
  it("denies unknown users, allows listed users, and blocks explicit deny rules", () => {
    db = tempDatabase();
    const store = setupMessaging(db);
    const event = normalizeMessagingEvent({ platform: "slack", channel: "C1", user: "U1", text: "/squid run list files" }, "adapter_slack");
    expect(new MessagingAllowlist(store).evaluate(event).allowed).toBe(false);
    store.createAllowlistRule({ platform: "slack", externalUserId: "U1", ruleType: "allowUser", riskLimit: "medium" });
    expect(new MessagingAllowlist(store).evaluate(event, "medium").allowed).toBe(false);
    store.createAllowlistRule({ platform: "slack", externalChannelId: "C1", ruleType: "allowChannel", riskLimit: "medium" });
    expect(new MessagingAllowlist(store).evaluate(event, "medium").allowed).toBe(true);
    store.createAllowlistRule({ platform: "slack", externalUserId: "U1", ruleType: "blockUser" });
    expect(new MessagingAllowlist(store).evaluate(event).allowed).toBe(false);
  });
});
