import type { PluginHost, PluginRegisterContext, PluginToolDefinition, SquidbotPlugin } from "./types.js";
import { validatePluginManifest } from "./validator.js";

export type PluginLoadResult =
  | { ok: true; id: string; registeredTools: string[] }
  | { ok: false; errors: string[] };

/**
 * Load a plugin into a host, enforcing the **manifest contract**: a plugin may
 * only register tools whose names it declared in `contributes.tools`. This is
 * the governance guarantee of the plugin system — installing a plugin grants
 * *exactly* what its (reviewable) manifest says, no more.
 *
 * Loading is atomic. Registrations are buffered while `register` runs; if the
 * manifest is invalid, the hook throws, or it attempts an undeclared tool, the
 * load fails and the host receives NOTHING — a half-loaded plugin (some tools
 * live, others rejected) is a worse state than a cleanly rejected one.
 */
export async function loadPlugin(plugin: SquidbotPlugin, host: PluginHost): Promise<PluginLoadResult> {
  const validation = validatePluginManifest(plugin.manifest);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }
  const manifest = validation.manifest;
  const declaredTools = new Set(manifest.contributes.tools ?? []);
  const buffered: PluginToolDefinition[] = [];
  const errors: string[] = [];

  const context: PluginRegisterContext = {
    manifest,
    registerTool(tool: PluginToolDefinition) {
      if (!declaredTools.has(tool.name)) {
        errors.push(
          `Plugin ${manifest.id} attempted to register undeclared tool "${tool.name}" — not listed in contributes.tools.`
        );
        return;
      }
      if (buffered.some((existing) => existing.name === tool.name)) {
        errors.push(`Plugin ${manifest.id} registered tool "${tool.name}" twice.`);
        return;
      }
      buffered.push(tool);
    }
  };

  try {
    await plugin.register?.(context);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // All declared and validated — commit to the host now (atomic flush).
  for (const tool of buffered) {
    host.registerTool(tool);
  }
  return { ok: true, id: manifest.id, registeredTools: buffered.map((tool) => tool.name) };
}
