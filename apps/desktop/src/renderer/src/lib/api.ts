import type { SquidbotApi } from "../../../shared/api";
import { setTransport, callApi } from "./apiTransport";

// `window.squidbot` is declared globally in renderer/src/vite-env.d.ts as
// `SquidbotApi` (the Electron preload guarantees it's present at runtime).
// In the web bundle, the same renderer code runs without that preload — so we
// re-read the value here as a possibly-undefined record-of-functions before
// deciding which transport to wire.

// ---------------------------------------------------------------------------
// Transport selection — runs at module load.
//
// In Electron, the preload script (apps/desktop/src/preload/index.ts) sets
// window.squidbot. In the web bundle (Phase D Express server), window.squidbot
// is undefined, and we fall back to HTTP against the same-origin /api/<method>
// routes.
// ---------------------------------------------------------------------------
if (typeof window !== "undefined") {
  const bridge = (window as unknown as {
    squidbot?: Record<string, (...args: unknown[]) => Promise<unknown>>;
  }).squidbot;
  if (bridge) {
    setTransport({
      kind: "ipc",
      invoke: async (method, ...args) => {
        // Re-read window.squidbot at call time so test setups that swap the
        // bridge in/out via Object.defineProperty still resolve correctly.
        const live = (window as unknown as {
          squidbot?: Record<string, (...args: unknown[]) => Promise<unknown>>;
        }).squidbot;
        const fn = live?.[method];
        if (typeof fn !== "function") {
          throw new Error(`Unknown IPC method: ${method}`);
        }
        return fn(...args);
      }
    });
  } else {
    // Web bundle: same-origin Express server serves /api/* endpoints.
    setTransport({
      kind: "http",
      baseUrl: window.location.origin
    });
  }
}

// ---------------------------------------------------------------------------
// squidbotApi proxy — preserves the existing window.squidbot.* call shape
// throughout the renderer (no callsites change). Each property access
// returns a function that routes through callApi(method, ...args).
//
// We Proxy an empty object cast to SquidbotApi because TypeScript can't
// otherwise verify a Proxy satisfies every method on the type.
// ---------------------------------------------------------------------------
export const squidbotApi: SquidbotApi = new Proxy({} as SquidbotApi, {
  get(_target, prop: string | symbol) {
    if (typeof prop !== "string") return undefined;
    // Event subscriptions (onChatToken) are a different shape from RPC calls:
    // they bind a listener on a live push channel (Electron's ipcRenderer.on)
    // and return a *synchronous* unsubscribe handle — they are NOT request/
    // response round-trips, so they must bypass callApi (which returns a
    // Promise) and bind directly to the bridge. Where no push channel exists
    // (the web/HTTP bundle, or a test bridge that omits the method), we degrade
    // to a no-op subscription so the caller's unsubscribe() is always safe to
    // invoke and the final response still arrives via sendChatMessage.
    if (prop === "onChatToken") {
      return (callback: (delta: string) => void) => {
        const live =
          typeof window !== "undefined"
            ? (window as unknown as {
                squidbot?: { onChatToken?: (cb: (delta: string) => void) => () => void };
              }).squidbot
            : undefined;
        const fn = live?.onChatToken;
        return typeof fn === "function" ? fn(callback) : () => undefined;
      };
    }
    return (...args: unknown[]) => callApi(prop, ...args);
  }
}) as SquidbotApi;
