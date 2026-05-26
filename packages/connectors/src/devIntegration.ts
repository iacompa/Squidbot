import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ConnectorManifest } from "./manifest.js";
import type { ConnectorRegistry } from "./registry.js";

const developerConnectorManifestRelativePaths = [
  "connectors/demo/githubConnector.json",
  "connectors/demo/gitlabConnector.json",
  "connectors/demo/jiraConnector.json",
  "connectors/demo/jenkinsConnector.json"
];

export function installDeveloperWorkflowConnectors(registry: ConnectorRegistry): ConnectorManifest[] {
  const installed: ConnectorManifest[] = [];

  for (const relativePath of developerConnectorManifestRelativePaths) {
    const manifestPath = resolveRepoFile(relativePath);
    const manifest = registry.loadManifest(manifestPath);
    // Shipped manifests are versioned through the JSON file — the file is
    // the source of truth. Always upsert so a fixtureMode flip or endpoint
    // update lands for existing installs without needing a migration.
    installed.push(registry.registerConnector(manifest));
  }

  return installed;
}

function resolveRepoFile(relativePath: string): string {
  const sourceDir = path.dirname(fileURLToPath(import.meta.url));
  const candidateRoots = [
    process.env.INIT_CWD,
    process.cwd(),
    path.resolve(process.cwd(), "../.."),
    path.resolve(sourceDir, "../../.."),
    path.resolve(sourceDir, "../../../.."),
    path.resolve(sourceDir, "../../../../..")
  ].filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);

  for (const root of candidateRoots) {
    const candidate = path.resolve(root, relativePath);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Bundled developer workflow connector manifest not found: ${relativePath}`);
}
