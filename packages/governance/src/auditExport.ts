import fs from "node:fs";
import path from "node:path";
import { sha256 } from "./internal.js";
import { AuditLedger } from "./auditLedger.js";
import type { AuditEntryRecord } from "./types.js";

export class AuditExporter {
  constructor(private readonly ledger: AuditLedger) {}

  exportJsonl(outPath: string): { path: string; checksum: string; count: number } {
    const entries = this.ledger.all();
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const body = entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length ? "\n" : "");
    fs.writeFileSync(outPath, body, "utf8");
    return { path: outPath, checksum: sha256(body), count: entries.length };
  }

  exportCsv(outPath: string): { path: string; checksum: string; count: number } {
    const entries = this.ledger.all();
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const header = "sequence,createdAt,actorType,actorId,action,resourceType,resourceId,outcome,entryHash";
    const rows = entries.map((entry) =>
      [entry.sequence, entry.createdAt, entry.actorType, entry.actorId, entry.action, entry.resourceType, entry.resourceId, entry.outcome, entry.entryHash]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(",")
    );
    const body = [header, ...rows].join("\n") + "\n";
    fs.writeFileSync(outPath, body, "utf8");
    return { path: outPath, checksum: sha256(body), count: entries.length };
  }

  verifyJsonl(filePath: string): { ok: boolean; count: number; failedAt?: number; reason?: string } {
    const text = fs.readFileSync(filePath, "utf8").trim();
    const entries = text ? text.split(/\r?\n/).map((line) => JSON.parse(line) as AuditEntryRecord) : [];
    const result = this.ledger.verify(entries);
    return { ...result, count: entries.length };
  }
}
