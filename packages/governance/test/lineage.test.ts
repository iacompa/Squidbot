import { afterEach, describe, expect, it } from "vitest";
import type { SquidDatabase } from "@squidbot/db";
import { GovernanceEngine } from "../src/index.js";
import { tempDb } from "./helpers.js";

let db: SquidDatabase | null = null;
afterEach(() => db?.close());

describe("lineage", () => {
  it("records run lineage edges", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    governance.bootstrap();
    governance.seedExampleLineage("run_test");
    expect(governance.lineage.listForRun("run_test")).toHaveLength(3);
  });
});
