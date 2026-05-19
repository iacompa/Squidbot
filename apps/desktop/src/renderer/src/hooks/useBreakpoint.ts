import { useEffect, useState } from "react";

export type Breakpoint = "mobile" | "tablet" | "desktop";

/**
 * Returns the current breakpoint tier based on the CSS custom properties
 * defined at :root (--bp-mobile, --bp-tablet). Subscribes to matchMedia
 * change events so the value updates exactly once per boundary crossing
 * — orders of magnitude cheaper than listening to resize.
 *
 * NOTE: the literals 767 / 1023 below are intentionally duplicated from the
 * CSS custom properties --bp-mobile (768) and --bp-tablet (1024). CSS media
 * queries cannot reference var(--...), so the values must live in two
 * places. The CSS custom properties remain the documented source of truth;
 * if you change them, update these literals to match (one px below the
 * tier boundary so "max-width" is exclusive of the next tier).
 */
export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() => compute());

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mobileQ = window.matchMedia("(max-width: 767px)");
    const tabletQ = window.matchMedia("(max-width: 1023px)");
    const update = () => setBp(compute());
    mobileQ.addEventListener("change", update);
    tabletQ.addEventListener("change", update);
    update();
    return () => {
      mobileQ.removeEventListener("change", update);
      tabletQ.removeEventListener("change", update);
    };
  }, []);

  return bp;
}

function compute(): Breakpoint {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "desktop";
  }
  if (window.matchMedia("(max-width: 767px)").matches) return "mobile";
  if (window.matchMedia("(max-width: 1023px)").matches) return "tablet";
  return "desktop";
}
