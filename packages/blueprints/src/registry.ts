import { validateManifest } from "./validator.js";
import type { BlueprintManifest } from "./types.js";

export type RolloutStatus = "draft" | "pilot" | "stable" | "archived";
const ALLOWED_ROLLOUT_STATUSES = new Set<RolloutStatus>(["draft", "pilot", "stable", "archived"]);

export type PromoteResult =
  | { ok: true; manifest: BlueprintManifest }
  | { ok: false; error: string };

// Minimal interface the registry needs from the DB — keeps coupling low.
// @squidbot/db's SquidDatabase satisfies this structurally (no nominal typing required).
export interface BlueprintStore {
  saveBlueprint(
    input: { slug: string; name: string; manifest_json: string; status: string; current_version: string },
    actor: string
  ): string;
  getBlueprint(slug: string): Record<string, unknown> | null;
  listBlueprints(): Array<Record<string, unknown>>;
  deleteBlueprint(id: string): void;
  listBlueprintVersions(
    blueprintId: string
  ): Array<{ version: string; manifest_json: string; createdAt: string; createdBy: string }>;
}

export type InstallResult =
  | { ok: true; id: string; manifest: BlueprintManifest }
  | { ok: false; errors: string[] };

export class BlueprintRegistry {
  constructor(private readonly store: BlueprintStore) {}

  install(manifest: BlueprintManifest, actor: string): InstallResult {
    const v = validateManifest(manifest);
    if (!v.ok) return { ok: false, errors: v.errors };
    const id = this.store.saveBlueprint(
      {
        slug: manifest.slug,
        name: manifest.name,
        manifest_json: JSON.stringify(manifest),
        status: manifest.rollout.status,
        current_version: manifest.version
      },
      actor
    );
    return { ok: true, id, manifest };
  }

  uninstall(slug: string, _actor: string): void {
    const bp = this.store.getBlueprint(slug);
    if (!bp) return;
    this.store.deleteBlueprint(bp.id as string);
  }

  get(slug: string): BlueprintManifest | null {
    const row = this.store.getBlueprint(slug);
    if (!row) return null;
    return JSON.parse(row.manifest_json as string) as BlueprintManifest;
  }

  list(): BlueprintManifest[] {
    return this.store
      .listBlueprints()
      .map((row) => JSON.parse(row.manifest_json as string) as BlueprintManifest);
  }

  /**
   * Promote a blueprint to a new rollout status (draft → pilot → stable or
   * archived). Each promotion re-saves the manifest via the store so the
   * change is audited. This is the backend action the AI Studio deploy-control
   * tab invokes; it never auto-promotes to stable without an explicit operator
   * call (SquidBot's inspect-and-govern thesis).
   */
  promote(slug: string, targetStatus: RolloutStatus, actor: string): PromoteResult {
    if (!ALLOWED_ROLLOUT_STATUSES.has(targetStatus)) {
      return { ok: false, error: `Invalid rollout status: ${targetStatus}. Must be one of ${[...ALLOWED_ROLLOUT_STATUSES].join("|")}.` };
    }
    const manifest = this.get(slug);
    if (!manifest) {
      return { ok: false, error: `Blueprint not found: ${slug}` };
    }
    const updated: BlueprintManifest = {
      ...manifest,
      rollout: { ...manifest.rollout, status: targetStatus },
      updatedAt: new Date().toISOString(),
      updatedBy: actor
    };
    this.store.saveBlueprint(
      { slug, name: updated.name, manifest_json: JSON.stringify(updated), status: targetStatus, current_version: updated.version },
      actor
    );
    return { ok: true, manifest: updated };
  }

  versions(
    slug: string
  ): Array<{ version: string; manifest: BlueprintManifest; createdAt: string; createdBy: string }> {
    const bp = this.store.getBlueprint(slug);
    if (!bp) return [];
    const rows = this.store.listBlueprintVersions(bp.id as string);
    return rows.map((r) => ({
      version: r.version,
      manifest: JSON.parse(r.manifest_json) as BlueprintManifest,
      createdAt: r.createdAt,
      createdBy: r.createdBy
    }));
  }
}
