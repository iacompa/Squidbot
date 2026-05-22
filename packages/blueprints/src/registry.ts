import { validateManifest } from "./validator.js";
import type { BlueprintManifest } from "./types.js";

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
