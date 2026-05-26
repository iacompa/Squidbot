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
          "@squidbot/blueprints",
          "@squidbot/connectors",
          "@squidbot/core",
          "@squidbot/db",
          "@squidbot/evals",
          "@squidbot/governance",
          "@squidbot/memory",
          "@squidbot/messaging",
          "@squidbot/models",
          "@squidbot/sandbox",
          "@squidbot/scheduler",
          "@squidbot/skills",
          "@squidbot/team"
        ],
        include: ["better-sqlite3"]
      })
    ],
    resolve: {
      alias: {
        "@squidbot/blueprints": path.resolve(__dirname, "../../packages/blueprints/src"),
        "@squidbot/connectors": path.resolve(__dirname, "../../packages/connectors/src"),
        "@squidbot/core": path.resolve(__dirname, "../../packages/core/src"),
        "@squidbot/db": path.resolve(__dirname, "../../packages/db/src"),
        "@squidbot/evals": path.resolve(__dirname, "../../packages/evals/src"),
        "@squidbot/governance": path.resolve(__dirname, "../../packages/governance/src"),
        "@squidbot/memory": path.resolve(__dirname, "../../packages/memory/src"),
        "@squidbot/messaging": path.resolve(__dirname, "../../packages/messaging/src"),
        "@squidbot/models": path.resolve(__dirname, "../../packages/models/src"),
        "@squidbot/sandbox": path.resolve(__dirname, "../../packages/sandbox/src"),
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
    },
    optimizeDeps: {
      exclude: ["@squidbot/core", "@squidbot/db", "better-sqlite3"]
    }
  }
});
