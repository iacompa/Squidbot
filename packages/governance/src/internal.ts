import { createHash } from "node:crypto";
import { createId, redactValue } from "@squidbot/core";
import type { JsonRecord } from "./types.js";

export { createId };

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sortJson(child)]));
  }
  return value;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function redactForStorage(value: unknown): unknown {
  return redactValue(value).value;
}

export function toJsonRecord(value: unknown): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {};
}

export function likePattern(pattern: string, value: string): boolean {
  if (pattern === "*" || pattern === value) {
    return true;
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

export function normalizeTenant(tenantId: string | null | undefined): string {
  return tenantId || "local-tenant";
}
