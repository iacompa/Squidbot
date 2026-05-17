import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { JsonObject, RiskLevel } from "@squidbot/core";

export type ConnectorProtocol = "rest" | "graphql" | "soap" | "grpc" | "file" | "database" | "eventStream" | "custom";
export type ConnectorAuthType = "apiKey" | "oauth2" | "basic" | "none" | "bearer";
export type ConnectorCostOwner = "userProvided" | "vendor" | "free";

export type ConnectorPermission = {
  name: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
};

export type ConnectorEndpoint = {
  operationId: string;
  method: string;
  path: string;
  description?: string;
  permission: string;
  inputSchema: JsonObject;
  outputSchema: JsonObject;
  dataClassifications?: string[];
};

export type ConnectorManifest = {
  name: string;
  systemType: string;
  description: string;
  protocol: ConnectorProtocol;
  auth: {
    type: ConnectorAuthType;
    scopes?: string[];
  };
  permissions: ConnectorPermission[];
  endpoints: ConnectorEndpoint[];
  dataClassifications: string[];
  rateLimits?: {
    callsPerMinute?: number;
    callsPerHour?: number;
  };
  costOwner: ConnectorCostOwner;
  fixtureMode: boolean;
  fixtureData?: string | JsonObject;
  readWrite: {
    read: string[];
    write: string[];
  };
  testEndpoint?: { method: string; path: string };
};

export const connectorManifestJsonSchema = {
  type: "object",
  required: [
    "name",
    "systemType",
    "description",
    "protocol",
    "auth",
    "permissions",
    "endpoints",
    "dataClassifications",
    "costOwner",
    "fixtureMode",
    "readWrite"
  ],
  properties: {
    name: { type: "string", pattern: "^[a-zA-Z][a-zA-Z0-9_-]*$" },
    systemType: { type: "string" },
    description: { type: "string" },
    protocol: { enum: ["rest", "graphql", "soap", "grpc", "file", "database", "eventStream", "custom"] },
    auth: {
      type: "object",
      required: ["type"],
      properties: {
        type: { enum: ["apiKey", "oauth2", "basic", "none", "bearer"] },
        scopes: { type: "array", items: { type: "string" } }
      }
    },
    permissions: { type: "array" },
    endpoints: { type: "array" },
    dataClassifications: { type: "array", items: { type: "string" } },
    rateLimits: { type: "object" },
    costOwner: { enum: ["userProvided", "vendor", "free"] },
    fixtureMode: { type: "boolean" },
    fixtureData: {},
    readWrite: { type: "object" },
    testEndpoint: {
      type: "object",
      required: ["method", "path"],
      properties: {
        method: { type: "string" },
        path: { type: "string" }
      }
    }
  }
} as const;

const protocols = new Set<ConnectorProtocol>(["rest", "graphql", "soap", "grpc", "file", "database", "eventStream", "custom"]);
const authTypes = new Set<ConnectorAuthType>(["apiKey", "oauth2", "basic", "none", "bearer"]);
const riskLevels = new Set<RiskLevel>(["low", "medium", "high", "critical"]);
const costOwners = new Set<ConnectorCostOwner>(["userProvided", "vendor", "free"]);

export function loadConnectorManifestFile(filePath: string): ConnectorManifest {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = parseStructuredFile(raw, filePath);
  const manifest = validateConnectorManifest(parsed);
  const baseDir = path.dirname(filePath);

  if (typeof manifest.fixtureData === "string" && !path.isAbsolute(manifest.fixtureData)) {
    return {
      ...manifest,
      fixtureData: path.resolve(baseDir, manifest.fixtureData)
    };
  }

  return manifest;
}

export function parseStructuredFile(raw: string, filePath: string): unknown {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".json") {
    return JSON.parse(raw) as unknown;
  }

  return YAML.parse(raw) as unknown;
}

export function validateConnectorManifest(input: unknown): ConnectorManifest {
  const errors: string[] = [];
  const record = asRecord(input, "manifest", errors);

  const name = requireString(record, "name", errors);
  if (name && !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
    errors.push("manifest.name must start with a letter and contain only letters, numbers, underscores, or hyphens.");
  }

  const protocol = requireString(record, "protocol", errors) as ConnectorProtocol;
  if (protocol && !protocols.has(protocol)) {
    errors.push(`manifest.protocol must be one of: ${[...protocols].join(", ")}.`);
  }

  const costOwner = requireString(record, "costOwner", errors) as ConnectorCostOwner;
  if (costOwner && !costOwners.has(costOwner)) {
    errors.push("manifest.costOwner must be userProvided, vendor, or free.");
  }

  const authRecord = asRecord(record.auth, "manifest.auth", errors);
  const authType = requireString(authRecord, "type", errors) as ConnectorAuthType;
  if (authType && !authTypes.has(authType)) {
    errors.push("manifest.auth.type must be apiKey, oauth2, basic, bearer, or none.");
  }

  const scopes = optionalStringArray(authRecord.scopes, "manifest.auth.scopes", errors);
  const permissions = parsePermissions(record.permissions, errors);
  const endpoints = parseEndpoints(record.endpoints, permissions, errors);
  const dataClassifications = requireStringArray(record.dataClassifications, "manifest.dataClassifications", errors);
  const readWrite = asRecord(record.readWrite, "manifest.readWrite", errors);
  const read = requireStringArray(readWrite.read, "manifest.readWrite.read", errors);
  const write = requireStringArray(readWrite.write, "manifest.readWrite.write", errors);
  const rateLimits = parseRateLimits(record.rateLimits, errors);
  const fixtureData = parseFixtureData(record.fixtureData, errors);
  const testEndpoint = parseTestEndpoint(record.testEndpoint, errors);

  if (typeof record.fixtureMode !== "boolean") {
    errors.push("manifest.fixtureMode must be a boolean.");
  }

  if (errors.length > 0) {
    throw new Error(`Invalid connector manifest:\n- ${errors.join("\n- ")}`);
  }

  return {
    name,
    systemType: requireString(record, "systemType", []),
    description: requireString(record, "description", []),
    protocol,
    auth: {
      type: authType,
      ...(scopes ? { scopes } : {})
    },
    permissions,
    endpoints,
    dataClassifications,
    ...(rateLimits ? { rateLimits } : {}),
    costOwner,
    fixtureMode: record.fixtureMode as boolean,
    ...(fixtureData !== undefined ? { fixtureData } : {}),
    readWrite: { read, write },
    ...(testEndpoint !== undefined ? { testEndpoint } : {})
  };
}

function parsePermissions(input: unknown, errors: string[]): ConnectorPermission[] {
  if (!Array.isArray(input) || input.length === 0) {
    errors.push("manifest.permissions must be a non-empty array.");
    return [];
  }

  return input.map((item, index) => {
    const record = asRecord(item, `manifest.permissions[${index}]`, errors);
    const name = requireString(record, "name", errors);
    const riskLevel = requireString(record, "riskLevel", errors) as RiskLevel;
    if (riskLevel && !riskLevels.has(riskLevel)) {
      errors.push(`manifest.permissions[${index}].riskLevel must be low, medium, high, or critical.`);
    }
    if (typeof record.requiresApproval !== "boolean") {
      errors.push(`manifest.permissions[${index}].requiresApproval must be a boolean.`);
    }

    return {
      name,
      riskLevel,
      requiresApproval: record.requiresApproval === true
    };
  });
}

function parseEndpoints(input: unknown, permissions: ConnectorPermission[], errors: string[]): ConnectorEndpoint[] {
  if (!Array.isArray(input) || input.length === 0) {
    errors.push("manifest.endpoints must be a non-empty array.");
    return [];
  }

  const permissionNames = new Set(permissions.map((permission) => permission.name));
  return input.map((item, index) => {
    const record = asRecord(item, `manifest.endpoints[${index}]`, errors);
    const operationId = requireString(record, "operationId", errors);
    const method = requireString(record, "method", errors).toUpperCase();
    const endpointPath = requireString(record, "path", errors);
    const permission = requireString(record, "permission", errors);
    const inputSchema = optionalObject(record.inputSchema, `manifest.endpoints[${index}].inputSchema`, errors) ?? {};
    const outputSchema = optionalObject(record.outputSchema, `manifest.endpoints[${index}].outputSchema`, errors) ?? {};
    const dataClassifications = optionalStringArray(
      record.dataClassifications,
      `manifest.endpoints[${index}].dataClassifications`,
      errors
    );

    if (permission && !permissionNames.has(permission)) {
      errors.push(`manifest.endpoints[${index}].permission references unknown permission "${permission}".`);
    }

    return {
      operationId,
      method,
      path: endpointPath,
      ...(typeof record.description === "string" ? { description: record.description } : {}),
      permission,
      inputSchema,
      outputSchema,
      ...(dataClassifications ? { dataClassifications } : {})
    };
  });
}

function parseRateLimits(input: unknown, errors: string[]): ConnectorManifest["rateLimits"] | undefined {
  if (input === undefined) {
    return undefined;
  }

  const record = asRecord(input, "manifest.rateLimits", errors);
  const output: ConnectorManifest["rateLimits"] = {};
  if (record.callsPerMinute !== undefined) {
    if (typeof record.callsPerMinute !== "number") {
      errors.push("manifest.rateLimits.callsPerMinute must be a number.");
    } else {
      output.callsPerMinute = record.callsPerMinute;
    }
  }
  if (record.callsPerHour !== undefined) {
    if (typeof record.callsPerHour !== "number") {
      errors.push("manifest.rateLimits.callsPerHour must be a number.");
    } else {
      output.callsPerHour = record.callsPerHour;
    }
  }
  return output;
}

function parseTestEndpoint(input: unknown, errors: string[]): { method: string; path: string } | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (typeof input !== "object" || input === null) {
    errors.push("manifest.testEndpoint must be an object when provided.");
    return undefined;
  }
  const record = input as Record<string, unknown>;
  let method: string | undefined;
  let path: string | undefined;
  if (typeof record.method !== "string") {
    errors.push("manifest.testEndpoint.method must be a string.");
  } else {
    method = record.method.toUpperCase();
  }
  if (typeof record.path !== "string") {
    errors.push("manifest.testEndpoint.path must be a string.");
  } else {
    path = record.path;
  }
  if (method === undefined || path === undefined) {
    return undefined;
  }
  return { method, path };
}

function parseFixtureData(input: unknown, errors: string[]): string | JsonObject | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (typeof input === "string") {
    return input;
  }

  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as JsonObject;
  }

  errors.push("manifest.fixtureData must be a path string or object when provided.");
  return undefined;
}

function asRecord(input: unknown, label: string, errors: string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    errors.push(`${label} must be an object.`);
    return {};
  }

  return input as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string, errors: string[]): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`manifest.${key} must be a non-empty string.`);
    return "";
  }

  return value.trim();
}

function requireStringArray(input: unknown, label: string, errors: string[]): string[] {
  const value = optionalStringArray(input, label, errors);
  if (!value) {
    errors.push(`${label} must be an array of strings.`);
    return [];
  }

  return value;
}

function optionalStringArray(input: unknown, label: string, errors: string[]): string[] | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (!Array.isArray(input) || input.some((item) => typeof item !== "string")) {
    errors.push(`${label} must be an array of strings.`);
    return undefined;
  }

  return input;
}

function optionalObject(input: unknown, label: string, errors: string[]): JsonObject | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    errors.push(`${label} must be an object.`);
    return undefined;
  }

  return input as JsonObject;
}
