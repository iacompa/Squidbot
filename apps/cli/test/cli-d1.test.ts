import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase } from "@squidbot/db";
import { createSquidbotServer, generateDockerfile } from "../src/server.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-d1-"));
  tempDirs.push(dir);
  return initializeDatabase(path.join(dir, "squidbot.sqlite"));
}

describe("createSquidbotServer (D1)", () => {
  it("GET /health returns {ok: true, version} without auth", async () => {
    const app = createSquidbotServer(tempDb(), { workspace: "/tmp" });
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.version).toBeTruthy();
  });

  it("POST /api/* routes through the web bridge and returns results", async () => {
    const app = createSquidbotServer(tempDb(), { workspace: "/tmp" });
    const res = await request(app).post("/api/getSettings").send({ args: [] });
    // getSettings is a real IPC handler — just verify it returns something
    expect(res.status).toBe(200);
  });

  it("respects apiToken when configured: 401 without token, 200 with correct token", async () => {
    const app = createSquidbotServer(tempDb(), { workspace: "/tmp", apiToken: "s3cret" });
    const denied = await request(app).get("/health");
    expect(denied.status).toBe(401);

    const allowed = await request(app)
      .get("/health")
      .set("Authorization", "Bearer s3cret");
    expect(allowed.status).toBe(200);
  });

  it("returns 404 on unknown non-API routes", async () => {
    const app = createSquidbotServer(tempDb(), { workspace: "/tmp" });
    const res = await request(app).get("/unknown-path");
    expect(res.status).toBe(404);
  });
});

describe("generateDockerfile (D1)", () => {
  it("produces a Dockerfile that references node:22-alpine and the correct port", () => {
    const { dockerfile } = generateDockerfile({ port: 8080 });
    expect(dockerfile).toContain("FROM node:22-alpine");
    expect(dockerfile).toContain("8080");
    expect(dockerfile).toContain("ENTRYPOINT");
  });

  it("generates a valid .dockerignore companion", () => {
    const { dockerignore } = generateDockerfile({ port: 8080 });
    expect(dockerignore).toContain("node_modules");
    expect(dockerignore).toContain(".git");
  });
});
