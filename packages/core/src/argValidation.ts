import type { JsonObject } from "./types.js";

// Lightweight, dependency-free validation of tool arguments against the subset
// of JSON Schema that tool `inputSchema`s actually use: an object with
// `required` names and `properties` carrying a primitive `type`. We deliberately
// *under*-validate rather than risk rejecting a valid call:
//   - unknown extra properties are allowed (JSON Schema's additionalProperties
//     defaults to true);
//   - unknown `type` keywords and non-object schemas pass;
//   - we fail only on a missing `required` property or a *known* property whose
//     type is wrong.
// Because the agent loop feeds tool errors back to the model, a rejection here
// is a self-correction signal, not a dead end.

export type ArgValidationResult = { ok: true } | { ok: false; errors: string[] };

export function validateToolArgs(inputSchema: JsonObject, args: JsonObject): ArgValidationResult {
  const schemaType = typeof inputSchema.type === "string" ? inputSchema.type : "object";
  if (schemaType !== "object") {
    return { ok: true };
  }

  const errors: string[] = [];

  const required = Array.isArray(inputSchema.required) ? inputSchema.required : [];
  for (const key of required) {
    if (typeof key === "string" && (args[key] === undefined || args[key] === null)) {
      errors.push(`missing required property "${key}"`);
    }
  }

  const properties =
    inputSchema.properties && typeof inputSchema.properties === "object"
      ? (inputSchema.properties as Record<string, unknown>)
      : {};
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) {
      continue; // presence is the `required` check's job; null is "not provided"
    }
    const propSchema = properties[key];
    if (!propSchema || typeof propSchema !== "object") {
      continue; // undeclared property — allowed (additionalProperties)
    }
    const expected = (propSchema as { type?: unknown }).type;
    if (typeof expected !== "string") {
      continue; // no declared type — nothing to check
    }
    if (!matchesType(value, expected)) {
      errors.push(`property "${key}" must be ${expected}, got ${describeType(value)}`);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function matchesType(value: unknown, expected: string): boolean {
  switch (expected) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      return true; // unknown type keyword — don't reject what we can't judge
  }
}

function describeType(value: unknown): string {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}
