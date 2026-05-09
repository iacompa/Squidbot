import path from "node:path";
import type { SquidDatabase } from "@squidbot/db";
import { loadDatasetManifest, validateDatasetManifest } from "./datasetManifest.js";
import { EvalResultStore } from "./resultStore.js";
import type { EvalDatasetManifest, EvalDatasetRecord } from "./types.js";

export class DatasetRegistry {
  private readonly store: EvalResultStore;

  constructor(private readonly database: SquidDatabase) {
    this.store = new EvalResultStore(database);
  }

  validate(targetPath: string): EvalDatasetManifest {
    return loadDatasetManifest(path.resolve(targetPath));
  }

  install(targetPath: string): EvalDatasetRecord {
    const resolved = path.resolve(targetPath);
    const manifest = loadDatasetManifest(resolved);
    const dataset = this.store.upsertDataset({ manifest, sourcePath: resolved });
    this.database.appendEvent({
      id: `evt_eval_dataset_${dataset.id}_${Date.now()}`,
      timestamp: new Date().toISOString(),
      sessionId: "session_eval_admin",
      type: "eval.dataset.installed",
      data: {
        runId: dataset.id,
        datasetId: dataset.id,
        domain: dataset.domain,
        version: dataset.version,
        sourcePath: resolved
      }
    });
    return dataset;
  }

  list(): EvalDatasetRecord[] {
    return this.store.listDatasets();
  }

  get(datasetId: string): EvalDatasetRecord | null {
    return this.store.getDataset(datasetId);
  }

  ensureInstalledFromManifest(manifest: EvalDatasetManifest, sourcePath: string): EvalDatasetRecord {
    return this.store.upsertDataset({ manifest: validateDatasetManifest(manifest, sourcePath), sourcePath });
  }
}
