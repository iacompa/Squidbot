import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import { getDesktopAppPaths } from "./appPaths.js";
import { registerIpcHandlers } from "./ipc.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let database: SquidDatabase | null = null;

app.setName("SquidBot");

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: "SquidBot",
    backgroundColor: "#f6f7f4",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

void app.whenReady().then(() => {
  const paths = getDesktopAppPaths();
  database = initializeDatabase(paths.databasePath);
  if (!database.getSetting("model.provider")) {
    database.setSetting("model.provider", "local");
  }
  if (database.getSetting("byokEnabled") === null) {
    database.setSetting("byokEnabled", false);
  }
  registerIpcHandlers(database, paths);

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  database?.close();
});
