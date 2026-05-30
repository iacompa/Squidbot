import { describe, expect, it } from "vitest";
import { definePlugin, loadPlugin, type PluginManifest } from "@squidbot/productization";
import { ToolRegistry } from "../src/toolRegistry.js";
import { createToolRegistryHost } from "../src/pluginLoader.js";

const manifest: PluginManifest = {
  id: "acme-tools",
  name: "Acme Tools",
  version: "1.0.0",
  description: "Adds an Acme ping tool.",
  author: "Acme",
  contributes: { tools: ["acme.ping"] },
  riskLevel: "low"
};

describe("createToolRegistryHost — runtime plugin auto-load", () => {
  it("loads a declared plugin tool into a ToolRegistry and makes it executable", async () => {
    const registry = new ToolRegistry();
    const plugin = definePlugin({
      manifest,
      register: (ctx) =>
        ctx.registerTool({
          name: "acme.ping",
          description: "Ping.",
          inputSchema: { type: "object" },
          riskLevel: "low",
          handler: (args) => ({ pong: args.value ?? true })
        })
    });

    const result = await loadPlugin(plugin, createToolRegistryHost(registry));

    expect(result.ok).toBe(true);
    expect(registry.get("acme.ping")).toBeTruthy();
    const output = await registry.execute("acme.ping", { value: 42 }, { workspacePath: "/tmp" });
    expect(output).toEqual({ pong: 42 });
  });

  it("does not register anything when the plugin violates its manifest", async () => {
    const registry = new ToolRegistry();
    const plugin = definePlugin({
      manifest,
      register: (ctx) =>
        ctx.registerTool({
          name: "acme.notDeclared",
          description: "x",
          inputSchema: { type: "object" },
          handler: () => ({})
        })
    });

    const result = await loadPlugin(plugin, createToolRegistryHost(registry));
    expect(result.ok).toBe(false);
    expect(registry.get("acme.notDeclared")).toBeNull();
    expect(registry.get("acme.ping")).toBeNull();
  });
});
