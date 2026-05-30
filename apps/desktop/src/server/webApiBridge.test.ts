import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { isSafeBridgeMethod, mountWebApiBridge } from "./webApiBridge";

describe("isSafeBridgeMethod", () => {
  it.each(["__proto__", "constructor", "prototype", "hasOwnProperty", "toString", "valueOf", "", "has-dash", "123abc", "model.useAccount"])(
    "rejects unsafe / prototype-pollution / malformed method %s",
    (method) => {
      expect(isSafeBridgeMethod(method)).toBe(false);
    }
  );

  it.each(["listBlueprints", "sendChatMessage", "getTrace", "model_useAccount", "buildCompliancePacket"])(
    "allows a well-formed IPC method name %s",
    (method) => {
      expect(isSafeBridgeMethod(method)).toBe(true);
    }
  );
});

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

  it("rejects a prototype-pollution method name with 400 and never invokes the adapter", async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    const app = express();
    mountWebApiBridge(app, { invoke });
    const res = await request(app).post("/api/__proto__").send({ args: [] });
    expect(res.status).toBe(400);
    expect(invoke).not.toHaveBeenCalled();
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

describe("webApiBridge — bearer token authentication (I5)", () => {
  function authApp(token: string) {
    const app = express();
    mountWebApiBridge(app, { invoke: async () => ({ ok: true }) }, { apiToken: token });
    return app;
  }

  it("allows a request with the correct Bearer token", async () => {
    const res = await request(authApp("secret-token"))
      .post("/api/listJobs")
      .set("Authorization", "Bearer secret-token")
      .send({ args: [] });
    expect(res.status).toBe(200);
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await request(authApp("secret-token"))
      .post("/api/listJobs")
      .send({ args: [] });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/unauthorized/i) });
  });

  it("returns 401 when token is wrong", async () => {
    const res = await request(authApp("secret-token"))
      .post("/api/listJobs")
      .set("Authorization", "Bearer wrong-token")
      .send({ args: [] });
    expect(res.status).toBe(401);
  });

  it("never calls the handler when auth fails", async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    const app = express();
    mountWebApiBridge(app, { invoke }, { apiToken: "tok" });
    await request(app).post("/api/listJobs").send({ args: [] });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("passes through unauthenticated when no apiToken is configured (localhost-only default)", async () => {
    const app = express();
    mountWebApiBridge(app, { invoke: async () => ({ ok: true }) });
    const res = await request(app).post("/api/listJobs").send({ args: [] });
    expect(res.status).toBe(200);
  });
});
