// @vitest-environment jsdom

import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBreakpoint } from "./useBreakpoint";

type MqlListener = (evt: { matches: boolean }) => void;

function mockMatchMedia(initialMatches: Record<string, boolean>): {
  setMatches: (query: string, matches: boolean) => void;
} {
  const listeners = new Map<string, Set<MqlListener>>();
  const matchesByQuery = new Map<string, boolean>(Object.entries(initialMatches));
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      if (!listeners.has(query)) listeners.set(query, new Set());
      const mql = {
        get matches() {
          return matchesByQuery.get(query) ?? false;
        },
        media: query,
        addEventListener: (_: string, cb: MqlListener) => listeners.get(query)!.add(cb),
        removeEventListener: (_: string, cb: MqlListener) => listeners.get(query)!.delete(cb)
      };
      return mql;
    }
  });
  return {
    setMatches: (query: string, matches: boolean) => {
      matchesByQuery.set(query, matches);
      const cbs = listeners.get(query);
      if (cbs) for (const cb of cbs) cb({ matches });
    }
  };
}

describe("useBreakpoint", () => {
  it("returns 'desktop' when neither mobile nor tablet query matches", () => {
    mockMatchMedia({ "(max-width: 767px)": false, "(max-width: 1023px)": false });
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("desktop");
  });

  it("returns 'tablet' when only the tablet query matches", () => {
    mockMatchMedia({ "(max-width: 767px)": false, "(max-width: 1023px)": true });
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("tablet");
  });

  it("returns 'mobile' when the mobile query matches", () => {
    mockMatchMedia({ "(max-width: 767px)": true, "(max-width: 1023px)": true });
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("mobile");
  });

  it("updates when matchMedia event fires", () => {
    const { setMatches } = mockMatchMedia({ "(max-width: 767px)": false, "(max-width: 1023px)": false });
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("desktop");
    act(() => {
      setMatches("(max-width: 1023px)", true);
    });
    expect(result.current).toBe("tablet");
    act(() => {
      setMatches("(max-width: 767px)", true);
    });
    expect(result.current).toBe("mobile");
  });
});
