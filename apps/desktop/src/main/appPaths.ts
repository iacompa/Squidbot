import path from "node:path";
import { app } from "electron";

export type DesktopAppPaths = {
  appDataDir: string;
  databasePath: string;
};

export function getDesktopAppPaths(): DesktopAppPaths {
  const appDataDir = app.getPath("userData");
  return {
    appDataDir,
    databasePath: path.join(appDataDir, "squidbot.sqlite")
  };
}
