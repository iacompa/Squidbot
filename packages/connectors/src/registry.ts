import type { SquidDatabase } from "@squidbot/db";
import { createId } from "@squidbot/core";
import { loadConnectorManifestFile, validateConnectorManifest, type ConnectorManifest } from "./manifest.js";

export class ConnectorRegistry {
  private readonly connectors = new Map<string, ConnectorManifest>();

  constructor(private readonly database?: SquidDatabase) {
    if (database) {
      for (const record of database.listConnectors()) {
        this.connectors.set(record.name, validateConnectorManifest(record.manifest));
      }
    }
  }

  loadManifest(filePath: string): ConnectorManifest {
    return loadConnectorManifestFile(filePath);
  }

  registerConnector(manifest: ConnectorManifest): ConnectorManifest {
    const validated = validateConnectorManifest(manifest);
    this.connectors.set(validated.name, validated);

    if (this.database) {
      this.database.saveConnector({
        id: createId("connector"),
        name: validated.name,
        manifest: validated,
        createdAt: new Date().toISOString()
      });
    }

    return validated;
  }

  installManifest(filePath: string): ConnectorManifest {
    return this.registerConnector(this.loadManifest(filePath));
  }

  getConnector(name: string): ConnectorManifest | null {
    return this.connectors.get(name) ?? null;
  }

  listConnectors(): ConnectorManifest[] {
    return [...this.connectors.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
