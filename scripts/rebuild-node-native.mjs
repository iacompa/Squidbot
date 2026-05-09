import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-native-"));
const linkPath = path.join(tempRoot, "workspace");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

try {
  fs.symlinkSync(projectRoot, linkPath, process.platform === "win32" ? "junction" : "dir");
  const result = spawnSync(npmCommand, ["rebuild", "better-sqlite3"], {
    cwd: linkPath,
    env: {
      ...process.env,
      INIT_CWD: linkPath
    },
    stdio: "inherit"
  });

  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
