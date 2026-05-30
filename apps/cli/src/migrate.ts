import type { SquidDatabase } from "@squidbot/db";

export type MigrationBundle = {
  schemaVersion: string;
  exportedAt: string;
  settings: Record<string, string | number | boolean | null>;
};

export type UpdateCheckResult =
  | { upToDate: true; current: string; latest: string }
  | { upToDate: false; current: string; latest: string }
  | { upToDate: null; current: string; latest?: string; error: string };

const SCHEMA_VERSION = "1";
const NPM_REGISTRY_URL = "https://registry.npmjs.org/@squidbot/cli";

/**
 * Export a portable migration bundle from a database. The bundle captures all
 * operator-set settings so an installation can be reproduced on a new machine
 * or after a re-install — without carrying the full SQLite file.
 */
export function exportMigrationBundle(database: SquidDatabase): MigrationBundle {
  const rawSettings = database.getAllSettings() as Record<string, unknown>;
  const settings: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(rawSettings)) {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      settings[key] = value;
    } else if (value !== undefined) {
      settings[key] = String(value);
    }
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings
  };
}

/**
 * Import a migration bundle into a database. By default (overwrite: true)
 * every setting in the bundle overwrites the destination — use overwrite:false
 * for an additive import that does not touch already-configured keys.
 */
export function importMigrationBundle(
  database: SquidDatabase,
  bundle: MigrationBundle,
  options: { overwrite?: boolean } = {}
): { imported: number; skipped: number } {
  const overwrite = options.overwrite !== false;
  let imported = 0;
  let skipped = 0;
  for (const [key, value] of Object.entries(bundle.settings)) {
    if (!overwrite && database.getSetting(key) !== null) {
      skipped += 1;
      continue;
    }
    if (value === null) {
      database.setSetting(key, null as never);
    } else {
      database.setSetting(key, value);
    }
    imported += 1;
  }
  return { imported, skipped };
}

/**
 * Check the npm registry for a newer version of SquidBot. Returns upToDate:null
 * (not a boolean) when the registry is unreachable so callers can treat the
 * check as advisory rather than blocking. Uses a 5-second timeout so a slow
 * network does not stall the CLI startup.
 */
export async function checkForUpdates(currentVersion: string): Promise<UpdateCheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(NPM_REGISTRY_URL, { signal: controller.signal });
    if (!response.ok) {
      return { upToDate: null, current: currentVersion, error: `registry responded ${response.status}` };
    }
    const data = (await response.json()) as { "dist-tags"?: { latest?: string } };
    const latest = data["dist-tags"]?.latest ?? "";
    if (!latest) {
      return { upToDate: null, current: currentVersion, error: "latest tag not found in registry response" };
    }
    return isNewerVersion(latest, currentVersion)
      ? { upToDate: false, current: currentVersion, latest }
      : { upToDate: true, current: currentVersion, latest };
  } catch (error) {
    return { upToDate: null, current: currentVersion, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}
