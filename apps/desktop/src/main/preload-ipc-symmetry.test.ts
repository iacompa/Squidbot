import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const preloadSrc = fs.readFileSync(path.join(here, "..", "preload", "index.ts"), "utf8");
const ipcSrc = fs.readFileSync(path.join(here, "ipc.ts"), "utf8");

function channelsFrom(source: string, pattern: RegExp): Set<string> {
  const found = new Set<string>();
  for (const match of source.matchAll(pattern)) {
    found.add(match[1]);
  }
  return found;
}

// Every channel the renderer invokes/subscribes to, and every channel main handles/sends.
const invoked = channelsFrom(preloadSrc, /ipcRenderer\.invoke\(\s*["']squidbot:([A-Za-z0-9_]+)["']/g);
const subscribed = channelsFrom(preloadSrc, /ipcRenderer\.on\(\s*["']squidbot:([A-Za-z0-9_]+)["']/g);
const handled = channelsFrom(ipcSrc, /ipcMain\.handle\(\s*["']squidbot:([A-Za-z0-9_]+)["']/g);
const sent = channelsFrom(ipcSrc, /\.send\(\s*["']squidbot:([A-Za-z0-9_]+)["']/g);

describe("preload ↔ ipc symmetry (5.1)", () => {
  it("found a sane number of channels on each side", () => {
    expect(invoked.size).toBeGreaterThan(20);
    expect(handled.size).toBeGreaterThan(20);
  });

  it("every renderer-invoked channel has a matching ipcMain.handle (no missing handler)", () => {
    const missing = [...invoked].filter((channel) => !handled.has(channel)).sort();
    expect(missing, `preload invokes channels with no main handler: ${missing.join(", ")}`).toEqual([]);
  });

  it("every renderer event subscription has a matching main .send (no dead listener)", () => {
    const missing = [...subscribed].filter((channel) => !sent.has(channel)).sort();
    expect(missing, `preload subscribes to events main never sends: ${missing.join(", ")}`).toEqual([]);
  });
});
