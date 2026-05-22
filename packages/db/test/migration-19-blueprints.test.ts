import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../src/migrations.js";

describe("migration 19 — blueprints tables", () => {
  it("creates blueprints, blueprint_versions, blueprint_runs", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);

    expect(tables).toContain("blueprints");
    expect(tables).toContain("blueprint_versions");
    expect(tables).toContain("blueprint_runs");
  });

  it("blueprints table has expected columns", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const cols = db.prepare("PRAGMA table_info(blueprints)").all().map((r) => (r as { name: string }).name);
    expect(cols).toEqual(
      expect.arrayContaining(["id", "slug", "name", "manifest_json", "status", "current_version", "createdAt", "updatedAt"])
    );
  });

  it("blueprint_versions has unique (blueprint_id, version) constraint", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    db.prepare(
      "INSERT INTO blueprints (id, slug, name, manifest_json, status, current_version, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("bp1", "test", "Test", "{}", "draft", "1.0.0", "2026-05-21T00:00:00Z", "2026-05-21T00:00:00Z");

    db.prepare(
      "INSERT INTO blueprint_versions (id, blueprint_id, version, manifest_json, createdAt, createdBy) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("v1", "bp1", "1.0.0", "{}", "2026-05-21T00:00:00Z", "system");

    expect(() => {
      db.prepare(
        "INSERT INTO blueprint_versions (id, blueprint_id, version, manifest_json, createdAt, createdBy) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("v2", "bp1", "1.0.0", "{}", "2026-05-21T00:00:00Z", "system");
    }).toThrow(/UNIQUE/);
  });

  it("blueprint_runs has FK to blueprints", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    expect(() => {
      db.prepare(
        "INSERT INTO blueprint_runs (id, blueprint_id, version, run_type, result_json, startedAt) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("r1", "nonexistent-bp", "1.0.0", "benchmark", "{}", "2026-05-21T00:00:00Z");
    }).toThrow(/FOREIGN KEY/);
  });
});
