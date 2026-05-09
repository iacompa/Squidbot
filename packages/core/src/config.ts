import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type SquidbotConfig = {
  appDataDir: string;
  databasePath: string;
  modelProvider: "local";
};

export function getDefaultAppDataDir(appName = "SquidBot"): string {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), appName);
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", appName);
  }

  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), appName);
}

export function getDefaultDatabasePath(appDataDir = getDefaultAppDataDir()): string {
  return path.join(appDataDir, "squidbot.sqlite");
}

export function ensureLocalConfig(appDataDir = getDefaultAppDataDir()): SquidbotConfig {
  fs.mkdirSync(appDataDir, { recursive: true });

  return {
    appDataDir,
    databasePath: getDefaultDatabasePath(appDataDir),
    modelProvider: "local"
  };
}
