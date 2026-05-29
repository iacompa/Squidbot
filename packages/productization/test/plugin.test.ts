import { describe, expect, it } from "vitest";
import { definePlugin, PluginRegistry, validatePluginManifest, type PluginManifest } from "../src/index.js";

const goodManifest: PluginManifest = {
  id: "acme-orders",
  name: "Acme Orders",
  version: "1.0.0",
  description: "Adds Acme order-management tools and a connector.",
  author: "Acme",
  contributes: { tools: ["connector.acme.listOrders"], connectors: ["acme"] },
  permissions: ["connector.read"],
  riskLevel: "low"
};

describe("validatePluginManifest", () => {
  it("accepts a well-formed manifest", () => {
    const result = validatePluginManifest(goodManifest);
    expect(result.ok).toBe(true);
  });

  it("collects every problem (bad id, bad version, no contributions, bad risk)", () => {
    const result = validatePluginManifest({
      id: "Acme Orders!",
      name: "Acme",
      version: "v1",
      description: "x",
      author: "Acme",
      contributes: {},
      riskLevel: "extreme"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const joined = result.errors.join(" | ");
      expect(joined).toMatch(/id must match/);
      expect(joined).toMatch(/version must be semver/);
      expect(joined).toMatch(/at least one/);
      expect(joined).toMatch(/riskLevel/);
    }
  });

  it("rejects a non-object manifest", () => {
    expect(validatePluginManifest("nope").ok).toBe(false);
    expect(validatePluginManifest(null).ok).toBe(false);
  });
});

describe("PluginRegistry", () => {
  it("installs, lists, gets, and uninstalls a valid plugin", () => {
    const registry = new PluginRegistry();
    const installed = registry.install(goodManifest);
    expect(installed.ok).toBe(true);
    expect(registry.list().map((p) => p.id)).toEqual(["acme-orders"]);
    expect(registry.get("acme-orders")?.name).toBe("Acme Orders");
    expect(registry.requiredPermissions()).toEqual(["connector.read"]);
    expect(registry.uninstall("acme-orders")).toBe(true);
    expect(registry.list()).toEqual([]);
  });

  it("rejects an invalid manifest without installing it", () => {
    const registry = new PluginRegistry();
    const result = registry.install({ id: "x", name: "x" });
    expect(result.ok).toBe(false);
    expect(registry.list()).toEqual([]);
  });

  it("rejects a duplicate plugin id", () => {
    const registry = new PluginRegistry();
    registry.install(goodManifest);
    const second = registry.install(goodManifest);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.errors[0]).toMatch(/already installed/);
    }
    expect(registry.list()).toHaveLength(1);
  });

  it("definePlugin returns a typed plugin with its manifest", () => {
    const plugin = definePlugin({ manifest: goodManifest, register: () => undefined });
    expect(plugin.manifest.id).toBe("acme-orders");
  });
});
