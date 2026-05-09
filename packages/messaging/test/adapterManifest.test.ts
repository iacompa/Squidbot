import { describe, expect, it } from "vitest";
import { createFixtureManifest, validateMessagingAdapterManifest } from "../src/index.js";

describe("Messaging adapter manifest validation", () => {
  it("accepts safe fixture adapters", () => {
    const manifest = createFixtureManifest({
      id: "adapter_test",
      name: "Test",
      platform: "slack",
      description: "Test fixture adapter",
      capabilities: { buttons: true, slashCommands: true }
    });
    expect(validateMessagingAdapterManifest(manifest).id).toBe("adapter_test");
  });

  it("rejects unsafe real-network defaults and missing compliance notes", () => {
    const manifest = createFixtureManifest({
      id: "adapter_wa",
      name: "WhatsApp",
      platform: "whatsapp",
      description: "WhatsApp fixture",
      complianceNotes: ["Official Business Platform only"]
    });
    expect(() => validateMessagingAdapterManifest({ ...manifest, transport: { ...manifest.transport, realNetworkDefault: true } })).toThrow(/realNetworkDefault/);
    expect(() => validateMessagingAdapterManifest({ ...manifest, complianceNotes: [] })).toThrow(/compliance notes/);
  });
});
