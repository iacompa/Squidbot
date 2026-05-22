import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SquidDatabase } from "../src/database.js";

let db: SquidDatabase;

beforeEach(() => {
  db = new SquidDatabase(":memory:");
});

afterEach(() => {
  db.close();
});

const manifestJson = JSON.stringify({ slug: "test-bp", version: "1.0.0", name: "Test" });

describe("SquidDatabase Blueprint methods", () => {
  it("saveBlueprint creates a new row and a version", () => {
    const id = db.saveBlueprint({
      slug: "test-bp",
      name: "Test",
      manifest_json: manifestJson,
      status: "draft",
      current_version: "1.0.0"
    }, "system");

    expect(id).toBeDefined();

    const fetched = db.getBlueprint("test-bp");
    expect(fetched).toMatchObject({ slug: "test-bp", status: "draft", current_version: "1.0.0" });

    const versions = db.listBlueprintVersions(id);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.version).toBe("1.0.0");
  });

  it("saveBlueprint on existing slug creates a new version", () => {
    const id = db.saveBlueprint({
      slug: "test-bp",
      name: "Test",
      manifest_json: manifestJson,
      status: "draft",
      current_version: "1.0.0"
    }, "system");

    const newManifest = JSON.stringify({ slug: "test-bp", version: "1.0.1", name: "Test" });
    db.saveBlueprint({
      slug: "test-bp",
      name: "Test",
      manifest_json: newManifest,
      status: "draft",
      current_version: "1.0.1"
    }, "user-1");

    const versions = db.listBlueprintVersions(id);
    expect(versions.map((v) => v.version).sort()).toEqual(["1.0.0", "1.0.1"]);
  });

  it("deleteBlueprint cascades to versions", () => {
    const id = db.saveBlueprint({
      slug: "test-bp",
      name: "Test",
      manifest_json: manifestJson,
      status: "draft",
      current_version: "1.0.0"
    }, "system");
    db.deleteBlueprint(id);
    expect(db.getBlueprint("test-bp")).toBeNull();
    expect(db.listBlueprintVersions(id)).toHaveLength(0);
  });

  it("listBlueprints returns all in newest-first order", () => {
    db.saveBlueprint({ slug: "a", name: "A", manifest_json: "{}", status: "draft", current_version: "1.0.0" }, "system");
    db.saveBlueprint({ slug: "b", name: "B", manifest_json: "{}", status: "draft", current_version: "1.0.0" }, "system");
    const list = db.listBlueprints();
    expect(list.map((bp) => bp.slug)).toEqual(["b", "a"]);
  });

  it("saveBlueprint with unchanged current_version updates identity row without duplicating version", () => {
    const id = db.saveBlueprint({
      slug: "test-bp",
      name: "Original Name",
      manifest_json: manifestJson,
      status: "draft",
      current_version: "1.0.0"
    }, "user-1");

    // Save again with same version but different name + status (e.g. user edits metadata
    // without bumping version).
    db.saveBlueprint({
      slug: "test-bp",
      name: "Renamed",
      manifest_json: JSON.stringify({ slug: "test-bp", version: "1.0.0", name: "Renamed" }),
      status: "pilot",
      current_version: "1.0.0"
    }, "user-2");

    // Identity row reflects the update
    const bp = db.getBlueprint("test-bp");
    expect(bp).toMatchObject({ name: "Renamed", status: "pilot" });

    // But version history is NOT duplicated (UNIQUE constraint silently swallowed)
    const versions = db.listBlueprintVersions(id);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.version).toBe("1.0.0");
  });
});
