import type { PluginManifest } from "./types.js";
import { validatePluginManifest } from "./validator.js";

export type PluginInstallResult =
  | { ok: true; id: string; manifest: PluginManifest }
  | { ok: false; errors: string[] };

/**
 * In-memory registry of installed plugins. Install validates the manifest and
 * rejects duplicates; a future revision can persist to SQLite behind the same
 * interface (mirroring BlueprintRegistry) without changing callers.
 */
export class PluginRegistry {
  private readonly plugins = new Map<string, PluginManifest>();

  install(manifest: unknown): PluginInstallResult {
    const result = validatePluginManifest(manifest);
    if (!result.ok) {
      return { ok: false, errors: result.errors };
    }
    if (this.plugins.has(result.manifest.id)) {
      return { ok: false, errors: [`Plugin already installed: ${result.manifest.id}`] };
    }
    this.plugins.set(result.manifest.id, result.manifest);
    return { ok: true, id: result.manifest.id, manifest: result.manifest };
  }

  get(id: string): PluginManifest | null {
    return this.plugins.get(id) ?? null;
  }

  list(): PluginManifest[] {
    return [...this.plugins.values()];
  }

  uninstall(id: string): boolean {
    return this.plugins.delete(id);
  }

  /** All permission scopes required across installed plugins (for an admin review surface). */
  requiredPermissions(): string[] {
    const scopes = new Set<string>();
    for (const plugin of this.plugins.values()) {
      for (const scope of plugin.permissions ?? []) {
        scopes.add(scope);
      }
    }
    return [...scopes].sort();
  }
}
