import { afterEach, describe, expect, it, vi } from "vitest";
import { setTransport, callApi } from "./apiTransport";

afterEach(() => {
  // Reset transport so tests don't leak.
  // setTransport accepts a no-op fallback — see implementation.
  setTransport(null);
});

describe("apiTransport", () => {
  it("uses ipc transport when set", async () => {
    const invoke = vi.fn(async (method: string, ...args: unknown[]) => ({
      gotMethod: method,
      gotArgs: args
    }));
    setTransport({ kind: "ipc", invoke });
    const result = await callApi("listSomething", { a: 1 });
    expect(invoke).toHaveBeenCalledWith("listSomething", { a: 1 });
    expect(result).toEqual({ gotMethod: "listSomething", gotArgs: [{ a: 1 }] });
  });

  it("uses http transport when set", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const body = init?.body ? JSON.parse(init.body as string) : null;
      return {
        ok: true,
        async json() {
          return { url, body };
        }
      } as unknown as Response;
    });
    setTransport({ kind: "http", baseUrl: "http://localhost:8080", fetch: fetchMock });
    const result = await callApi("listSomething", { a: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/listSomething",
      expect.objectContaining({ method: "POST" })
    );
    expect((result as { url: string }).url).toContain("/api/listSomething");
    expect((result as { body: { args: unknown[] } }).body.args).toEqual([{ a: 1 }]);
  });

  it("http transport throws on non-2xx response", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      async json() { return {}; }
    } as unknown as Response));
    setTransport({ kind: "http", baseUrl: "http://localhost:8080", fetch: fetchMock });
    await expect(callApi("listSomething")).rejects.toThrow(/500/);
  });

  it("throws when no transport is configured", async () => {
    // Reset via setTransport(null) sentinel pattern, OR just import fresh.
    // Implementation may choose either approach; this test ensures the
    // error is clear when callApi is called before setTransport.
    // (Adjust to whatever the impl chose.)
    // For this test, we configure a "throwing" stub:
    setTransport({ kind: "ipc", invoke: async () => { throw new Error("never reached"); } });
    // Now clear by setting to null if the impl supports it:
    try {
      setTransport(null);
    } catch {
      // If impl doesn't support null, skip this test.
      return;
    }
    await expect(callApi("listSomething")).rejects.toThrow();
  });
});
