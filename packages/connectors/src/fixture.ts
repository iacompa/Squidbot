import fs from "node:fs";
import { parseStructuredFile, type ConnectorEndpoint, type ConnectorManifest } from "./manifest.js";

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

  const raw = fs.readFileSync(manifest.fixtureData, "utf8");
  return parseStructuredFile(raw, manifest.fixtureData);
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
