import { afterEach, describe, expect, it } from "vitest";
import type { SquidDatabase } from "@squidbot/db";
import { DeliveryRouter } from "../src/index.js";
import { setupMessaging, tempDatabase } from "./helpers.js";

let db: SquidDatabase | null = null;

afterEach(() => db?.close());

describe("Delivery router", () => {
  it("delivers run summaries through enabled fixture rules", () => {
    db = tempDatabase();
    const store = setupMessaging(db);
    const channel = store.createChannel({ adapterId: "adapter_slack", platform: "slack", externalChannelId: "C1" });
    const router = new DeliveryRouter(store);
    router.addRule({ name: "Run summaries", triggerType: "runSummary", targetChannelId: channel.id });
    expect(router.deliverToRules("runSummary", { text: "Run complete", runId: "run_1" })[0]?.ok).toBe(true);
    expect(store.listEvents({ platform: "slack" })).toHaveLength(1);
    const rule = router.listRules("runSummary")[0];
    router.setRuleEnabled(rule.id, false);
    expect(router.deliverToRules("runSummary", { text: "Run complete again", runId: "run_2" })).toHaveLength(0);
    router.setRuleEnabled(rule.id, true);
    store.updateChannelStatus(channel.id, "disabled");
    const failed = router.deliverToRules("runSummary", { text: "Run complete while disabled", runId: "run_3" })[0];
    expect(failed?.ok).toBe(false);
    expect(failed?.error).toMatch(/disabled/);
  });
});
