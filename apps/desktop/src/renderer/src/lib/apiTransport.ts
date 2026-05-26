export type IpcTransport = {
  kind: "ipc";
  invoke: (method: string, ...args: unknown[]) => Promise<unknown>;
};

export type HttpTransport = {
  kind: "http";
  baseUrl: string;
  fetch?: typeof fetch;
};

export type Transport = IpcTransport | HttpTransport;

let current: Transport | null = null;

/**
 * Sets the transport used by callApi(). Called once at module load by
 * lib/api.ts based on whether window.squidbot exists (Electron) or not
 * (web bundle).
 *
 * Accepting `null` lets tests reset to a clean state.
 */
export function setTransport(t: Transport | null): void {
  current = t;
}

/**
 * Invokes a method via the configured transport. Mirrors the preload-
 * injected window.squidbot.<method>(...args) shape.
 *
 * Electron path: routes through ipcRenderer.invoke via the preload bridge.
 * Web path: POSTs to {baseUrl}/api/{method} with { args } as the JSON body.
 */
export async function callApi(method: string, ...args: unknown[]): Promise<unknown> {
  if (!current) {
    throw new Error(`apiTransport not configured — call setTransport before calling api.${method}()`);
  }
  if (current.kind === "ipc") {
    return current.invoke(method, ...args);
  }
  const fetcher = current.fetch ?? fetch;
  const res = await fetcher(`${current.baseUrl}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args })
  });
  if (!res.ok) {
    throw new Error(`API ${method} failed: ${res.status}`);
  }
  return res.json();
}
