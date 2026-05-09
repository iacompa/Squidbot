import fs from "node:fs";
import { validateMessagingAdapterManifest } from "./adapterManifest.js";
import { createDefaultMessagingManifests } from "./defaultAdapters.js";
import type { MessagingStore } from "./store.js";
import type { MessagingAdapterManifest, MessagingAdapterRecord } from "./types.js";

export class MessagingAdapterRegistry {
  constructor(private readonly store: MessagingStore) {}

  installDefaults(): MessagingAdapterRecord[] {
    return createDefaultMessagingManifests().map((manifest) => {
      const existing = this.store.getAdapter(manifest.id);
      return this.store.saveAdapter(manifest, existing?.status ?? "installed");
    });
  }

  install(manifest: MessagingAdapterManifest): MessagingAdapterRecord {
    return this.store.saveAdapter(validateMessagingAdapterManifest(manifest));
  }

  installFromFile(filePath: string): MessagingAdapterRecord {
    const manifest = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    return this.install(validateMessagingAdapterManifest(manifest));
  }

  list(includeArchived = false): MessagingAdapterRecord[] {
    return this.store.listAdapters(includeArchived);
  }

  get(adapterId: string): MessagingAdapterRecord | null {
    return this.store.getAdapter(adapterId);
  }

  enable(adapterId: string): MessagingAdapterRecord {
    return this.store.updateAdapterStatus(adapterId, "installed");
  }

  disable(adapterId: string): MessagingAdapterRecord {
    return this.store.updateAdapterStatus(adapterId, "disabled");
  }
}
