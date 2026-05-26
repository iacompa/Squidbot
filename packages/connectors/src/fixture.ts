import fs from "node:fs";
import path from "node:path";
import { parseStructuredFile, type ConnectorEndpoint, type ConnectorManifest } from "./manifest.js";

const ALLOWED_FIXTURE_EXTENSIONS = new Set([".json", ".yaml", ".yml"]);
const MAX_FIXTURE_BYTES = 10 * 1024 * 1024;

export function getFixtureResponse(manifest: ConnectorManifest, endpoint: ConnectorEndpoint): unknown {
  const fixtureData = loadFixtureData(manifest);

  if (fixtureData && typeof fixtureData === "object" && !Array.isArray(fixtureData)) {
    const record = fixtureData as Record<string, unknown>;
    if (record[endpoint.operationId] !== undefined) {
      return record[endpoint.operationId];
    }
    if (record[endpoint.path] !== undefined) {
      return record[endpoint.path];
    }
  }

  return dummyFromSchema(endpoint.outputSchema);
}

function loadFixtureData(manifest: ConnectorManifest): unknown {
  if (!manifest.fixtureData) {
    return null;
  }

  if (typeof manifest.fixtureData !== "string") {
    return manifest.fixtureData;
  }

  const fixturePath = path.resolve(manifest.fixtureData);
  if (!path.isAbsolute(fixturePath)) {
    throw new Error(`Connector ${manifest.name}: fixtureData path must be absolute after resolution.`);
  }

  const extension = path.extname(fixturePath).toLowerCase();
  if (!ALLOWED_FIXTURE_EXTENSIONS.has(extension)) {
    throw new Error(
      `Connector ${manifest.name}: fixtureData file extension ${extension || "(none)"} not allowed. Use .json, .yaml, or .yml.`
    );
  }

  const stat = fs.statSync(fixturePath);
  if (!stat.isFile()) {
    throw new Error(`Connector ${manifest.name}: fixtureData path is not a regular file: ${fixturePath}`);
  }
  if (stat.size > MAX_FIXTURE_BYTES) {
    throw new Error(`Connector ${manifest.name}: fixtureData file exceeds ${MAX_FIXTURE_BYTES} bytes.`);
  }

  const raw = fs.readFileSync(fixturePath, "utf8");
  return parseStructuredFile(raw, fixturePath);
}

function dummyFromSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") {
    return {};
  }

  const record = schema as Record<string, unknown>;
  if (record.example !== undefined) {
    return record.example;
  }

  if (record.type === "array") {
    return [dummyFromSchema(record.items)];
  }

  if (record.type === "object" || record.properties) {
    const properties = record.properties && typeof record.properties === "object" ? (record.properties as Record<string, unknown>) : {};
    return Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, dummyFromSchema(value)]));
  }

  if (record.type === "number" || record.type === "integer") {
    return 0;
  }

  if (record.type === "boolean") {
    return false;
  }

  return "";
}
