# Responsive UI + Briefing Home Screen + Web Reach — design

**Date:** 2026-05-18
**Status:** Design approved, awaiting writing-plans handoff.
**Phase:** 1 of 7 in `docs/plans/2026-05-18-vs-openclaw-hermes-roadmap.md`.
**Scope:** Three coordinated workstreams in one design because they share the same React tree: (a) responsive shell that works from 400px → 4K, (b) a new "Briefing" home screen that replaces Chat as the default landing (the visible difference between "AI agent" and "AI CEO"), (c) the React tree serves cleanly as a web bundle behind Express so a founder can reach it from a browser on any device.

**Related:**
- `docs/plans/2026-05-18-vs-openclaw-hermes-roadmap.md` — the parent roadmap.
- `docs/plans/2026-05-17-connector-mcp-and-catalog-plan.md` — the prior phase that landed last session.

---

## 1. Problem

Three concrete issues converge:

1. **"The UI is not right for all screens."** The current Electron app has a hardcoded 248px sidebar and only 5 ad-hoc media queries scattered across a 3681-line stylesheet. Window resize below ~900px makes the multi-column grids overflow, the 4-tab settings rail get cramped, and the chat composer crowded. Below ~700px, layout breaks entirely.

2. **The default landing page is Chat, not a CEO experience.** A solo founder opening SquidBot today sees a chat input — same as opening ChatGPT or Claude.app. There's nothing to signal "this is your AI CEO" — no overnight digest, no pending decisions, no running-job status. The product positioning (audit-first AI CEO for a solo founder) is invisible until the founder types something.

3. **No web reachability.** The app only runs as an Electron desktop binary. A founder can't pull up SquidBot from their phone's browser to check what their AI CEO did today. Both Hermes Agent (browser dashboard) and OpenClaw (WebChat surface) ship this; SquidBot doesn't.

The three solve cleanly together because they share the same React tree. Designing them separately would either (a) require the responsive pass to be redone when the Briefing home replaces Chat, or (b) force a third pass when we extract a web bundle.

## 2. Decisions

| Decision | Choice |
|---|---|
| Breakpoint system | **Three-tier** (mobile <768px, tablet 768–1023px, desktop ≥1024px). Predictable, easy to test, matches Tailwind/Material conventions. |
| Mobile sidebar pattern | **Hamburger drawer** sliding in from left. Burger button in header opens. Backdrop tap, Escape, route change, or window-resize-past-768px close. |
| Tablet sidebar pattern | **64px icon-only rail** with hover-to-expand (hover-capable pointers only). |
| Default landing route | **Briefing** (a new page) replaces Chat. Chat remains accessible via sidebar + a button on the Briefing page. |
| Web bundle path | **Same React tree, Express server.** No fork. A new `apps/desktop/scripts/serve-web.mjs` Express script serves the Vite-built renderer at `localhost:8080`, talking to the same SQLite via the same IPC shape (`window.squidbot.*` backed by HTTP `fetch` instead of `ipcRenderer.invoke`). |
| Phase 1 Briefing content | **Layout + placeholder data.** Real email/calendar/digest data lands in Phase 2. Phase 1 ships the responsive layout with stubbed counters so the design is verifiable and Phase 2 has a known-working layout to fill. |
| Touch targets | **≥44×44px** on `(pointer: coarse)` OR width <768px. Hover styles wrapped in `@media (hover: hover)`. |
| Animations | **200ms drawer slide + 200ms backdrop fade.** All other transitions suppressed. Respects `prefers-reduced-motion`. |

## 3. Architecture

### 3.1 Breakpoint system

CSS custom properties at `:root`:

```css
:root {
  --bp-mobile: 768px;
  --bp-tablet: 1024px;
}
```

Pattern for every media query in the codebase:

```css
.thing { /* desktop default */ }
@media (max-width: 1023px) { .thing { /* tablet */ } }
@media (max-width: 767px) { .thing { /* mobile */ } }
```

The 5 existing ad-hoc queries (at 700 / 800 / 860 / 900 px) are rewritten to fit the new system — most collapse into the `<768` mobile range.

### 3.2 React state architecture

```
App.tsx
├── isMobileNavOpen: boolean        ← single source of truth
├── useBreakpoint(): 'mobile' | 'tablet' | 'desktop'
├── on transition out of 'mobile' → setMobileNavOpen(false)
└── renders .app-shell with:
    ├── data-bp={breakpoint}
    └── className="app-shell" + (isMobileNavOpen ? "nav-open" : "")
```

### 3.3 Components

| Component | Path | Role |
|---|---|---|
| `useBreakpoint` | `apps/desktop/src/renderer/src/hooks/useBreakpoint.ts` (new) | Subscribes to `matchMedia('(max-width: 767px)')` and `('(max-width: 1023px)')`. Returns current tier. |
| `useFocusTrap` | `apps/desktop/src/renderer/src/hooks/useFocusTrap.ts` (new) | Traps focus inside a ref'd element when active. |
| `MobileNavBackdrop` | `apps/desktop/src/renderer/src/components/MobileNavBackdrop.tsx` (new) | Overlay that fades in/out; tap closes drawer. |
| `BurgerButton` | `apps/desktop/src/renderer/src/components/BurgerButton.tsx` (new) | Icon button rendered in header only on mobile. |
| `BriefingPage` | `apps/desktop/src/renderer/src/pages/BriefingPage.tsx` (new) | New default landing — overnight activity, pending approvals, running jobs, planned work. |
| `App.tsx` | existing — modified | Hosts the new state, mounts burger button + backdrop, renders Briefing as default route. |

### 3.4 IPC shape preservation for web bundle

Renderer talks to `window.squidbot.*` (preload-injected today). For the web bundle:

- A small new module `apps/desktop/src/renderer/src/lib/apiTransport.ts` provides `setTransport({ ipc | http })`.
- In Electron build, transport is `ipc` (calls `ipcRenderer.invoke`).
- In web build, transport is `http` (calls `fetch('/api/<method>')`).
- The `window.squidbot.*` object retains the same method signatures regardless.

No renderer component imports `electron` or `node:*` directly. The existing codebase already follows this; Phase 1 adds an audit to ensure compliance.

## 4. Per-page audit

Every page treated. Patterns reused across pages.

### 4.1 Shell + header (universal)

| Surface | Desktop ≥1024px | Tablet 768–1023px | Mobile <768px |
|---|---|---|---|
| `.app-shell` | `grid-template-columns: 248px 1fr` | `grid-template-columns: 64px 1fr` | `grid-template-columns: 1fr` |
| Sidebar | full text labels | icon-only with `:hover` expand | off-canvas (drawer) |
| Page header | current | current | burger button before title; title `font-size: clamp(20px, 4vw, 28px)` |

### 4.2 Multi-column grid collapses

| Page | Desktop grid | Tablet | Mobile |
|---|---|---|---|
| `BriefingPage` (NEW) | `grid-template-columns: repeat(3, 1fr)` (overnight / pending / planned) | `repeat(2, 1fr)` | `1fr` (stack) |
| `TrustPage` trust-cards | `repeat(4, 1fr)` | `repeat(2, 1fr)` | `1fr` |
| `IdentityPage` stat blocks | `repeat(4, 1fr)` | `repeat(2, 1fr)` | `1fr` |
| `GovernancePage` tiles | `repeat(4, 1fr)` | `repeat(2, 1fr)` | `1fr` |
| `HistoryPage` 2-pane | `540px 1.4fr` | `1fr` (stack) | `1fr` (stack) |

### 4.3 Tab rails

| Page | Current | Mobile treatment |
|---|---|---|
| `SettingsPage` | left 90px rail × 4 tabs | tabs reflow to horizontal scrollable bar above content (`overflow-x: auto; scroll-snap-type: x mandatory`) |
| `IntegrationsPage` | top tab bar (3 tabs) | enable horizontal scroll; `min-width: max-content` on buttons |
| `HistoryPage` | top tab bar (2 tabs) | same as IntegrationsPage |

### 4.4 Tables → card stacks on mobile

CSS-only pattern:

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
    content: attr(data-label) ": ";
    font-weight: 600;
    color: var(--muted);
  }
}
```

TSX change: add `data-label="Column name"` attribute to each `<td>` for the pages below.

| Page | Table | Treatment |
|---|---|---|
| `GapsPage` | row with status / context / actions | card stack |
| `JobsPage` | run rows with status / next-run / actions | card stack |
| `EvaluationLabPage` | leaderboard | card stack |
| `ApprovalsPage` | already card-shaped | drop side padding, full-width buttons |
| `TrustPage` audit ledger | wide tabular data | wrap in `overflow-x: auto` (preserves table; swipe) |

### 4.5 ChatPage (special)

- Composer's send button gets `flex-shrink: 0` so it can't collapse below 44px.
- Message bubbles change from `max-width: min(640px, 92%)` to `max-width: 92%` on mobile to use available width.
- Bot/user bubbles distinguish via background color + alignment, not just max-width.

### 4.6 MemoryGraphPage (special)

The interactive SVG graph doesn't render usefully at 400px. On mobile, the **list view** becomes default (it already exists — sortable node list with search). Add a "View as graph" button that opens the graph in a full-screen modal. Tablet+ keeps the existing dual-pane layout.

### 4.7 Forms (universal)

Every `<form>` gets:
- Labels block-level above inputs.
- `input`, `select`, `textarea` get `width: 100%`.
- Action buttons (Save / Cancel) stack vertically on mobile, side-by-side on tablet+.
- All buttons inherit a new `.touch-target` utility class enforcing min 44×44 when touch is likely.

### 4.8 Touch + pointer handling

- `@media (pointer: coarse)` OR `width < 768px` enforces 44×44 minimums via a single utility class added to every interactive element.
- All `:hover` rules wrapped in `@media (hover: hover)` so they don't stick after a tap.
- Sidebar's tablet "hover to expand" only fires when `hover: hover` matches.

### 4.9 Reduced motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition-duration: 0ms !important; }
}
```

## 5. The Briefing home screen

### 5.1 Layout

Three-column on desktop, two on tablet, one on mobile:

```
┌───────────────────────────────────────────────────────────────┐
│                      Today, May 18                            │
│  Good morning. Here's what's on your plate.                   │
├───────────────────────────────────────────────────────────────┤
│  Overnight        │  Needs you           │  Today's plan      │
│  ─────────────    │  ─────────────       │  ─────────────     │
│  • 24 emails      │  • 3 approvals       │  • 2 meetings      │
│    triaged        │    pending           │  • Pay $1.2k       │
│  • 5 drafts       │  • Sales follow-up   │    invoice         │
│    ready          │    waiting reply     │  • Weekly report   │
│  • 2 invoices     │                      │                    │
│    paid           │  [Open Approvals]    │  [Open Calendar]   │
│                   │                      │                    │
│  [Open Inbox]     │                      │                    │
├───────────────────────────────────────────────────────────────┤
│  Running jobs (4)                            [Open Jobs]      │
│  • Daily-stand-up briefing → next: 8am tomorrow              │
│  • Weekly-financial-summary → next: Sunday 6pm                │
│  • ...                                                        │
├───────────────────────────────────────────────────────────────┤
│  [Open Chat] [Open Workspace] [View audit log]                │
└───────────────────────────────────────────────────────────────┘
```

### 5.2 Phase 1 scope vs Phase 2 wiring

Phase 1 ships the layout + responsive treatment + placeholder data. The "24 emails triaged" / "5 drafts ready" / "2 invoices paid" counters render from a stub data source. Phase 2 replaces the stubs with real Gmail / Calendar / connector data.

| Section | Phase 1 (layout + stub) | Phase 2 (real data) |
|---|---|---|
| Overnight activity | static "—" placeholder counts | live from audit-ledger query over last 12h |
| Needs you (pending approvals) | **real** — uses existing `listPendingApprovals` IPC | unchanged |
| Today's plan | static "—" placeholder | live from calendar connector + scheduled jobs |
| Running jobs | **real** — uses existing `listJobs` IPC | unchanged |
| Action buttons | wired (route changes) | unchanged |

Two counters (pending approvals + running jobs) use existing IPCs, so the Briefing page is genuinely useful from day one — not a Potemkin demo.

### 5.3 Routing

- `/` → Briefing (default landing)
- `/chat` → ChatPage (was previously `/`)
- All other routes unchanged

The sidebar's "Chat" item points to `/chat`. A new "Briefing" item at the top of the sidebar points to `/`. Onboarding flow update: after first model account is configured, return to `/` (Briefing), not `/chat`.

## 6. Web bundle path

### 6.1 Architecture

The same Vite-built React renderer is served two ways:

- **Electron** (existing): preload bridges `window.squidbot.*` to `ipcRenderer.invoke`.
- **Web** (new): `apps/desktop/scripts/serve-web.mjs` Express server serves the built bundle at `localhost:8080`. A new `apps/desktop/src/server/webApiBridge.ts` exposes the same IPC method names as HTTP endpoints (`POST /api/listModelAccounts` etc.).

```
                  ┌─── Electron renderer ───→ preload → ipcRenderer → main process → SQLite
React renderer ──┤
                  └─── Web renderer ────────→ fetch    → Express     → webApiBridge → SQLite (same)
```

### 6.2 What this Phase ships

- The renderer's `apiTransport` abstraction so `window.squidbot.*` works against either transport.
- `serve-web.mjs` and `webApiBridge.ts` for the dev workflow: `npm run web:serve` serves the renderer at `localhost:8080`.
- **No production hardening.** No auth, no HTTPS, no rate-limiting — `localhost`-only for the founder's own machine. Production auth + multi-user deploy comes with Phase 6.

### 6.3 What this Phase tests

- Playwright loads `localhost:8080` and exercises basic navigation. Proves the React tree has no Electron-only dependencies.
- One smoke test per page that the page renders without errors.

## 7. State flow + interactions

### 7.1 Drawer state machine

```
window width changes
  ↓
useBreakpoint() emits 'mobile' | 'tablet' | 'desktop'
  ↓
on transition OUT of 'mobile' → setMobileNavOpen(false)   [auto-close on resize]
  ↓
.app-shell receives data-bp={mode} + .nav-open class
  ↓
CSS does visual switch (sidebar off-canvas, drawer slide, grid collapses)
```

### 7.2 Interaction rules (mobile only)

| Event | Behavior |
|---|---|
| Tap burger icon | `setMobileNavOpen(true)` — sidebar slides in (200ms `transform: translateX`), backdrop fades in (200ms opacity), body locks scroll |
| Tap backdrop | `setMobileNavOpen(false)` — reverse animation |
| Tap sidebar nav item | `setMobileNavOpen(false)` then route change — drawer closes before transition |
| Press Escape | `setMobileNavOpen(false)` — keyboard parity with backdrop tap |
| Focus enters drawer | Focus trap activates — Tab cycles drawer items only |
| Window resizes past 768px | `setMobileNavOpen(false)` — drawer can't get stuck open |
| `prefers-reduced-motion: reduce` matches | Skip animations; drawer just appears/disappears |

### 7.3 Edge cases handled

- **First tap on mobile burger when on a route that loads data:** the drawer opens immediately (UI responsive) even if the page underneath is still loading. The drawer doesn't wait for page data.
- **Rapid resize across boundaries:** state always converges. `useBreakpoint` uses `matchMedia` callbacks (one fire per boundary crossing), not `resize` polling.
- **Browser back/forward button** during open drawer: drawer auto-closes on route change regardless of source.
- **Page route change via `<Link>`** during open drawer: same — drawer closes.
- **Programmatic navigation** (e.g., a successful save redirects): same handler.
- **Initial load with `localStorage` drawer state:** drawer always defaults to closed on mount. We don't persist the open state — that's a footgun where a closed window reopens with drawer open and the user is confused.

## 8. Testing strategy

### 8.1 Test layers

| Layer | Tool | What it covers |
|---|---|---|
| Unit/component | Vitest + @testing-library/react | `useBreakpoint`, `useFocusTrap`, drawer state machine, Briefing page render, individual components |
| Visual regression | Playwright | Page renders at fixed viewports (400, 768, 1024, 1440, 2560 px); baseline PNGs in repo |
| Touch target audit | Playwright | Iterates every `button`, `a`, `[role="button"]`, asserts `getBoundingClientRect()` ≥ 44px both dims at mobile viewport |
| A11y | Playwright + @axe-core/playwright | Every page × every breakpoint; zero `serious`/`critical` violations |
| Web bundle smoke | Playwright | Loads `localhost:8080`, navigates to each page, verifies no Electron-only API calls |

### 8.2 Test commands

```bash
npm test                                # all unit/component tests
npm run test:visual                     # Playwright visual regression
npm run test:a11y                       # axe-core scans
npm run test:touch                      # touch-target audit
npm run test:web                        # web bundle smoke
npm run test:responsive                 # all of the above
```

### 8.3 Specific TDD targets

- `useBreakpoint()` returns correct value at each window width — test with `vi.stubGlobal('matchMedia', ...)`.
- `useBreakpoint()` updates when matchMedia change event fires.
- Drawer state machine: open → tap backdrop → closed. Open → escape → closed. Open → resize past 768px → closed.
- Briefing page renders pending approvals count from `listPendingApprovals` mock.
- Briefing page renders running jobs count from `listJobs` mock.
- Visual regression: each of the 14 pages × 5 widths = 70 screenshots committed to `apps/desktop/test/visual-baselines/`.
- Touch target audit: every interactive element on every page passes 44×44 at mobile width.
- Axe: zero serious/critical on every page at mobile + desktop.

## 9. Acceptance criteria

Phase 1 is complete when every box below is checked:

**Responsive shell**
- [ ] `:root` defines `--bp-mobile: 768px` and `--bp-tablet: 1024px`.
- [ ] All new media queries reference these. The 5 existing ad-hoc queries (at 700/800/860/900px) are rewritten to fit.
- [ ] `useBreakpoint()` hook returns `'mobile' | 'tablet' | 'desktop'` based on `matchMedia` (not resize).
- [ ] Below 768px: sidebar off-canvas; burger button visible in header; backdrop renders when drawer open.
- [ ] 768–1023px: sidebar is 64px icon-only rail; hover-to-expand only when `hover: hover` matches.
- [ ] ≥1024px: layout unchanged from today.

**Drawer interactions**
- [ ] Burger tap opens drawer with 200ms animation.
- [ ] Backdrop tap closes drawer.
- [ ] Escape key closes drawer.
- [ ] Sidebar item tap closes drawer then routes.
- [ ] Window resize past 768px auto-closes drawer.
- [ ] Focus is trapped inside drawer when open.
- [ ] Body scroll locks when drawer open.
- [ ] `prefers-reduced-motion: reduce` skips animations.

**Per-page responsive treatment**
- [ ] BriefingPage (new) renders 3-col / 2-col / 1-col across breakpoints.
- [ ] TrustPage, IdentityPage, GovernancePage multi-col grids collapse.
- [ ] HistoryPage 2-pane stacks below 1024px.
- [ ] SettingsPage 4-tab rail reflows to horizontal scrollable bar on mobile.
- [ ] IntegrationsPage, HistoryPage tab bars scroll horizontally on mobile.
- [ ] GapsPage, JobsPage, EvaluationLabPage tables become card stacks on mobile.
- [ ] ApprovalsPage cards go full-width on mobile.
- [ ] TrustPage audit ledger gets horizontal scroll wrapper on mobile.
- [ ] ChatPage composer + message bubbles handle 400px width.
- [ ] MemoryGraphPage defaults to list view on mobile with "View as graph" modal option.
- [ ] All forms stack labels above inputs on mobile with `width: 100%` inputs.
- [ ] All interactive elements ≥ 44×44px on `(pointer: coarse)` OR width <768px.

**Briefing home screen**
- [ ] `/` route renders BriefingPage (default landing).
- [ ] `/chat` route renders ChatPage.
- [ ] Sidebar has new "Briefing" item at top.
- [ ] Briefing renders Overnight / Needs you / Today's plan three-column layout.
- [ ] "Needs you" section shows real pending approvals count from existing `listPendingApprovals` IPC.
- [ ] "Running jobs" section shows real running jobs from existing `listJobs` IPC.
- [ ] Other Briefing sections show "—" placeholder values (filled by Phase 2).
- [ ] Action buttons route correctly: Open Chat → /chat, Open Approvals → /approvals, etc.
- [ ] After first model account configured during onboarding, redirect goes to `/`, not `/chat`.

**Web bundle**
- [ ] `apps/desktop/src/renderer/src/lib/apiTransport.ts` provides `setTransport({ ipc | http })`.
- [ ] `apps/desktop/scripts/serve-web.mjs` Express script serves the Vite-built renderer at `localhost:8080`.
- [ ] `apps/desktop/src/server/webApiBridge.ts` mirrors every IPC method as a POST endpoint.
- [ ] `npm run web:serve` works end-to-end; opens browser; renderer functions.
- [ ] Renderer contains no `import 'electron'` or `import 'node:*'` statements outside the main/preload paths.

**Test coverage**
- [ ] Vitest unit tests for `useBreakpoint`, `useFocusTrap`, drawer state machine, Briefing component.
- [ ] Playwright visual regression: 14 pages × 5 widths (400, 768, 1024, 1440, 2560) = 70 baseline screenshots committed.
- [ ] Playwright touch-target audit: every interactive element ≥ 44×44 at 400px viewport.
- [ ] Axe-core: zero `serious`/`critical` violations on every page at every breakpoint.
- [ ] Web bundle smoke test: Playwright loads `localhost:8080`, navigates each route, asserts render.
- [ ] All existing 400 tests still pass.
- [ ] New `npm run test:responsive` aggregates all responsive tests; CI runs it on every PR.

## 10. Out of scope

YAGNI ruthlessly. These are deliberately deferred:

- **Real email/calendar/financial data on Briefing.** Layout + stubs in Phase 1; real data wired in Phase 2.
- **Auth, HTTPS, multi-user on the web bundle.** Localhost-only for now; production wraps in Phase 6.
- **Native mobile (iOS Swift / Android Kotlin).** PWA via responsive web bundle covers it for now.
- **Dark mode polish.** Existing skeletal dark-mode rules stay as-is.
- **Animations beyond the 200ms drawer slide.** No page transitions, no element micro-interactions.
- **Localization / i18n.** English-only.
- **Drawer state persistence.** Drawer always defaults to closed.

## 11. Risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Playwright visual baselines flake on different OS rendering | medium | Pin baselines to one OS in CI; allow `--update-baselines` flag for intentional updates |
| `useBreakpoint` causes excess re-renders | low | Use `matchMedia` callbacks (boundary events), not resize polling |
| Web bundle exposes IPC method that shouldn't be reachable over HTTP | medium | `webApiBridge.ts` has an explicit allowlist; methods not in it return 404 |
| Existing page-specific CSS breaks when generic rules added | medium | Per-page response audit covers all 14 pages; visual regression catches surprises |
| Onboarding redirect to `/` instead of `/chat` confuses new users | low | Briefing page has a prominent "Open Chat" button + onboarding hint |
| Focus trap library bugs | low | Use a tiny in-house implementation (~30 lines) rather than a dep |

## 12. Acceptance demo (what done looks like)

The reviewer should be able to:

1. **Resize the Electron app** from 4K down to 400px wide. At every width, the layout stays usable. No horizontal scroll, no overlapping elements, no cut-off text.
2. **Open the app** and land on the Briefing page (not Chat). See "0 approvals pending" / "0 running jobs" (or real numbers if any exist).
3. **Run `npm run web:serve`** and open `http://localhost:8080` in a browser. The same UI loads, the same navigation works, the same drawer behavior on a 400px mobile viewport.
4. **Run `npm run test:responsive`** and see all tests pass: unit, visual regression, touch targets, a11y, web bundle.
5. **Open Chrome DevTools' device emulation** at iPhone SE (375×667). The hamburger drawer works. All buttons are tappable. No layout breaks.

## 13. Next step

Hand off to `superpowers:writing-plans` to produce a detailed task-by-task implementation plan from this design. Estimated phase scope: 25–35 bite-sized tasks across responsive shell, Briefing page, per-page audits, web bundle, and test coverage.
