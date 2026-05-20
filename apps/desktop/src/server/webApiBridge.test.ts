import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { mountWebApiBridge } from "./webApiBridge";

describe("webApiBridge", () => {
  it("invokes the registered IPC handler and returns the result as JSON", async () => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>([
      ["listModelAccounts", async () => ({ accounts: [], activeAccountName: null })]
    ]);
    const app = express();
    mountWebApiBridge(app, {
      invoke: async (method, ...args) => {
        const fn = handlers.get(method);
        if (!fn) throw new Error(`unknown ${method}`);
        return fn(...args);
      }
    });
    const res = await request(app).post("/api/listModelAccounts").send({ args: [] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accounts: [], activeAccountName: null });
  });

  it("forwards args from request body to the handler", async () => {
    const recordedArgs: unknown[][] = [];
    const app = express();
    mountWebApiBridge(app, {
      invoke: async (_method, ...args) => {
        recordedArgs.push(args);
        return { ok: true };
      }
    });
    await request(app).post("/api/saveSetting").send({ args: ["theme", "dark"] });
    expect(recordedArgs).toEqual([["theme", "dark"]]);
  });

  it("returns 500 with error message when the handler rejects", async () => {
    const app = express();
    mountWebApiBridge(app, {
      invoke: async () => { throw new Error("boom"); }
    });
    const res = await request(app).post("/api/bogus").send({ args: [] });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "boom" });
  });

  it("treats missing body.args as empty array", async () => {
    const recordedArgs: unknown[][] = [];
    const app = express();
    mountWebApiBridge(app, {
      invoke: async (_method, ...args) => {
        recordedArgs.push(args);
        return { ok: true };
      }
    });
    await request(app).post("/api/listJobs").send({});
    expect(recordedArgs).toEqual([[]]);
  });
});
