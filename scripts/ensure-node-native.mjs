import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

function canOpenSqlite() {
  try {
    const Database = require("better-sqlite3");
    new Database(":memory:").close();
    return true;
  } catch {
    return false;
  }
}

function runRepair() {
  const result = spawnSync(process.execPath, [path.join(scriptsDir, "rebuild-node-native.mjs")], {
    encoding: "utf8"
  });

  if (result.stdout) {
    process.stderr.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  return result;
}

if (!canOpenSqlite()) {
  console.error("better-sqlite3 needs a Node rebuild; repairing native module...");
  const result = runRepair();

  if (result.status !== 0 || !canOpenSqlite()) {
    console.error("better-sqlite3 is still not loadable after rebuild.");
    process.exit(1);
  }
}

console.error("better-sqlite3 ready");
