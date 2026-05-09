import { afterEach, describe, expect, it } from "vitest";
import type { SquidDatabase } from "@squidbot/db";
import { AttachmentStore } from "../src/index.js";
import { setupMessaging, tempDatabase } from "./helpers.js";

let db: SquidDatabase | null = null;

afterEach(() => db?.close());

describe("Attachment handling", () => {
  it("stores safe metadata and blocks dangerous extensions", () => {
    db = tempDatabase();
    const store = setupMessaging(db);
    const event = store.recordOutboundEvent({ adapterId: "adapter_slack", platform: "slack", message: { text: "attachment test" } });
    const results = new AttachmentStore(store).ingest(event, [
      { id: "safe", filename: "notes.txt", sizeBytes: 10 },
      { id: "bad", filename: "run.sh", sizeBytes: 10 },
      { id: "traversal", filename: "../../evil.txt", sizeBytes: 10 },
      { id: "huge", filename: "huge.txt", sizeBytes: 11 * 1024 * 1024 }
    ]);
    expect(results.map((result) => result.status)).toEqual(["safe", "blocked", "safe", "blocked"]);
    expect(results[2].attachment.filename).toBe(".._.._evil.txt");
  });
});
