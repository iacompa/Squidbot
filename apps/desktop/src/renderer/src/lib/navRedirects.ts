import type { PageId } from "../types";

/**
 * Some pages in the codebase call onNavigate("traces") or
 * onNavigate("identity") etc. After the sidebar reorganization those PageIds
 * no longer have their own destinations — they live as tabs inside History
 * or Settings. This function translates a deprecated PageId into the new
 * { pageId, tab? } shape so callers don't have to know about the move.
 *
 * The union of `tab` is intentionally string (not a strict type) — each
 * receiving page validates its own tab values. Keeping it loose here means
 * the redirect map and the tab implementations evolve independently.
 */
export type ResolvedNav = {
  pageId: PageId;
  tab?: string;
};

export function resolveNav(pageId: PageId): ResolvedNav {
  switch (pageId) {
    case "traces":
      return { pageId: "history", tab: "activity" };
    case "memory":
      return { pageId: "history", tab: "memory" };
    case "identity":
      return { pageId: "settings", tab: "profile" };
    case "profiles":
      return { pageId: "settings", tab: "profile" };
    case "skills":
      return { pageId: "settings", tab: "skills" };
    case "governance":
      return { pageId: "settings", tab: "governance" };
    case "messaging":
      return { pageId: "integrations", tab: "messaging" };
    default:
      return { pageId };
  }
}
