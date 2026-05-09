import fs from "node:fs";
import path from "node:path";
import type { JsonObject } from "@squidbot/core";
import { parseStructuredFile, validateConnectorManifest, type ConnectorEndpoint, type ConnectorManifest } from "./manifest.js";

export type OpenApiImportOptions = {
  specPath: string;
  name: string;
  manifestOutputPath?: string;
  generatedRoot?: string;
};

export type OpenApiImportResult = {
  manifest: ConnectorManifest;
  manifestPath: string;
  generatedDir: string;
};

type Operation = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: unknown[];
  requestBody?: unknown;
  responses?: Record<string, unknown>;
};

const readMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export function importOpenApi(options: OpenApiImportOptions): OpenApiImportResult {
  const raw = fs.readFileSync(options.specPath, "utf8");
  const spec = parseStructuredFile(raw, options.specPath);
  const record = asRecord(spec, "OpenAPI spec");
  const info = asRecord(record.info ?? {}, "OpenAPI info");
  const connectorName = sanitizeIdentifier(options.name);
  const paths = asRecord(record.paths ?? {}, "OpenAPI paths");

  const endpoints: ConnectorEndpoint[] = [];
  const permissionsByName = new Map<string, { name: string; riskLevel: "low" | "medium"; requiresApproval: boolean }>();
  const read: string[] = [];
  const write: string[] = [];
  const fixtureData: Record<string, unknown> = {};

  for (const [routePath, pathItem] of Object.entries(paths)) {
    const pathRecord = asRecord(pathItem, `OpenAPI path ${routePath}`);
    for (const [method, operationValue] of Object.entries(pathRecord)) {
      const upperMethod = method.toUpperCase();
      if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(upperMethod)) {
        continue;
      }

      const operation = asRecord(operationValue, `OpenAPI operation ${method} ${routePath}`) as Operation;
      const operationId = sanitizeIdentifier(operation.operationId ?? `${method}_${routePath.replace(/[{}]/g, "").replace(/\W+/g, "_")}`);
      const resource = sanitizeResource(operation.tags?.[0] ?? firstPathSegment(routePath));
      const isRead = readMethods.has(upperMethod);
      const permissionName = `${isRead ? "read" : "write"}${toPascalCase(resource)}`;
      permissionsByName.set(permissionName, {
        name: permissionName,
        riskLevel: isRead ? "low" : "medium",
        requiresApproval: !isRead
      });

      if (isRead) {
        read.push(operationId);
      } else {
        write.push(operationId);
      }

      const endpoint: ConnectorEndpoint = {
        operationId,
        method: upperMethod,
        path: routePath,
        description: operation.summary ?? operation.description ?? `${upperMethod} ${routePath}`,
        permission: permissionName,
        inputSchema: buildInputSchema(operation),
        outputSchema: extractOutputSchema(operation),
        dataClassifications: ["public"]
      };
      endpoints.push(endpoint);
      fixtureData[operationId] = generateFixturePlaceholder(endpoint.outputSchema);
    }
  }

  if (endpoints.length === 0) {
    throw new Error("OpenAPI spec did not contain any REST operations.");
  }

  const manifest = validateConnectorManifest({
    name: connectorName,
    systemType: sanitizeIdentifier(String(info.title ?? connectorName)).toLowerCase(),
    description: String(info.description ?? info.title ?? `${connectorName} connector generated from OpenAPI.`),
    protocol: "rest",
    auth: { type: "none", scopes: [] },
    permissions: [...permissionsByName.values()],
    endpoints,
    dataClassifications: ["public"],
    rateLimits: { callsPerMinute: 60 },
    costOwner: "free",
    fixtureMode: true,
    fixtureData,
    readWrite: { read, write }
  });

  const manifestPath =
    options.manifestOutputPath ?? path.resolve(process.cwd(), "connectors", "generated", `${connectorName}.json`);
  const generatedDir =
    options.generatedRoot ?? path.resolve(process.cwd(), "packages", "connectors", "src", "generated", connectorName);

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(generatedDir, "index.ts"), generateToolStubSource(manifest), "utf8");

  return { manifest, manifestPath, generatedDir };
}

function buildInputSchema(operation: Operation): JsonObject {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const parameter of Array.isArray(operation.parameters) ? operation.parameters : []) {
    const record = asRecord(parameter, "OpenAPI parameter");
    const name = typeof record.name === "string" ? record.name : null;
    if (!name) {
      continue;
    }
    properties[name] = record.schema && typeof record.schema === "object" ? record.schema : { type: "string" };
    if (record.required === true) {
      required.push(name);
    }
  }

  const requestBody = asRecord(operation.requestBody ?? {}, "OpenAPI requestBody");
  const content = asRecord(requestBody.content ?? {}, "OpenAPI requestBody.content");
  const jsonContent = asRecord(content["application/json"] ?? {}, "OpenAPI application/json requestBody");
  if (jsonContent.schema && typeof jsonContent.schema === "object") {
    properties.body = jsonContent.schema;
    required.push("body");
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {})
  };
}

function extractOutputSchema(operation: Operation): JsonObject {
  const responses = operation.responses ?? {};
  const response = responses["200"] ?? responses["201"] ?? responses.default;
  const responseRecord = asRecord(response ?? {}, "OpenAPI response");
  const content = asRecord(responseRecord.content ?? {}, "OpenAPI response.content");
  const jsonContent = asRecord(content["application/json"] ?? {}, "OpenAPI application/json response");
  return jsonContent.schema && typeof jsonContent.schema === "object" ? (jsonContent.schema as JsonObject) : { type: "object" };
}

function generateFixturePlaceholder(schema: JsonObject): unknown {
  if (schema.type === "array") {
    return [generateFixturePlaceholder((schema.items as JsonObject | undefined) ?? { type: "object" })];
  }
  if (schema.type === "object" || schema.properties) {
    const properties = schema.properties && typeof schema.properties === "object" ? (schema.properties as Record<string, JsonObject>) : {};
    return Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, generateFixturePlaceholder(value)]));
  }
  if (schema.type === "number" || schema.type === "integer") {
    return 0;
  }
  if (schema.type === "boolean") {
    return false;
  }
  return "";
}

function generateToolStubSource(manifest: ConnectorManifest): string {
  const inputSchemas = Object.fromEntries(manifest.endpoints.map((endpoint) => [endpoint.operationId, endpoint.inputSchema]));
  const functions = manifest.endpoints
    .map((endpoint) => {
      const typePrefix = toPascalCase(endpoint.operationId);
      return `export type ${typePrefix}Args = Record<string, unknown>;
export type ${typePrefix}Response = Record<string, unknown>;

export async function ${endpoint.operationId}(args: ${typePrefix}Args = {}): Promise<${typePrefix}Response> {
  validateArgs("${endpoint.operationId}", args);
  return {
    connectorName: "${manifest.name}",
    operationName: "${endpoint.operationId}",
    fixtureMode: true,
    args
  };
}
`;
    })
    .join("\n");

  return `// Generated by SquidBot OpenAPI importer. Review before enabling real transport.
const inputSchemas: Record<string, { required?: string[]; [key: string]: unknown }> = ${JSON.stringify(inputSchemas, null, 2)};

${functions}
function validateArgs(operationName: string, args: Record<string, unknown>): void {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error(\`\${operationName} args must be an object.\`);
  }

  const required = inputSchemas[operationName]?.required ?? [];
  for (const key of required) {
    if (!(key in args)) {
      throw new Error(\`\${operationName} missing required arg: \${key}\`);
    }
  }
}
`;
}

function asRecord(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
}

function sanitizeIdentifier(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+/, "");
  const withPrefix = /^[a-zA-Z]/.test(cleaned) ? cleaned : `connector_${cleaned}`;
  return withPrefix.replace(/_+/g, "_");
}

function sanitizeResource(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, " ") || "resource";
}

function firstPathSegment(routePath: string): string {
  return routePath.split("/").filter(Boolean)[0] ?? "resource";
}

function toPascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
}
