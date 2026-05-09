import { describe, expect, it } from "vitest";
import { getPlatformMatrixEntry, listPlatformMatrix } from "../src/index.js";

describe("Platform capability matrix", () => {
  it("contains broad target platforms and compliance notes for risky surfaces", () => {
    const platforms = listPlatformMatrix().map((entry) => entry.platform);
    for (const platform of ["slack", "discord", "telegram", "matrix", "email", "whatsapp", "teams", "imessage", "signal", "genericWebhook"]) {
      expect(platforms).toContain(platform);
    }
    expect(getPlatformMatrixEntry("whatsapp")?.complianceNotes.length).toBeGreaterThan(0);
  });
});
