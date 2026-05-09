import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";

export function tempDb(): SquidDatabase {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-governance-"));
  return initializeDatabase(path.join(dir, "squidbot.sqlite"));
}
