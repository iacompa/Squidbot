import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptsDir, "..");
const electronCommand = path.join(projectRoot, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");

const checkCode = `
  try {
    const Database = require("better-sqlite3");
    new Database(":memory:").close();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
`;

function canOpenSqliteInElectron() {
  const result = spawnSync(electronCommand, ["-e", checkCode], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1"
    },
    encoding: "utf8"
  });

  return result.status === 0;
}

function runRepair() {
  const result = spawnSync(process.execPath, [path.join(scriptsDir, "rebuild-electron-native.mjs")], {
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

if (!canOpenSqliteInElectron()) {
  console.error("better-sqlite3 needs an Electron rebuild; repairing native module...");
  const result = runRepair();

  if (result.status !== 0 || !canOpenSqliteInElectron()) {
    console.error("better-sqlite3 is still not loadable in Electron after rebuild.");
    process.exit(1);
  }
}

console.error("better-sqlite3 ready for Electron");
