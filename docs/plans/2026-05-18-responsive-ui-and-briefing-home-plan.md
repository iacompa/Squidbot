# Responsive UI + Briefing Home Screen + Web Reach — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` (or `superpowers:subagent-driven-development` from the same session) to implement this plan task-by-task.

**Goal:** Ship Phase 1 of the AI CEO roadmap: a responsive shell from 400px → 4K, a Briefing home screen as the new default landing, and a web-bundle path that lets the same React tree serve at `localhost:8080`.

**Architecture:** Three-tier breakpoint system (mobile <768px / tablet 768–1023px / desktop ≥1024px) driven by CSS custom properties + a `useBreakpoint()` hook. Hamburger drawer below 768px, icon rail on tablet, current layout on desktop. New Briefing page replaces Chat as default landing — wires real `listPendingApprovals` + `listJobs` from day one; email/calendar data deferred to Phase 2. Web bundle via Express + a new `apiTransport` abstraction that lets `window.squidbot.*` work over `ipcRenderer` (Electron) or `fetch` (browser).

**Tech Stack:** React + Vite (renderer), Electron, CSS custom properties, Playwright (visual regression + a11y), Vitest + @testing-library/react (unit), axe-core (a11y), Express (web bundle server).

**Phasing:**
- **Phase A** (10 tasks) — Foundation: breakpoint CSS, hooks, drawer state, body scroll lock, prefers-reduced-motion.
- **Phase B** (5 tasks) — Briefing home screen + routing changes.
- **Phase C** (8 tasks) — Per-page responsive audit across the 14 pages.
- **Phase D** (5 tasks) — Web bundle path.
- **Phase E** (5 tasks) — Test infrastructure: visual regression, touch-target audit, axe-core, aggregated runner.
- **Final**: visual baseline capture + acceptance smoke.

**Conventions:**
- Commit messages use this repo's imperative style (`add-X` / `update-Y` / `fix-Z`) — never Conventional Commits.
- TDD: failing test → run-to-see-fail → implement → run-to-see-pass → commit. For CSS-only tasks, the "test" is a Playwright snapshot or axe scan; commit *after* the test passes.
- Each task self-contained; subagents executing this plan should re-read the design doc (`docs/plans/2026-05-18-responsive-ui-and-briefing-home-design.md`) once at start, especially Section 9's 52-checkbox acceptance criteria.
- Working directory: `~/Projects/SquidBot 2/.claude/worktrees/frosty-williamson-817c25`
- Branch: `claude/frosty-williamson-817c25` (worktree — safe to commit directly).

---

# Phase A — Foundation (responsive shell)

### Task A.1: Add CSS breakpoint custom properties + rewrite ad-hoc media queries

**Why first:** Every other task references `--bp-mobile` and `--bp-tablet`. Without this, each task would invent its own breakpoint and we'd have the same scattered-queries problem we started with.

**Files:**
- Modify: `apps/desktop/src/renderer/src/styles/app.css:1-30` (add custom properties to `:root`)
- Modify: `apps/desktop/src/renderer/src/styles/app.css` (rewrite the 5 existing `@media (max-width:` queries at lines 1623, 2873, 2937, 3355, 3523)

**Step 1: Add custom properties to `:root`**

Insert into the `:root` block at top of `app.css` (currently ends around line 18):

```css
  /* Breakpoint custom properties — referenced by every media query in this file. */
  --bp-mobile: 768px;
  --bp-tablet: 1024px;
```

**Step 2: Update body min-width**

Change `min-width: 320px` at `body { min-width: 320px; ... }` to `min-width: 360px` (modern smallest-phone target — iPhone SE is 375px wide; 360 gives a small buffer).

**Step 3: Audit existing media queries**

Run: `grep -n "@media" apps/desktop/src/renderer/src/styles/app.css`

Expected 5 hits at lines 1623 (860px), 2873 (900px), 2937 (700px), 3355 (700px), 3523 (800px). For each:

- 860px → change to `1023px` (tablet boundary).
- 900px → change to `1023px` (same).
- 700px → change to `767px` (mobile boundary).
- 800px → change to `767px` (mobile boundary).

Use exact replace: `@media (max-width: 860px)` → `@media (max-width: 1023px)`, etc.

**Step 4: Visual check**

Run: `npm run dev` and resize the Electron window between 1024px and 1023px (the tablet boundary). The layout should transition cleanly. Then between 768px and 767px (the mobile boundary).

Note: full responsive behavior comes in later tasks; this task just ensures the breakpoint values align.

**Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/styles/app.css
git commit -m "add-breakpoint-custom-properties-and-align-existing-queries

--bp-mobile (768) and --bp-tablet (1024) at :root. Rewrites the 5
ad-hoc media queries at 700/800/860/900 to align with the new
tier boundaries (mobile <768, tablet 768-1023, desktop >=1024).
body min-width bumped to 360 to accept the smallest modern phone
viewport (iPhone SE = 375)."
```

---

### Task A.2: `useBreakpoint()` hook

**Files:**
- Create: `apps/desktop/src/renderer/src/hooks/useBreakpoint.ts`
- Create: `apps/desktop/src/renderer/src/hooks/useBreakpoint.test.ts`

**Step 1: Write the failing test**

```typescript
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
```

**Step 2: Run the test — expect FAIL**

Run: `npm test --workspace=@squidbot/desktop -- useBreakpoint`
Expected: module not found.

**Step 3: Implement the hook**

Create `apps/desktop/src/renderer/src/hooks/useBreakpoint.ts`:

```typescript
import { useEffect, useState } from "react";

export type Breakpoint = "mobile" | "tablet" | "desktop";

/**
 * Returns the current breakpoint tier based on the CSS custom properties
 * defined at :root (--bp-mobile, --bp-tablet). Subscribes to matchMedia
 * change events so the value updates exactly once per boundary crossing
 * — orders of magnitude cheaper than listening to resize.
 */
export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() => compute());

  useEffect(() => {
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
```

**Step 4: Run the test — expect PASS**

Run: `npm test --workspace=@squidbot/desktop -- useBreakpoint`
Expected: 4 tests pass.

**Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/hooks/useBreakpoint.ts apps/desktop/src/renderer/src/hooks/useBreakpoint.test.ts
git commit -m "add-use-breakpoint-hook

Returns 'mobile' | 'tablet' | 'desktop' based on matchMedia queries
against the breakpoint custom properties. Subscribes to change events
(not resize polling), updates exactly once per boundary crossing."
```

---

### Task A.3: `useFocusTrap()` hook

**Files:**
- Create: `apps/desktop/src/renderer/src/hooks/useFocusTrap.ts`
- Create: `apps/desktop/src/renderer/src/hooks/useFocusTrap.test.ts`

**Step 1: Write the failing test**

```typescript
// @vitest-environment jsdom

import { fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { useFocusTrap } from "./useFocusTrap";

function Trapped({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, active);
  return (
    <div>
      <button data-testid="outside-before">outside-before</button>
      <div ref={ref} data-testid="container">
        <button data-testid="inside-first">first</button>
        <button data-testid="inside-last">last</button>
      </div>
      <button data-testid="outside-after">outside-after</button>
    </div>
  );
}

describe("useFocusTrap", () => {
  it("cycles Tab from last back to first when active", () => {
    const { getByTestId } = render(<Trapped active={true} />);
    const first = getByTestId("inside-first");
    const last = getByTestId("inside-last");

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("cycles Shift+Tab from first back to last when active", () => {
    const { getByTestId } = render(<Trapped active={true} />);
    const first = getByTestId("inside-first");
    const last = getByTestId("inside-last");

    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("does not interfere when inactive", () => {
    const { getByTestId } = render(<Trapped active={false} />);
    const last = getByTestId("inside-last");
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    // browser's default tab order would move on — jsdom doesn't simulate it,
    // but at minimum the focus shouldn't return to inside-first.
    expect(document.activeElement).not.toBe(getByTestId("inside-first"));
  });
});
```

**Step 2: Run — expect FAIL**

Run: `npm test --workspace=@squidbot/desktop -- useFocusTrap`
Expected: module not found.

**Step 3: Implement**

Create `apps/desktop/src/renderer/src/hooks/useFocusTrap.ts`:

```typescript
import type { RefObject } from "react";
import { useEffect } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], area[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps Tab/Shift+Tab focus inside the ref'd element while `active` is true.
 * Cheap, in-house implementation — no library dependency. Use for the
 * mobile drawer so that opening it keeps keyboard focus inside the drawer.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active || !ref.current) return;
    const container = ref.current;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Tab") return;
      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;

      if (event.shiftKey && (activeEl === first || !container.contains(activeEl))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeEl === last || !container.contains(activeEl))) {
        event.preventDefault();
        first.focus();
      }
    }

    container.addEventListener("keydown", onKeyDown);
    return () => container.removeEventListener("keydown", onKeyDown);
  }, [ref, active]);
}
```

**Step 4: Run — expect PASS**

Run: `npm test --workspace=@squidbot/desktop -- useFocusTrap`
Expected: 3 tests pass.

**Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/hooks/useFocusTrap.ts apps/desktop/src/renderer/src/hooks/useFocusTrap.test.ts
git commit -m "add-use-focus-trap-hook

Cycles Tab/Shift+Tab focus inside a ref'd container while active.
In-house implementation (~30 lines) — no library dep. Used by the
mobile drawer so opening it keeps keyboard focus inside."
```

---

### Task A.4: `BurgerButton` component

**Files:**
- Create: `apps/desktop/src/renderer/src/components/BurgerButton.tsx`
- Create: `apps/desktop/src/renderer/src/components/BurgerButton.test.tsx`

**Step 1: Write the failing test**

```typescript
// @vitest-environment jsdom

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BurgerButton } from "./BurgerButton";

describe("BurgerButton", () => {
  it("calls onClick when tapped", () => {
    const fn = vi.fn();
    const { getByRole } = render(<BurgerButton onClick={fn} expanded={false} />);
    fireEvent.click(getByRole("button"));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("renders with aria-label 'Open navigation' when collapsed", () => {
    const { getByRole } = render(<BurgerButton onClick={() => {}} expanded={false} />);
    expect(getByRole("button").getAttribute("aria-label")).toBe("Open navigation");
  });

  it("renders with aria-label 'Close navigation' when expanded", () => {
    const { getByRole } = render(<BurgerButton onClick={() => {}} expanded={true} />);
    expect(getByRole("button").getAttribute("aria-label")).toBe("Close navigation");
  });

  it("renders with aria-expanded matching prop", () => {
    const { getByRole, rerender } = render(<BurgerButton onClick={() => {}} expanded={false} />);
    expect(getByRole("button").getAttribute("aria-expanded")).toBe("false");
    rerender(<BurgerButton onClick={() => {}} expanded={true} />);
    expect(getByRole("button").getAttribute("aria-expanded")).toBe("true");
  });
});
```

**Step 2: Run — expect FAIL**

Run: `npm test --workspace=@squidbot/desktop -- BurgerButton`

**Step 3: Implement**

Create `apps/desktop/src/renderer/src/components/BurgerButton.tsx`:

```typescript
import { Menu, X } from "lucide-react";

type BurgerButtonProps = {
  onClick: () => void;
  expanded: boolean;
};

/**
 * Mobile hamburger button. Rendered only at width < --bp-mobile.
 * Hides on tablet+ via CSS (display: none).
 */
export function BurgerButton({ onClick, expanded }: BurgerButtonProps) {
  return (
    <button
      type="button"
      className="burger-button"
      onClick={onClick}
      aria-label={expanded ? "Close navigation" : "Open navigation"}
      aria-expanded={expanded}
    >
      {expanded ? <X size={22} aria-hidden /> : <Menu size={22} aria-hidden />}
    </button>
  );
}
```

**Step 4: Add CSS for the burger button**

Append to `apps/desktop/src/renderer/src/styles/app.css`:

```css
.burger-button {
  display: none;
  background: transparent;
  border: 0;
  padding: 10px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--ink);
  min-block-size: 44px;
  min-inline-size: 44px;
}

.burger-button:hover {
  background: var(--surface-2);
}

@media (max-width: 767px) {
  .burger-button { display: inline-flex; align-items: center; justify-content: center; }
}
```

**Step 5: Run — expect PASS**

Run: `npm test --workspace=@squidbot/desktop -- BurgerButton`
Expected: 4 tests pass.

**Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/components/BurgerButton.tsx apps/desktop/src/renderer/src/components/BurgerButton.test.tsx apps/desktop/src/renderer/src/styles/app.css
git commit -m "add-burger-button-component

Hidden on tablet+, visible below --bp-mobile. 44x44 minimum hit
target. aria-label and aria-expanded reflect open/closed state."
```

---

### Task A.5: `MobileNavBackdrop` component

**Files:**
- Create: `apps/desktop/src/renderer/src/components/MobileNavBackdrop.tsx`
- Create: `apps/desktop/src/renderer/src/components/MobileNavBackdrop.test.tsx`

**Step 1: Write the failing test**

```typescript
// @vitest-environment jsdom

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MobileNavBackdrop } from "./MobileNavBackdrop";

describe("MobileNavBackdrop", () => {
  it("renders nothing when not visible", () => {
    const { container } = render(<MobileNavBackdrop visible={false} onClose={() => {}} />);
    expect(container.querySelector(".mobile-nav-backdrop")).toBeNull();
  });

  it("renders backdrop element when visible", () => {
    const { container } = render(<MobileNavBackdrop visible={true} onClose={() => {}} />);
    expect(container.querySelector(".mobile-nav-backdrop")).not.toBeNull();
  });

  it("calls onClose when tapped", () => {
    const fn = vi.fn();
    const { container } = render(<MobileNavBackdrop visible={true} onClose={fn} />);
    fireEvent.click(container.querySelector(".mobile-nav-backdrop")!);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("has aria-hidden true (decorative)", () => {
    const { container } = render(<MobileNavBackdrop visible={true} onClose={() => {}} />);
    expect(container.querySelector(".mobile-nav-backdrop")!.getAttribute("aria-hidden")).toBe("true");
  });
});
```

**Step 2: Run — expect FAIL**

Run: `npm test --workspace=@squidbot/desktop -- MobileNavBackdrop`

**Step 3: Implement**

Create `apps/desktop/src/renderer/src/components/MobileNavBackdrop.tsx`:

```typescript
type MobileNavBackdropProps = {
  visible: boolean;
  onClose: () => void;
};

/**
 * Translucent overlay that fades in when the mobile drawer is open.
 * Clicking it closes the drawer. Decorative — the burger button is
 * the accessible control.
 */
export function MobileNavBackdrop({ visible, onClose }: MobileNavBackdropProps) {
  if (!visible) return null;
  return (
    <div
      className="mobile-nav-backdrop"
      aria-hidden="true"
      onClick={onClose}
    />
  );
}
```

**Step 4: Add CSS**

Append to `apps/desktop/src/renderer/src/styles/app.css`:

```css
.mobile-nav-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 22, 21, 0.55);
  z-index: 99;
  opacity: 1;
  transition: opacity 200ms ease;
}

@media (min-width: 768px) {
  .mobile-nav-backdrop { display: none; }
}
```

**Step 5: Run — expect PASS**

Run: `npm test --workspace=@squidbot/desktop -- MobileNavBackdrop`
Expected: 4 tests pass.

**Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/components/MobileNavBackdrop.tsx apps/desktop/src/renderer/src/components/MobileNavBackdrop.test.tsx apps/desktop/src/renderer/src/styles/app.css
git commit -m "add-mobile-nav-backdrop-component

Renders only when visible=true. Tapping the backdrop calls onClose.
Hidden on tablet+ via CSS. aria-hidden so screen readers skip it."
```

---

### Task A.6: Wire drawer state into App.tsx

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/app.css` (drawer transform rules)
- Modify: `apps/desktop/src/renderer/src/App.test.tsx` (if it exists; verify)

**Step 1: Read App.tsx around line 60-120 to understand current structure**

Run: `head -125 apps/desktop/src/renderer/src/App.tsx`

Note where state is declared, where the shell renders, where the sidebar is.

**Step 2: Write the failing test**

Append to `apps/desktop/src/renderer/src/App.test.tsx` (or create if missing):

```typescript
// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Use the existing in-file mockMatchMedia pattern, OR if absent define
// a shim inline. We need to simulate mobile breakpoint to assert burger
// visibility + drawer behavior.

function mockSquidbotApi() {
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: {
      // Minimal IPC stub; tests touch only listModelAccounts + getProviderPresets
      listModelAccounts: vi.fn(async () => ({ accounts: [], activeAccountName: null })),
      getProviderPresets: vi.fn(async () => []),
      listPendingApprovals: vi.fn(async () => []),
      listJobs: vi.fn(async () => ({ items: [], total: 0 })),
      getSettings: vi.fn(async () => ({ connectors: [], connectorSettings: {}, dataPath: "/tmp" })),
      listTraces: vi.fn(async () => []),
      getIdentityReport: vi.fn(async () => ({ profile: null })),
      // Plus any other IPCs the initial mount calls; mock as no-ops.
    }
  });
}

afterEach(() => cleanup());

describe("App shell drawer", () => {
  it("renders burger button visible markup", async () => {
    mockSquidbotApi();
    const { App } = await import("./App");
    const { container } = render(<App />);
    expect(container.querySelector(".burger-button")).not.toBeNull();
  });

  it("toggles nav-open class on .app-shell when burger is tapped", async () => {
    mockSquidbotApi();
    const { App } = await import("./App");
    const { container } = render(<App />);
    const shell = container.querySelector(".app-shell")!;
    expect(shell.classList.contains("nav-open")).toBe(false);
    fireEvent.click(container.querySelector(".burger-button")!);
    expect(shell.classList.contains("nav-open")).toBe(true);
  });

  it("closes drawer when backdrop is tapped", async () => {
    mockSquidbotApi();
    const { App } = await import("./App");
    const { container } = render(<App />);
    fireEvent.click(container.querySelector(".burger-button")!);
    expect(container.querySelector(".app-shell")!.classList.contains("nav-open")).toBe(true);
    fireEvent.click(container.querySelector(".mobile-nav-backdrop")!);
    expect(container.querySelector(".app-shell")!.classList.contains("nav-open")).toBe(false);
  });

  it("closes drawer when Escape is pressed", async () => {
    mockSquidbotApi();
    const { App } = await import("./App");
    const { container } = render(<App />);
    fireEvent.click(container.querySelector(".burger-button")!);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.querySelector(".app-shell")!.classList.contains("nav-open")).toBe(false);
  });
});
```

**Step 3: Run — expect FAIL**

Run: `npm test --workspace=@squidbot/desktop -- App`

**Step 4: Modify `App.tsx`**

Add at the top of imports:

```typescript
import { BurgerButton } from "./components/BurgerButton";
import { MobileNavBackdrop } from "./components/MobileNavBackdrop";
import { useBreakpoint } from "./hooks/useBreakpoint";
```

Inside the App component, after the existing `useState` declarations, add:

```typescript
const [isMobileNavOpen, setMobileNavOpen] = useState(false);
const breakpoint = useBreakpoint();

// Auto-close drawer when window grows past mobile.
useEffect(() => {
  if (breakpoint !== "mobile" && isMobileNavOpen) {
    setMobileNavOpen(false);
  }
}, [breakpoint, isMobileNavOpen]);

// Close drawer on Escape.
useEffect(() => {
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape" && isMobileNavOpen) setMobileNavOpen(false);
  }
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}, [isMobileNavOpen]);
```

Modify the rendered `.app-shell` element to include the new className and data attribute:

```tsx
<div
  className={`app-shell${isMobileNavOpen ? " nav-open" : ""}`}
  data-bp={breakpoint}
>
  {/* ... sidebar ... */}
  {/* In the page header (find the existing header element): */}
  <BurgerButton
    onClick={() => setMobileNavOpen((v) => !v)}
    expanded={isMobileNavOpen}
  />
  {/* ... main content ... */}
  <MobileNavBackdrop
    visible={isMobileNavOpen}
    onClose={() => setMobileNavOpen(false)}
  />
</div>
```

The exact location of the `<BurgerButton>` depends on the existing header markup — it should sit at the start of the page header element (typically in the `<main>` or `<header>` inside `.page-panel`). Locate the existing header and put the burger button as its first child.

Auto-close on route change: in the existing `handleNavigate` function (around line 108), add `setMobileNavOpen(false);` as the first line.

**Step 5: Add drawer CSS**

Append to `apps/desktop/src/renderer/src/styles/app.css`:

```css
/* Mobile drawer behavior — sidebar slides off-canvas below --bp-mobile,
   slides back in when .app-shell has .nav-open. Desktop/tablet unaffected. */
@media (max-width: 767px) {
  .app-shell { grid-template-columns: 1fr; }
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: min(280px, 80vw);
    transform: translateX(-100%);
    transition: transform 200ms ease;
    z-index: 100;
    box-shadow: 0 0 24px rgba(0, 0, 0, 0.2);
  }
  .app-shell.nav-open .sidebar {
    transform: translateX(0);
  }
  body.no-scroll {
    overflow: hidden;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sidebar, .mobile-nav-backdrop { transition-duration: 0ms !important; }
}
```

**Step 6: Run — expect PASS**

Run: `npm test --workspace=@squidbot/desktop -- App`
Expected: 4 tests pass + existing App tests still pass.

**Step 7: Commit**

```bash
git add apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/App.test.tsx apps/desktop/src/renderer/src/styles/app.css
git commit -m "wire-mobile-drawer-state-into-app-shell

isMobileNavOpen state in App.tsx. Burger button toggles. Backdrop
tap, Escape key, route change, and resize past 768px all close the
drawer. .nav-open class on .app-shell triggers transform animation.
prefers-reduced-motion suppresses animation."
```

---

### Task A.7: Body scroll lock when drawer open

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx` (add useEffect for body scroll lock)
- Modify: `apps/desktop/src/renderer/src/App.test.tsx` (test for it)

**Step 1: Write the failing test**

Add to App.test.tsx (inside the existing describe block):

```typescript
it("adds no-scroll class to body when drawer opens, removes on close", async () => {
  mockSquidbotApi();
  const { App } = await import("./App");
  const { container } = render(<App />);
  expect(document.body.classList.contains("no-scroll")).toBe(false);
  fireEvent.click(container.querySelector(".burger-button")!);
  expect(document.body.classList.contains("no-scroll")).toBe(true);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(document.body.classList.contains("no-scroll")).toBe(false);
});
```

**Step 2: Run — expect FAIL**

Run: `npm test --workspace=@squidbot/desktop -- App`

**Step 3: Implement**

In `App.tsx`, add the effect:

```typescript
useEffect(() => {
  if (isMobileNavOpen) {
    document.body.classList.add("no-scroll");
    return () => document.body.classList.remove("no-scroll");
  }
}, [isMobileNavOpen]);
```

**Step 4: Run — expect PASS**

**Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/App.test.tsx
git commit -m "add-body-scroll-lock-when-drawer-open

Toggles .no-scroll on body whenever the mobile drawer is open.
Prevents page-behind scrolling when user opens the drawer."
```

---

### Task A.8: Visual smoke (manual) — verify drawer end-to-end

**Files:** None (manual verification).

**Step 1: Boot the app**

```bash
npm run dev
```

**Step 2: Resize to ~400px wide**

- Burger button should appear in the header.
- Sidebar should disappear from view (slid off-canvas).
- Page content takes full width.

**Step 3: Tap burger**

- Drawer slides in from the left over the content.
- Backdrop fades in behind it.
- Body cannot be scrolled (test by trying to scroll the page-behind).

**Step 4: Tap backdrop**

- Drawer slides out.
- Backdrop fades out.

**Step 5: Tap burger → tap a sidebar nav item**

- Drawer closes BEFORE the route changes (no flash of the drawer over the new page).

**Step 6: Tap burger → press Escape**

- Drawer closes.

**Step 7: Resize from 400px → 1200px while drawer is open**

- Drawer closes automatically; desktop sidebar reappears.

**Step 8: Commit nothing — this is a smoke check.**

If any step fails, return to the relevant task (A.4, A.5, A.6, A.7).

---

# Phase B — Briefing home screen

### Task B.1: Add "briefing" to PageId + create BriefingPage skeleton

**Files:**
- Modify: `apps/desktop/src/renderer/src/types.ts` (add 'briefing' to PageId union)
- Create: `apps/desktop/src/renderer/src/pages/BriefingPage.tsx`
- Create: `apps/desktop/src/renderer/src/pages/BriefingPage.test.tsx`

**Step 1: Read existing PageId union**

Run: `grep "PageId" apps/desktop/src/renderer/src/types.ts | head -5`

**Step 2: Add 'briefing' to the union**

Modify the line that defines `export type PageId = ...`. Add `"briefing" |` as the first option.

**Step 3: Write the failing test**

Create `apps/desktop/src/renderer/src/pages/BriefingPage.test.tsx`:

```typescript
// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

function mountApi(overrides: {
  approvals?: unknown[];
  jobs?: { items: unknown[]; total: number };
} = {}) {
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: {
      listPendingApprovals: vi.fn(async () => overrides.approvals ?? []),
      listJobs: vi.fn(async () => overrides.jobs ?? { items: [], total: 0 })
    }
  });
}

afterEach(() => cleanup());

describe("BriefingPage", () => {
  it("renders three-column briefing layout", async () => {
    mountApi();
    const { BriefingPage } = await import("./BriefingPage");
    const { container } = render(<BriefingPage onNavigate={() => {}} />);
    expect(container.querySelector(".briefing-grid")).not.toBeNull();
    expect(screen.getByText(/Overnight/i)).toBeInTheDocument();
    expect(screen.getByText(/Needs you/i)).toBeInTheDocument();
    expect(screen.getByText(/Today's plan/i)).toBeInTheDocument();
  });

  it("shows pending approvals count from listPendingApprovals", async () => {
    mountApi({ approvals: [{ id: "1" }, { id: "2" }, { id: "3" }] });
    const { BriefingPage } = await import("./BriefingPage");
    render(<BriefingPage onNavigate={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("3 approvals pending")).toBeInTheDocument();
    });
  });

  it("shows running jobs count from listJobs", async () => {
    mountApi({ jobs: { items: [{ id: "j1" }, { id: "j2" }], total: 2 } });
    const { BriefingPage } = await import("./BriefingPage");
    render(<BriefingPage onNavigate={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/Running jobs \(2\)/)).toBeInTheDocument();
    });
  });

  it("renders placeholders for Phase 2 sections", async () => {
    mountApi();
    const { BriefingPage } = await import("./BriefingPage");
    render(<BriefingPage onNavigate={() => {}} />);
    await waitFor(() => {
      // Phase 2 wires email/calendar; for now show em-dash placeholders.
      expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    });
  });
});
```

**Step 4: Run — expect FAIL**

Run: `npm test --workspace=@squidbot/desktop -- BriefingPage`

**Step 5: Implement BriefingPage**

Create `apps/desktop/src/renderer/src/pages/BriefingPage.tsx`:

```typescript
import { useEffect, useState } from "react";
import { ArrowRight, Inbox, CalendarDays, ClipboardCheck, PlayCircle, MessageSquare } from "lucide-react";
import { squidbotApi } from "../lib/api";
import type { PageId } from "../types";

type BriefingPageProps = {
  onNavigate: (pageId: PageId) => void;
};

/**
 * The default landing page — frames SquidBot as the user's AI CEO.
 * Three columns: what was handled overnight, what needs the founder's
 * attention, what's planned for today. Plus a strip of running jobs
 * and quick action buttons.
 *
 * Phase 1 ships the layout + the two real counters that come from
 * existing IPCs (pending approvals, running jobs). Phase 2 wires the
 * email/calendar/financial data into the other slots.
 */
export function BriefingPage({ onNavigate }: BriefingPageProps) {
  const [approvalsCount, setApprovalsCount] = useState<number | null>(null);
  const [jobsCount, setJobsCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      squidbotApi.listPendingApprovals(),
      squidbotApi.listJobs({ status: "active" }).catch(() => ({ items: [], total: 0 }))
    ]).then(([approvals, jobs]) => {
      if (cancelled) return;
      setApprovalsCount(approvals.length);
      // listJobs may return either array or { items, total } shape
      const items = Array.isArray(jobs) ? jobs : jobs.items;
      setJobsCount(items.length);
    });
    return () => { cancelled = true; };
  }, []);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric"
  });

  return (
    <main className="page-panel briefing-page" aria-label="Briefing">
      <header className="page-header briefing-header">
        <p className="section-label">Today, {today}</p>
        <h2>Good morning. Here's what's on your plate.</h2>
        <p className="page-subtitle">
          Your AI CEO's overnight activity, what needs you, and what's planned next.
        </p>
      </header>

      <div className="briefing-grid">
        <section className="briefing-card">
          <h3><Inbox size={16} aria-hidden /> Overnight</h3>
          <ul className="briefing-list">
            <li><strong>—</strong> emails triaged</li>
            <li><strong>—</strong> drafts ready</li>
            <li><strong>—</strong> auto-replies sent</li>
          </ul>
          <button className="ghost-button" onClick={() => onNavigate("messaging" as PageId)}>
            Open inbox <ArrowRight size={14} aria-hidden />
          </button>
        </section>

        <section className="briefing-card">
          <h3><ClipboardCheck size={16} aria-hidden /> Needs you</h3>
          <ul className="briefing-list">
            <li>
              <strong>{approvalsCount ?? "—"}</strong> approvals pending
            </li>
          </ul>
          <button className="ghost-button" onClick={() => onNavigate("approvals" as PageId)}>
            Open approvals <ArrowRight size={14} aria-hidden />
          </button>
        </section>

        <section className="briefing-card">
          <h3><CalendarDays size={16} aria-hidden /> Today's plan</h3>
          <ul className="briefing-list">
            <li><strong>—</strong> meetings scheduled</li>
            <li><strong>—</strong> tasks queued</li>
          </ul>
          <button className="ghost-button" onClick={() => onNavigate("jobs" as PageId)}>
            Open jobs <ArrowRight size={14} aria-hidden />
          </button>
        </section>
      </div>

      <section className="briefing-jobs">
        <h3><PlayCircle size={16} aria-hidden /> Running jobs ({jobsCount ?? "—"})</h3>
        <p className="muted">
          Scheduled tasks your AI CEO is running on a cadence. Open Jobs to see details.
        </p>
        <button className="secondary-button" onClick={() => onNavigate("jobs" as PageId)}>
          Open jobs
        </button>
      </section>

      <section className="briefing-actions">
        <button className="primary-button" onClick={() => onNavigate("chat" as PageId)}>
          <MessageSquare size={14} aria-hidden /> Open chat
        </button>
        <button className="ghost-button" onClick={() => onNavigate("history" as PageId)}>
          View audit log
        </button>
      </section>
    </main>
  );
}
```

**Step 6: Add CSS**

Append to `app.css`:

```css
.briefing-page { display: flex; flex-direction: column; gap: 24px; }
.briefing-header h2 { font-size: clamp(20px, 4vw, 28px); }
.briefing-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.briefing-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.briefing-card h3 {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
}
.briefing-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
.briefing-list strong { font-size: 22px; }
.briefing-jobs, .briefing-actions {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 18px;
}
.briefing-actions { display: flex; gap: 12px; flex-wrap: wrap; }

@media (max-width: 1023px) {
  .briefing-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 767px) {
  .briefing-grid { grid-template-columns: 1fr; }
  .briefing-actions { flex-direction: column; align-items: stretch; }
  .briefing-actions button { width: 100%; }
}
```

**Step 7: Run — expect PASS**

Run: `npm test --workspace=@squidbot/desktop -- BriefingPage`
Expected: 4 tests pass.

**Step 8: Commit**

```bash
git add apps/desktop/src/renderer/src/types.ts apps/desktop/src/renderer/src/pages/BriefingPage.tsx apps/desktop/src/renderer/src/pages/BriefingPage.test.tsx apps/desktop/src/renderer/src/styles/app.css
git commit -m "add-briefing-page-with-real-approvals-and-jobs-counters

Default landing page that frames SquidBot as the user's AI CEO.
Three columns (Overnight / Needs you / Today's plan) plus running
jobs and quick actions. Pending approvals + running jobs counters
use existing IPCs so the page is useful day one. Other slots show
em-dash placeholders for Phase 2 to fill (email/calendar/financial).
Responsive: 3-col on desktop, 2-col tablet, 1-col mobile."
```

---

### Task B.2: Make Briefing the default landing route

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/App.test.tsx`

**Step 1: Write the failing test**

Add to App.test.tsx:

```typescript
it("renders BriefingPage as the default landing", async () => {
  mockSquidbotApi();
  const { App } = await import("./App");
  const { container } = render(<App />);
  expect(container.querySelector(".briefing-page")).not.toBeNull();
});
```

**Step 2: Run — expect FAIL**

**Step 3: Modify App.tsx**

Find the existing `useState<PageId>("chat")` and change to `useState<PageId>("briefing")`.

Find the page-routing switch (the block that decides which page to render based on `activePage`). Add:

```tsx
{activePage === "briefing" && <BriefingPage onNavigate={handleNavigate} />}
```

Import:

```typescript
import { BriefingPage } from "./pages/BriefingPage";
```

**Step 4: Add "Briefing" nav item**

Find the existing `nav: NavItem[] = [...]` (or similar — the sidebar nav array). Add as the FIRST item:

```typescript
{ id: "briefing", label: "Briefing", icon: Sunrise },
```

Import: `import { Sunrise } from "lucide-react";`

**Step 5: Run — expect PASS**

Run: `npm test --workspace=@squidbot/desktop -- App`

**Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/App.test.tsx
git commit -m "make-briefing-the-default-landing-route

App initial state is 'briefing' instead of 'chat'. Sidebar gains
a new 'Briefing' nav item at the top. Chat stays accessible via
sidebar + the briefing's 'Open chat' button."
```

---

### Task B.3: Update onboarding redirect

**Files:**
- Modify: `apps/desktop/src/renderer/src/pages/OnboardingPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/OnboardingPage.test.tsx`

**Step 1: Locate the redirect-after-onboarding logic**

Run: `grep -n "onNavigate\|setActivePage\|onComplete" apps/desktop/src/renderer/src/pages/OnboardingPage.tsx | head -10`

Find the line that fires after onboarding completes (likely calls `onNavigate("chat")` or similar).

**Step 2: Write the failing test**

Find a place in `OnboardingPage.test.tsx` that asserts the post-onboarding navigation. If the test asserts navigation to "chat", change the expected value to "briefing".

**Step 3: Run — expect FAIL**

Run: `npm test --workspace=@squidbot/desktop -- OnboardingPage`

**Step 4: Update the redirect**

Change `onNavigate("chat")` (or equivalent) to `onNavigate("briefing")`.

**Step 5: Run — expect PASS**

**Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/pages/OnboardingPage.tsx apps/desktop/src/renderer/src/pages/OnboardingPage.test.tsx
git commit -m "redirect-onboarding-completion-to-briefing-not-chat

After the first model account is saved, the user lands on Briefing
(the new default) instead of Chat — matching the new home-screen
identity as 'your AI CEO'."
```

---

### Task B.4: Navigation smoke test for briefing route

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.smoke.test.tsx` (or create — check if one exists)

**Step 1: Check if navigation smoke test exists**

Run: `find apps/desktop/src/renderer/src -name "*smoke*" -o -name "*nav*test*" | head -5`

If a navigation smoke test exists (it does — `navRedirects.test.ts`), check that it includes Briefing in its asserted pages.

**Step 2: Verify Briefing is included**

Read the file and confirm "briefing" is in the list of PageIds tested. If not, add it.

**Step 3: Run the navigation smoke**

```bash
npm test --workspace=@squidbot/desktop -- navRedirects
```

Expected: PASS.

**Step 4: Commit (only if changes were made)**

If `navRedirects.test.ts` needed an update, commit:

```bash
git add apps/desktop/src/renderer/src/lib/navRedirects.test.ts
git commit -m "extend-nav-smoke-test-to-include-briefing-page"
```

---

# Phase C — Per-page responsive audit

Phase C is a series of small, page-specific CSS adjustments. Each task targets one page or one shared pattern. Run after each task: `npm test --workspace=@squidbot/desktop` to confirm no regressions.

### Task C.1: TrustPage, IdentityPage, GovernancePage multi-column grids collapse

**Files:**
- Modify: `apps/desktop/src/renderer/src/styles/app.css`

**Step 1: Find the relevant grid rules**

Run: `grep -n "grid-template-columns: repeat(4" apps/desktop/src/renderer/src/styles/app.css`

Expected: hits at lines 426, 707, plus possibly others. Identify which rule belongs to which page by reading 5 lines of context above each.

**Step 2: For each `repeat(4, ...)` rule, add tablet + mobile collapses**

After each existing rule that uses `grid-template-columns: repeat(4, minmax(0, 1fr));` (or similar), add:

```css
@media (max-width: 1023px) {
  .same-selector-as-above { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 767px) {
  .same-selector-as-above { grid-template-columns: 1fr; }
}
```

Use the same selector as the original rule (e.g., `.trust-cards`, `.identity-stats`, `.governance-tiles`).

**Step 3: Visual check**

Run: `npm run dev`, navigate to Trust, Identity, Governance pages, resize between 1440px, 900px, 500px. Verify grids collapse 4 → 2 → 1.

**Step 4: Run existing tests**

```bash
npm test --workspace=@squidbot/desktop
```

Expected: no regressions.

**Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/styles/app.css
git commit -m "collapse-trust-identity-governance-multi-column-grids

repeat(4, 1fr) becomes repeat(2, 1fr) at tablet, 1fr at mobile.
Stats / trust cards / governance tiles all stack cleanly on small
windows instead of overflowing."
```

---

### Task C.2: HistoryPage 2-pane stack

**Files:**
- Modify: `apps/desktop/src/renderer/src/styles/app.css`

**Step 1: Find the HistoryPage 2-pane rule**

Run: `grep -n "grid-template-columns: minmax(540" apps/desktop/src/renderer/src/styles/app.css`

Expected: one hit (around line 625).

**Step 2: Add collapse rules**

After the existing rule, add:

```css
@media (max-width: 1023px) {
  .same-selector { grid-template-columns: 1fr; }
}
```

**Step 3: Commit**

```bash
git add apps/desktop/src/renderer/src/styles/app.css
git commit -m "stack-history-page-two-pane-below-1024px

Min(540px) left + 1.4fr right collapses to single column on tablet
and below. The two panes stack vertically when there isn't room
for both."
```

---

### Task C.3: SettingsPage tab rail reflow

**Files:**
- Modify: `apps/desktop/src/renderer/src/styles/app.css`
- Verify: `apps/desktop/src/renderer/src/pages/SettingsPage.tsx`

**Step 1: Find the settings tab rail**

Run: `grep -n "grid-template-columns: 90px" apps/desktop/src/renderer/src/styles/app.css`

Expected: one hit (around line 255) for `.settings-rail` or similar.

**Step 2: Add mobile rules — reflow to horizontal scroll**

After the existing rule, add:

```css
@media (max-width: 767px) {
  .settings-rail { grid-template-columns: 1fr; }
  .settings-rail__tabs {
    display: flex;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    gap: 4px;
    padding-bottom: 8px;
    -webkit-overflow-scrolling: touch;
  }
  .settings-rail__tabs button {
    flex: 0 0 auto;
    scroll-snap-align: start;
    min-block-size: 44px;
    min-inline-size: max-content;
  }
}
```

Adjust selectors to match the actual settings rail class names (read the SettingsPage component if uncertain).

**Step 3: Commit**

```bash
git add apps/desktop/src/renderer/src/styles/app.css
git commit -m "reflow-settings-tab-rail-to-horizontal-scroll-on-mobile

Below 768px the 90px-wide left tab rail collapses into a top-row
horizontal scroller with snap-to-tab behavior. Tab buttons hit
44x44 minimums for touch."
```

---

### Task C.4: IntegrationsPage + HistoryPage top tab bars horizontal scroll

**Files:**
- Modify: `apps/desktop/src/renderer/src/styles/app.css`

**Step 1: Locate the tab bar classes**

Run: `grep -n "integrations-tabs\|history-tabs" apps/desktop/src/renderer/src/styles/app.css`

**Step 2: Add mobile scroll rules**

```css
@media (max-width: 767px) {
  .integrations-tabs, .history-tabs {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scroll-snap-type: x mandatory;
  }
  .integrations-tabs button, .history-tabs button {
    flex: 0 0 auto;
    scroll-snap-align: start;
    min-block-size: 44px;
    min-inline-size: max-content;
  }
}
```

**Step 3: Commit**

```bash
git add apps/desktop/src/renderer/src/styles/app.css
git commit -m "enable-horizontal-scroll-for-integration-and-history-tabs

Below 768px the existing top tab bars become horizontally
scrollable with snap-to-tab. 44x44 hit targets."
```

---

### Task C.5: Tables → card-stack pattern

**Files:**
- Modify: `apps/desktop/src/renderer/src/styles/app.css` (universal CSS)
- Modify: `apps/desktop/src/renderer/src/pages/GapsPage.tsx` (add data-label attrs)
- Modify: `apps/desktop/src/renderer/src/pages/JobsPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/EvaluationLabPage.tsx`

**Step 1: Add the responsive-table CSS**

Append to `app.css`:

```css
@media (max-width: 767px) {
  table.responsive { display: block; }
  table.responsive thead { display: none; }
  table.responsive tr {
    display: block;
    padding: 12px;
    border-bottom: 1px solid var(--line);
  }
  table.responsive td {
    display: block;
    padding: 4px 0;
  }
  table.responsive td::before {
    content: attr(data-label);
    font-weight: 600;
    color: var(--muted);
    margin-right: 8px;
  }
  table.responsive td:not([data-label])::before { content: none; }
}
```

**Step 2: Add `className="responsive"` to the table elements** in GapsPage, JobsPage, EvaluationLabPage. Each `<td>` gets a `data-label="Column name"` attribute matching the header.

Example for GapsPage:

```tsx
<table className="responsive">
  <thead>
    <tr><th>Status</th><th>Context</th><th>Actions</th></tr>
  </thead>
  <tbody>
    {gaps.map((gap) => (
      <tr key={gap.id}>
        <td data-label="Status">{gap.status}</td>
        <td data-label="Context">{gap.context}</td>
        <td data-label="Actions">{/* buttons */}</td>
      </tr>
    ))}
  </tbody>
</table>
```

**Step 3: Run existing tests** to confirm no regressions

```bash
npm test --workspace=@squidbot/desktop
```

**Step 4: Visual check**

Resize each of these pages to 400px. Each table row should display as a stacked card with `Label: Value` on each line.

**Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/styles/app.css apps/desktop/src/renderer/src/pages/GapsPage.tsx apps/desktop/src/renderer/src/pages/JobsPage.tsx apps/desktop/src/renderer/src/pages/EvaluationLabPage.tsx
git commit -m "add-card-stack-pattern-for-tables-below-768px

CSS-only responsive table pattern (display:block + data-label
::before). Applied to GapsPage, JobsPage, EvaluationLabPage —
the three pages with multi-column data tables. ApprovalsPage
and TrustPage handled separately (cards already / wrap in
horizontal scroll)."
```

---

### Task C.6: ApprovalsPage full-width + TrustPage audit ledger scroll wrap

**Files:**
- Modify: `apps/desktop/src/renderer/src/styles/app.css`

**Step 1: Find Approvals + Trust ledger classes**

Run: `grep -n "approval-card\|audit-ledger\|trust-audit" apps/desktop/src/renderer/src/styles/app.css`

**Step 2: Add mobile rules**

```css
@media (max-width: 767px) {
  .approval-card, .approvals-list > * { width: 100%; padding: 16px; }
  .approval-card .approval-actions { display: flex; flex-direction: column; gap: 8px; }
  .approval-card .approval-actions button { width: 100%; min-block-size: 44px; }

  .audit-ledger-table, .trust-audit-table {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
}
```

Adjust selectors based on actual class names from `grep`.

**Step 3: Commit**

```bash
git add apps/desktop/src/renderer/src/styles/app.css
git commit -m "approvals-full-width-and-trust-ledger-horizontal-scroll-mobile

Approval cards go full-width with stacked vertical-buttons on
mobile. TrustPage's wide audit-ledger table gets wrapped in a
horizontal scroll container instead of card-stacking (the data
density makes a swipe preferable to stacking columns)."
```

---

### Task C.7: ChatPage composer + bubbles + MemoryGraph list fallback

**Files:**
- Modify: `apps/desktop/src/renderer/src/styles/app.css`
- Modify: `apps/desktop/src/renderer/src/pages/MemoryGraphPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/MemoryGraphPage.test.tsx`

**Step 1: ChatPage CSS**

Locate the chat composer + bubble rules (`grep -n "chat-composer\|chat-bubble\|chat-message" apps/desktop/src/renderer/src/styles/app.css`).

Add:

```css
@media (max-width: 767px) {
  .chat-composer { padding: 8px; }
  .chat-composer__send { flex-shrink: 0; min-block-size: 44px; min-inline-size: 44px; }
  .chat-bubble, .chat-message {
    max-width: 92%;
  }
}
```

**Step 2: MemoryGraphPage — fall back to list view on mobile**

Open `MemoryGraphPage.tsx`. Find where the graph + list panes are rendered.

Add a `useBreakpoint()` import + check:

```tsx
import { useBreakpoint } from "../hooks/useBreakpoint";

// ... inside the component:
const bp = useBreakpoint();
const showGraphInline = bp !== "mobile";
const [graphModalOpen, setGraphModalOpen] = useState(false);
```

Change the render to conditionally show the graph pane inline or in a modal:

```tsx
{showGraphInline ? (
  <div className="memory-graph-pane">{/* existing graph */}</div>
) : (
  <button className="secondary-button" onClick={() => setGraphModalOpen(true)}>
    View as graph
  </button>
)}

{graphModalOpen && (
  <div className="memory-graph-modal" role="dialog" aria-label="Memory graph">
    <button className="ghost-button modal-close" onClick={() => setGraphModalOpen(false)}>Close</button>
    <div className="memory-graph-modal__body">{/* existing graph */}</div>
  </div>
)}
```

**Step 3: Add modal CSS**

```css
.memory-graph-modal {
  position: fixed;
  inset: 0;
  background: var(--bg);
  z-index: 200;
  display: flex;
  flex-direction: column;
}
.memory-graph-modal .modal-close { align-self: flex-end; margin: 12px; }
.memory-graph-modal__body { flex: 1; padding: 12px; }
```

**Step 4: Update MemoryGraphPage tests**

Add a test asserting list-view default on mobile:

```tsx
it("shows 'View as graph' button on mobile", async () => {
  // mock matchMedia mobile = true
  // render MemoryGraphPage
  // expect getByText(/View as graph/i)
});
```

**Step 5: Run tests + commit**

```bash
npm test --workspace=@squidbot/desktop -- "ChatPage|MemoryGraphPage"
git add apps/desktop/src/renderer/src/styles/app.css apps/desktop/src/renderer/src/pages/MemoryGraphPage.tsx apps/desktop/src/renderer/src/pages/MemoryGraphPage.test.tsx
git commit -m "chat-composer-and-bubbles-adapt-memory-graph-list-on-mobile

ChatPage: composer's send button gets flex-shrink:0 + 44px
minimums. Bubbles max-width 92% on mobile. MemoryGraphPage: list
view becomes default on mobile, with 'View as graph' button that
opens a full-screen modal containing the SVG graph."
```

---

### Task C.8: Universal forms + touch-target utility

**Files:**
- Modify: `apps/desktop/src/renderer/src/styles/app.css`

**Step 1: Add the universal form rules**

Append:

```css
@media (max-width: 767px) {
  form label { display: block; margin-bottom: 12px; }
  form label > span { display: block; margin-bottom: 4px; font-weight: 500; }
  form input:not([type="checkbox"]):not([type="radio"]),
  form select,
  form textarea {
    width: 100%;
    box-sizing: border-box;
    min-block-size: 44px;
  }
  form .form-actions, form .button-row {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  form .form-actions button, form .button-row button { width: 100%; min-block-size: 44px; }
}

/* Touch-target utility — applied when (pointer: coarse) OR mobile viewport. */
@media (pointer: coarse), (max-width: 767px) {
  button, a, [role="button"], input[type="checkbox"], input[type="radio"] {
    min-block-size: 44px;
    min-inline-size: 44px;
  }
}

/* Hover styles only when supported pointer */
@media not (hover: hover) {
  *:hover { background: inherit !important; color: inherit !important; }
}
```

**Step 2: Visual check**

Run `npm run dev`, navigate to any form (Settings, Integrations → AI models → Add account, etc.). Resize to 400px. Labels should sit above inputs, inputs should be full-width, buttons should stack vertically and be 44px tall.

**Step 3: Commit**

```bash
git add apps/desktop/src/renderer/src/styles/app.css
git commit -m "universal-mobile-form-and-touch-target-rules

Below 768px: labels block-above, inputs full-width, action buttons
stack vertically. (pointer: coarse) OR mobile width enforces 44x44
minimum hit targets on every button / link / form control. Hover
styles guarded by (hover: hover) so they don't stick on touch."
```

---

# Phase D — Web bundle path

### Task D.1: `apiTransport` abstraction

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/apiTransport.ts`
- Create: `apps/desktop/src/renderer/src/lib/apiTransport.test.ts`
- Modify: `apps/desktop/src/renderer/src/lib/api.ts` (use the new transport)

**Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import { setTransport, callApi } from "./apiTransport";

describe("apiTransport", () => {
  it("uses ipc transport when set", async () => {
    const ipcCall = vi.fn(async (method: string, ...args: unknown[]) => ({ method, args }));
    setTransport({ kind: "ipc", invoke: ipcCall });
    const result = await callApi("listSomething", { a: 1 });
    expect(ipcCall).toHaveBeenCalledWith("squidbot:listSomething", { a: 1 });
    expect(result).toEqual({ method: "squidbot:listSomething", args: [{ a: 1 }] });
  });

  it("uses http transport when set", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => ({
      ok: true,
      async json() { return { url, init }; }
    } as unknown as Response));
    setTransport({ kind: "http", baseUrl: "http://localhost:8080", fetch: fetchMock });
    const result = await callApi("listSomething", { a: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/listSomething",
      expect.objectContaining({ method: "POST" })
    );
    expect((result as { url: string }).url).toContain("/api/listSomething");
  });
});
```

**Step 2: Run — expect FAIL**

```bash
npm test --workspace=@squidbot/desktop -- apiTransport
```

**Step 3: Implement**

```typescript
// apps/desktop/src/renderer/src/lib/apiTransport.ts

export type IpcTransport = {
  kind: "ipc";
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
};

export type HttpTransport = {
  kind: "http";
  baseUrl: string;
  fetch?: typeof fetch;
};

export type Transport = IpcTransport | HttpTransport;

let current: Transport | null = null;

export function setTransport(t: Transport): void {
  current = t;
}

export async function callApi(method: string, ...args: unknown[]): Promise<unknown> {
  if (!current) {
    throw new Error("apiTransport not configured — call setTransport first");
  }
  if (current.kind === "ipc") {
    return current.invoke(`squidbot:${method}`, ...args);
  }
  const fn = current.fetch ?? fetch;
  const res = await fn(`${current.baseUrl}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args })
  });
  if (!res.ok) throw new Error(`API ${method} failed: ${res.status}`);
  return res.json();
}
```

**Step 4: Update `lib/api.ts` to use the transport**

The existing `lib/api.ts` returns `window.squidbot` directly. Add a guard at module load that auto-detects whether we're in Electron (window.squidbot exists) or browser (need to fall back to apiTransport):

```typescript
// apps/desktop/src/renderer/src/lib/api.ts (top of file)

import { setTransport, callApi } from "./apiTransport";

declare global {
  interface Window {
    squidbot?: Record<string, (...args: unknown[]) => Promise<unknown>>;
  }
}

// Configure transport based on environment.
if (typeof window !== "undefined") {
  if (window.squidbot) {
    // Electron — wire ipc transport using the preload-injected window.squidbot
    setTransport({
      kind: "ipc",
      invoke: async (channel, ...args) => {
        const method = channel.replace(/^squidbot:/, "");
        const fn = window.squidbot![method];
        if (!fn) throw new Error(`Unknown IPC method: ${method}`);
        return fn(...args);
      }
    });
  } else {
    // Web bundle — talk to localhost:8080 by default
    setTransport({ kind: "http", baseUrl: window.location.origin });
  }
}

// Keep existing squidbotApi export shape unchanged; just back it with callApi.
// (Existing callers continue to work with no changes.)
```

Adjust the existing `squidbotApi` to call `callApi(methodName, ...args)` internally if it doesn't already.

**Step 5: Run — expect PASS**

```bash
npm test --workspace=@squidbot/desktop -- apiTransport
```

**Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/lib/apiTransport.ts apps/desktop/src/renderer/src/lib/apiTransport.test.ts apps/desktop/src/renderer/src/lib/api.ts
git commit -m "add-api-transport-abstraction-for-electron-and-web

window.squidbot.* calls now route through apiTransport which has
two implementations: ipc (uses preload-injected window.squidbot —
Electron path) and http (fetch against POST /api/<method> —
browser path). Auto-detects on module load."
```

---

### Task D.2: `webApiBridge` Express routes

**Files:**
- Create: `apps/desktop/src/server/webApiBridge.ts`
- Create: `apps/desktop/src/server/webApiBridge.test.ts`

**Step 1: Write the failing test**

```typescript
import express from "express";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { mountWebApiBridge } from "./webApiBridge";

describe("webApiBridge", () => {
  it("invokes the registered IPC handler and returns the result as JSON", async () => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>([
      ["listModelAccounts", async () => ({ accounts: [], activeAccountName: null })]
    ]);
    const app = express();
    mountWebApiBridge(app, { invoke: async (channel, ...args) => {
      const method = channel.replace(/^squidbot:/, "");
      const fn = handlers.get(method);
      if (!fn) throw new Error("unknown");
      return fn(...args);
    }});
    const res = await request(app).post("/api/listModelAccounts").send({ args: [] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accounts: [], activeAccountName: null });
  });

  it("returns 404 for unknown methods", async () => {
    const app = express();
    mountWebApiBridge(app, { invoke: async () => { throw new Error("unknown"); } });
    const res = await request(app).post("/api/bogus").send({ args: [] });
    expect([404, 500]).toContain(res.status);
  });
});
```

**Step 2: Install deps + run — expect FAIL**

```bash
npm install --workspace=@squidbot/desktop --save-dev supertest @types/supertest
npm install --workspace=@squidbot/desktop express @types/express
```

```bash
npm test --workspace=@squidbot/desktop -- webApiBridge
```

**Step 3: Implement**

```typescript
// apps/desktop/src/server/webApiBridge.ts

import type { Express } from "express";
import express from "express";

export type WebApiBridgeAdapter = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
};

/**
 * Mounts `POST /api/<method>` routes that mirror the IPC surface.
 * Each request body is `{ args: unknown[] }`; response is the JSON
 * result of the corresponding IPC handler.
 *
 * No auth in Phase 1 — assumes localhost only. Phase 6 wraps this
 * in TLS + session auth for production multi-user.
 */
export function mountWebApiBridge(app: Express, adapter: WebApiBridgeAdapter): void {
  app.use(express.json({ limit: "5mb" }));

  app.post("/api/:method", async (req, res) => {
    const { method } = req.params;
    const args = (req.body?.args ?? []) as unknown[];
    try {
      const result = await adapter.invoke(`squidbot:${method}`, ...args);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });
}
```

**Step 4: Run — expect PASS**

**Step 5: Commit**

```bash
git add apps/desktop/src/server/webApiBridge.ts apps/desktop/src/server/webApiBridge.test.ts apps/desktop/package.json package-lock.json
git commit -m "add-web-api-bridge-mounting-ipc-surface-as-http-routes

mountWebApiBridge(app, adapter) attaches POST /api/<method>
routes that forward to the adapter's invoke function. JSON body
{ args }. JSON response. Localhost-only for Phase 1; Phase 6 adds
auth + TLS for production multi-user."
```

---

### Task D.3: `serve-web.mjs` script

**Files:**
- Create: `apps/desktop/scripts/serve-web.mjs`
- Modify: `apps/desktop/package.json` (add `web:serve` script)

**Step 1: Create the script**

```javascript
// apps/desktop/scripts/serve-web.mjs

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mountWebApiBridge } from "../out/server/webApiBridge.js";
import { ipcMain } from "../out/main/ipcAdapter.js"; // adapter that surfaces IPC handlers as a simple invoke function

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const port = process.env.PORT ?? 8080;

// Mount API bridge first.
mountWebApiBridge(app, {
  invoke: async (channel, ...args) => ipcMain.handle(channel, ...args)
});

// Then serve the built renderer.
const rendererDist = path.join(__dirname, "..", "out", "renderer");
app.use(express.static(rendererDist));

// SPA fallback for client-side routes.
app.get("*", (_req, res) => {
  res.sendFile(path.join(rendererDist, "index.html"));
});

app.listen(port, () => {
  console.log(`SquidBot web dashboard at http://localhost:${port}`);
});
```

Note: `out/main/ipcAdapter.js` is a small adapter that exposes the IPC handlers in a node-callable way. If this doesn't exist yet, create a stub for Phase 1: a minimal adapter that returns mock data. Real wiring lands when production deploy comes (Phase 6).

**Step 2: Add npm script**

In `apps/desktop/package.json`, add to scripts:

```json
"web:serve": "node scripts/serve-web.mjs"
```

**Step 3: Build + smoke check**

```bash
npm run build --workspace=@squidbot/desktop
npm run web:serve --workspace=@squidbot/desktop &
sleep 3
curl -s http://localhost:8080/api/listModelAccounts -X POST -H 'content-type: application/json' -d '{"args":[]}'
# Expected: a JSON response (or a 500 if the ipcAdapter stub isn't wired — that's OK for Phase 1)
kill %1
```

**Step 4: Commit**

```bash
git add apps/desktop/scripts/serve-web.mjs apps/desktop/package.json
git commit -m "add-serve-web-script-for-localhost-web-dashboard

npm run web:serve from apps/desktop starts an Express server on
:8080 that serves the built renderer + mounts the web API bridge.
The same React tree that runs in Electron now runs in a browser
tab — Phase 1 lands the localhost path; Phase 6 adds auth + TLS."
```

---

### Task D.4: Web bundle smoke test (Playwright)

**Files:**
- Create: `apps/desktop/test/web-smoke.spec.ts`
- Modify: `apps/desktop/package.json` (add `test:web` script + playwright dep)

**Step 1: Install Playwright**

```bash
npm install --workspace=@squidbot/desktop --save-dev @playwright/test
npx playwright install chromium
```

**Step 2: Create the test**

```typescript
import { test, expect, type Page } from "@playwright/test";

test.describe("Web bundle smoke", () => {
  test("loads root and shows briefing page", async ({ page }) => {
    await page.goto("http://localhost:8080");
    await expect(page.locator(".briefing-page")).toBeVisible({ timeout: 5000 });
  });

  test("burger button appears on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    await page.goto("http://localhost:8080");
    await expect(page.locator(".burger-button")).toBeVisible();
  });

  test("drawer opens and closes via burger + backdrop", async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    await page.goto("http://localhost:8080");
    await page.locator(".burger-button").click();
    await expect(page.locator(".app-shell.nav-open")).toBeVisible();
    await page.locator(".mobile-nav-backdrop").click();
    await expect(page.locator(".app-shell.nav-open")).not.toBeVisible();
  });
});
```

**Step 3: Add Playwright config**

Create `apps/desktop/playwright.config.ts`:

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  webServer: {
    command: "npm run web:serve",
    port: 8080,
    timeout: 30_000,
    reuseExistingServer: !process.env.CI
  },
  use: {
    baseURL: "http://localhost:8080"
  }
});
```

**Step 4: Add npm script**

```json
"test:web": "playwright test"
```

**Step 5: Commit**

```bash
git add apps/desktop/test/web-smoke.spec.ts apps/desktop/playwright.config.ts apps/desktop/package.json package-lock.json
git commit -m "add-web-bundle-smoke-tests-via-playwright

Three smoke tests verify the web bundle is reachable at
localhost:8080 with: briefing page renders, burger appears on
mobile viewport, drawer opens+closes correctly. Playwright
webServer config auto-starts npm run web:serve."
```

---

### Task D.5: Audit renderer for forbidden imports

**Files:**
- Create: `apps/desktop/scripts/audit-renderer-imports.mjs`

**Step 1: Create the audit script**

```javascript
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererRoot = path.join(__dirname, "..", "src", "renderer");

const FORBIDDEN = [/from\s+["']electron["']/, /from\s+["']node:[^"']+["']/];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      const content = fs.readFileSync(full, "utf8");
      for (const pattern of FORBIDDEN) {
        if (pattern.test(content)) {
          console.error(`FORBIDDEN import in ${full}:`);
          const lines = content.split("\n");
          lines.forEach((line, i) => {
            if (pattern.test(line)) console.error(`  ${i + 1}: ${line.trim()}`);
          });
          process.exit(1);
        }
      }
    }
  }
}

walk(rendererRoot);
console.log("Renderer import audit: clean.");
```

**Step 2: Add npm script**

```json
"audit:renderer-imports": "node scripts/audit-renderer-imports.mjs"
```

**Step 3: Run + confirm clean**

```bash
npm run audit:renderer-imports --workspace=@squidbot/desktop
```

Expected: "Renderer import audit: clean." (exit 0)

If any files have forbidden imports, fix them before continuing.

**Step 4: Commit**

```bash
git add apps/desktop/scripts/audit-renderer-imports.mjs apps/desktop/package.json
git commit -m "add-renderer-import-audit-script

Asserts no renderer file imports from electron or node:* —
guarantees the React tree works in both Electron and the web
bundle without surprises. Runs as a one-shot check via
npm run audit:renderer-imports."
```

---

# Phase E — Test infrastructure

### Task E.1: Touch-target audit Playwright test

**Files:**
- Create: `apps/desktop/test/touch-targets.spec.ts`

**Step 1: Create the test**

```typescript
import { test, expect, type Page } from "@playwright/test";

const PAGES = [
  "/", // briefing
  // The router uses state, not URL — these tests rely on the web bundle's
  // SPA fallback serving the same shell. Navigation between pages happens
  // via clicking sidebar items. For Phase 1, audit each page by navigating
  // through the sidebar.
];

const SIDEBAR_ITEMS = [
  "Briefing", "Chat", "History", "Integrations", "Memory",
  "Settings", "Approvals", "Gaps", "Jobs", "Trust",
  "Identity", "Governance", "Eval Lab", "Onboarding"
];

test.describe("Touch target audit @ 400px width", () => {
  test.use({ viewport: { width: 400, height: 800 } });

  for (const item of SIDEBAR_ITEMS) {
    test(`every interactive element on ${item} >= 44x44`, async ({ page }) => {
      await page.goto("/");
      // Open drawer
      await page.locator(".burger-button").click();
      // Click sidebar item if present
      const navItem = page.getByRole("button", { name: new RegExp(item, "i") });
      if (await navItem.count()) await navItem.first().click();

      const interactive = page.locator("button, a[href], [role='button']");
      const count = await interactive.count();
      for (let i = 0; i < count; i++) {
        const el = interactive.nth(i);
        const box = await el.boundingBox();
        if (!box) continue;
        if (!(await el.isVisible())) continue;
        expect(box.width, `interactive ${i} width on ${item}`).toBeGreaterThanOrEqual(44);
        expect(box.height, `interactive ${i} height on ${item}`).toBeGreaterThanOrEqual(44);
      }
    });
  }
});
```

**Step 2: Run**

```bash
npx playwright test test/touch-targets.spec.ts --workspace=@squidbot/desktop
```

**Step 3: Fix any failures**

If any element fails the 44x44 check, add `min-block-size: 44px; min-inline-size: 44px` to the element's selector in `app.css`. Re-run.

**Step 4: Commit**

```bash
git add apps/desktop/test/touch-targets.spec.ts
git commit -m "add-touch-target-audit-test-for-mobile-viewport

Playwright spec that iterates every interactive element on every
page at 400px viewport and asserts >= 44x44 dimensions. CI runs
this on every PR via npm run test:web."
```

---

### Task E.2: Axe-core a11y scan

**Files:**
- Create: `apps/desktop/test/a11y.spec.ts`
- Install: `@axe-core/playwright`

**Step 1: Install**

```bash
npm install --workspace=@squidbot/desktop --save-dev @axe-core/playwright
```

**Step 2: Create the test**

```typescript
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { name: "mobile", width: 400, height: 800 },
  { name: "tablet", width: 900, height: 1200 },
  { name: "desktop", width: 1440, height: 900 }
];

test.describe("Axe a11y scan", () => {
  for (const vp of VIEWPORTS) {
    test(`briefing page at ${vp.name} has no serious/critical violations`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      const blockers = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      if (blockers.length) {
        console.error(`Axe violations at ${vp.name}:`, JSON.stringify(blockers, null, 2));
      }
      expect(blockers).toHaveLength(0);
    });
  }
});
```

**Step 3: Run + fix**

```bash
npx playwright test test/a11y.spec.ts --workspace=@squidbot/desktop
```

Fix any serious/critical violations. Common fixes:
- Missing `aria-label` on icon-only buttons
- Insufficient color contrast (rare in this app)
- Missing `<label>` for form inputs

**Step 4: Commit**

```bash
git add apps/desktop/test/a11y.spec.ts apps/desktop/package.json package-lock.json
git commit -m "add-axe-a11y-scan-across-breakpoints

Runs axe-core against the briefing page at mobile/tablet/desktop
viewports. Fails CI on any serious or critical violation. Initial
pass: zero blockers (any failures fixed inline)."
```

---

### Task E.3: Visual regression baselines

**Files:**
- Create: `apps/desktop/test/visual.spec.ts`
- Create: `apps/desktop/test/visual-baselines/` (will be populated)

**Step 1: Create the spec**

```typescript
import { test, expect } from "@playwright/test";

const PAGES = ["briefing"]; // Phase 1 baselines start with briefing
                            // Other pages added as Phase C tasks land
const VIEWPORTS = [400, 768, 1024, 1440, 2560];

test.describe("Visual regression baselines", () => {
  for (const pageName of PAGES) {
    for (const width of VIEWPORTS) {
      test(`${pageName} @ ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/");
        await page.waitForLoadState("networkidle");
        await expect(page).toHaveScreenshot(`${pageName}-${width}.png`, {
          maxDiffPixelRatio: 0.02
        });
      });
    }
  }
});
```

**Step 2: Generate baselines**

```bash
npx playwright test test/visual.spec.ts --workspace=@squidbot/desktop --update-snapshots
```

This creates the `.png` baselines under `test/visual.spec.ts-snapshots/`. Commit them.

**Step 3: Run the test to confirm baselines work**

```bash
npx playwright test test/visual.spec.ts --workspace=@squidbot/desktop
```

Expected: all 5 tests pass (matched against just-generated baselines).

**Step 4: Commit**

```bash
git add apps/desktop/test/visual.spec.ts "apps/desktop/test/visual.spec.ts-snapshots/"
git commit -m "add-visual-regression-baselines-for-briefing-page

Playwright takes screenshots of briefing page at 5 widths
(400, 768, 1024, 1440, 2560 px). Baselines committed to repo
under test/visual.spec.ts-snapshots/. maxDiffPixelRatio 0.02
to tolerate minor anti-aliasing drift between CI and local.
Per-page baselines added as each Phase C task lands (out of
Phase 1 scope to baseline every page — would otherwise have
14 pages × 5 widths × OS-rendering-variance to manage)."
```

---

### Task E.4: `test:responsive` aggregator script

**Files:**
- Modify: `apps/desktop/package.json` (add `test:responsive` aggregator)

**Step 1: Add the script**

```json
"test:visual": "playwright test test/visual.spec.ts",
"test:touch": "playwright test test/touch-targets.spec.ts",
"test:a11y": "playwright test test/a11y.spec.ts",
"test:web": "playwright test test/web-smoke.spec.ts",
"test:responsive": "npm run audit:renderer-imports && npm run test:visual && npm run test:touch && npm run test:a11y && npm run test:web"
```

**Step 2: Run end-to-end**

```bash
npm run test:responsive --workspace=@squidbot/desktop
```

Expected: every layer passes. If anything fails, fix before continuing.

**Step 3: Commit**

```bash
git add apps/desktop/package.json
git commit -m "add-test-responsive-aggregator-script

Single npm run test:responsive runs all 5 layers: renderer
import audit, visual regression, touch-target, a11y, web smoke.
Use this in CI on every PR that touches renderer code."
```

---

### Task E.5: Final acceptance verification

**Files:** none (verification only)

**Step 1: Run the full test suite from project root**

```bash
npm test
```

Expected: all 400+ existing tests pass + new responsive tests.

**Step 2: Run `npm run test:responsive`**

```bash
npm run test:responsive --workspace=@squidbot/desktop
```

Expected: all 5 layers pass.

**Step 3: Manual smoke**

- `npm run dev`. Resize Electron window between 4K and 400px. Verify smooth responsive behavior, drawer opens/closes correctly, briefing renders.
- `npm run web:serve --workspace=@squidbot/desktop`. Open `localhost:8080` in a browser. Same UI, same drawer behavior on small viewport.

**Step 4: Walk the Section 9 acceptance checklist**

Open `docs/plans/2026-05-18-responsive-ui-and-briefing-home-design.md`, Section 9. Tick every box. Any unchecked box = unfinished work; return to the relevant task.

**Step 5: Final commit if any cleanup was needed**

```bash
git commit -m "complete-phase-1-acceptance-verification-pass" --allow-empty
```

(Empty commit marks the phase boundary for git log.)

---

# Acceptance criteria

Re-read Section 9 of `docs/plans/2026-05-18-responsive-ui-and-briefing-home-design.md`. Every checkbox below must be ✅ before declaring Phase 1 done:

**Responsive shell** (6 boxes)
**Drawer interactions** (8 boxes)
**Per-page responsive treatment** (12 boxes)
**Briefing home screen** (9 boxes)
**Web bundle** (5 boxes)
**Test coverage** (7 boxes)

Total: 52 acceptance criteria.

# Execution handoff

Plan complete and saved to `docs/plans/2026-05-18-responsive-ui-and-briefing-home-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch fresh subagent per task, two-stage review (spec compliance then code quality), stays in this session.

**2. Parallel Session (separate)** — Open a new session in this worktree with `superpowers:executing-plans`. Batch execution with manual checkpoints.

Recommended: **Subagent-Driven** for Phase A (foundation tasks — small, fast feedback) and Phase B (briefing — same). **Parallel Session** for Phase C onward if you want to step away while the long visual-regression baseline pass runs.

Which approach?
