import { describe, expect, it, vi } from "vitest";
import { definePlugin, loadPlugin, type PluginHost, type PluginManifest, type PluginToolDefinition } from "../src/index.js";

function collectingHost(): { host: PluginHost; tools: PluginToolDefinition[] } {
  const tools: PluginToolDefinition[] = [];
  return { host: { registerTool: (tool) => tools.push(tool) }, tools };
}

const manifest = (contributes: PluginManifest["contributes"]): PluginManifest => ({
  id: "acme-orders",
  name: "Acme Orders",
  version: "1.0.0",
  description: "Adds Acme order tools.",
  author: "Acme",
  contributes,
  permissions: ["connector.read"],
  riskLevel: "low"
});

const tool = (name: string): PluginToolDefinition => ({
  name,
  description: `${name} tool`,
  inputSchema: { type: "object" },
  handler: () => ({ ok: true })
});

describe("loadPlugin — governed plugin loading", () => {
  it("registers a tool the manifest declares", async () => {
    const { host, tools } = collectingHost();
    const plugin = definePlugin({
      manifest: manifest({ tools: ["acme.listOrders"] }),
      register: (ctx) => ctx.registerTool(tool("acme.listOrders"))
    });

    const result = await loadPlugin(plugin, host);
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.registeredTools).toEqual(["acme.listOrders"]);
    expect(tools.map((t) => t.name)).toEqual(["acme.listOrders"]);
  });

  it("rejects a tool the manifest did NOT declare and registers nothing (atomic, manifest-contract enforced)", async () => {
    const { host, tools } = collectingHost();
    const plugin = definePlugin({
      manifest: manifest({ tools: ["acme.listOrders"] }),
      register: (ctx) => {
        ctx.registerTool(tool("acme.listOrders")); // declared
        ctx.registerTool(tool("acme.deleteEverything")); // NOT declared
      }
    });

    const result = await loadPlugin(plugin, host);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(" ")).toMatch(/undeclared|deleteEverything/i);
    // Atomic: because the load failed, the host received NOTHING — not even the
    // valid tool. A partially-loaded plugin is worse than a rejected one.
    expect(tools).toHaveLength(0);
  });

  it("fails closed on an invalid manifest and never calls register", async () => {
    const { host, tools } = collectingHost();
    const register = vi.fn();
    const plugin = { manifest: { id: "Bad Id!", name: "x" } as unknown as PluginManifest, register };

    const result = await loadPlugin(plugin, host);
    expect(result.ok).toBe(false);
    expect(register).not.toHaveBeenCalled();
    expect(tools).toHaveLength(0);
  });

  it("accepts a plugin with no register hook", async () => {
    const { host } = collectingHost();
    const result = await loadPlugin(definePlugin({ manifest: manifest({ skills: ["acme.skill"] }) }), host);
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.registeredTools).toEqual([]);
  });

  it("captures an error thrown inside register and registers nothing", async () => {
    const { host, tools } = collectingHost();
    const plugin = definePlugin({
      manifest: manifest({ tools: ["acme.listOrders"] }),
      register: () => {
        throw new Error("register blew up");
      }
    });

    const result = await loadPlugin(plugin, host);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(" ")).toMatch(/blew up/);
    expect(tools).toHaveLength(0);
  });
});
