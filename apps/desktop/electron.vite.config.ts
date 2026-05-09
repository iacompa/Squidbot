import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          "@squidbot/connectors",
          "@squidbot/core",
          "@squidbot/db",
          "@squidbot/evals",
          "@squidbot/messaging",
          "@squidbot/scheduler",
          "@squidbot/skills",
          "@squidbot/team"
        ],
        include: ["better-sqlite3"]
      })
    ],
    resolve: {
      alias: {
        "@squidbot/connectors": path.resolve(__dirname, "../../packages/connectors/src"),
        "@squidbot/core": path.resolve(__dirname, "../../packages/core/src"),
        "@squidbot/db": path.resolve(__dirname, "../../packages/db/src"),
        "@squidbot/evals": path.resolve(__dirname, "../../packages/evals/src"),
        "@squidbot/messaging": path.resolve(__dirname, "../../packages/messaging/src"),
        "@squidbot/scheduler": path.resolve(__dirname, "../../packages/scheduler/src"),
        "@squidbot/skills": path.resolve(__dirname, "../../packages/skills/src"),
        "@squidbot/team": path.resolve(__dirname, "../../packages/team/src")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: path.resolve(__dirname, "src/renderer"),
    plugins: [react()],
    resolve: {
      alias: {
        "@renderer": path.resolve(__dirname, "src/renderer/src")
      }
    }
  }
});
