import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SquidDatabase } from "@squidbot/db";
import { AuditExporter, GovernanceEngine } from "../src/index.js";
import { tempDb } from "./helpers.js";

let db: SquidDatabase | null = null;
afterEach(() => db?.close());

describe("audit export", () => {
  it("exports and verifies JSONL", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    governance.bootstrap();
    const exporter = new AuditExporter(governance.audit);
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "audit-export-")), "audit.jsonl");
    const exported = exporter.exportJsonl(out);
    expect(exported.count).toBeGreaterThan(0);
    expect(exporter.verifyJsonl(out).ok).toBe(true);
  });
});
