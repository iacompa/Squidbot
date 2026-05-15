# Sidebar reorganization + page audit — design

**Date:** 2026-05-15
**Status:** Design approved; awaiting writing-plans handoff.
**Scope:** Restructure the desktop app's left-rail navigation from a flat list of 17 items into a two-tier hierarchy (primary nav + collapsible Advanced), introduce a dedicated Integrations page, merge Runs+Memory into History, restructure Settings as left-rail tabs, and fix the one genuinely broken page (Approvals) that the audit surfaced.

---

## 1. Problem

Today the sidebar is a flat array of 17 items in `apps/desktop/src/renderer/src/App.tsx`:

```
Onboarding · Chat · Identity · Trust · Profiles · Runs · Memory · Gaps ·
Sandboxes · Skills · Jobs · Teams · Evals · Messaging · Governance ·
Approvals · Settings
```

Two operator complaints triggered this work:

1. **The sidebar feels overwhelming.** Most items are either rarely-used (Sandboxes, Evals, Gaps, Jobs, Teams) or are *config-y* surfaces masquerading as destinations (Identity, Profiles, Skills, Governance, Messaging). A new user can't tell from the labels what's daily vs rare.
2. **Connecting third-party APIs is hard to discover.** The model-account picker and connector settings are both buried inside Settings as scrollable sections. For a business user whose entire first task is "plug SquidBot into my tools," that surface needs to be a first-class destination.

The audit also surfaced a hidden bug: **`ApprovalsPage` is a 20-line empty-state shell with zero data fetching or actions**, despite the approval backend already existing in the governance package. Promoting Approvals to the primary nav (intended by this redesign) without fixing it would mean shipping a primary nav item with a `[N]` badge that lands on an empty page — worse than not having a badge at all.

## 2. Decisions

Captured via brainstorming with the user:

| Decision | Choice |
|---|---|
| Primary user persona | **Both** — non-tech business owner uses chat day-to-day; technical operator opens the same app to configure / audit. Design has to scale to both. |
| Connectors home | **Dedicated 'Integrations' sidebar item** — first-class top-level entry. |
| Top-level extras (beyond Chat / Integrations / Settings) | **Approvals, Trust, History (combined Runs + Memory).** |
| Where do leftover items live? | **Split**: config-y items in Settings tabs; inspect-y items in collapsible Advanced. |
| Overall shape | **Compact** — Advanced ▾ collapsed by default; Onboarding has no sidebar entry; Settings = single page with tabs. |
| History tab labels | **Activity / Memory** (not "Runs / Memory"). |
| Identity placement | **Inside Profile tab as a read-only summary at top**, not its own Settings tab. |
| Messaging placement | **Inside Integrations** as a third tab (not in Settings). Picked for business-benefit: "Integrations" becomes the single home for every external system SquidBot talks to. |

## 3. Target structure

### 3.1 Sidebar

```
┌──────────────────────────────────────────────┐
│  SquidBot                                    │
│  Local agent control plane                   │
├──────────────────────────────────────────────┤
│                                              │
│  💬  Chat                                    │
│  🔌  Integrations                            │
│  ✅  Approvals          [3]  ← badge         │
│  🛡️  Trust                                   │
│  📜  History                                 │
│  ⚙️  Settings                                │
│                                              │
│  ─────────                                   │
│  Advanced ▾                ← collapsed       │
│                                              │
│  ─────────                                   │
│  ● SQLite local                              │
│  ● Draft writes                              │
│  ● Dry-run terminal                          │
└──────────────────────────────────────────────┘
```

- **6 always-visible primary items** in the order shown.
- **Approvals badge** renders only when `pendingApprovalCount > 0`. Zero pending = no chip (preserves signal value).
- **Advanced ▾ is collapsed by default**. Expanded reveals (in order): Jobs, Teams, Evals, Sandboxes, Gaps. State persists in `localStorage` per-machine.
- **Onboarding has no sidebar entry**. New users (no enterprise profile + no model account) auto-redirect there on first launch; everyone else accesses it via Settings → General → "Re-run onboarding" button (already exists).

### 3.2 Integrations page (new — 3 tabs)

| Tab | Source / status | Purpose |
|---|---|---|
| AI models | Reuses existing `<ModelAccountsSection />` (already extracted) | Save/switch BYOK accounts for the 10 supported providers |
| Connectors | Extract `<ConnectorsSection />` from current `SettingsPage` | Configure non-LLM integrations (Stripe, GitHub, etc.) |
| Messaging | Migrate `MessagingPage` content as a tab section | Channels SquidBot listens on (Slack, email, etc.) |

**Empty state on Connectors tab:** auto-generated quick-start cards from the registry, with the 3–4 most common (Stripe, GitHub, Slack, Petstore demo) featured first. Clicking a card scrolls to a pre-filled "Add connector" form.

**New IPC handler:** `testConnector(connectorName)` — invokes the connector's health-check operation and returns `{ok, latencyMs, error}`. Rendered as a per-row "Test" button. *Connectivity ping only* for v1; "test with sample data" is out of scope.

### 3.3 History page (new — 2 tabs)

| Tab | Source | Purpose |
|---|---|---|
| Activity | Existing `TracesPage` / `RunListPage` content | Chronological run log with search, filters, click-to-trace |
| Memory | Existing `MemoryPage` content | Approved memories, sourced + searchable |

Backwards compat for internal `onNavigate` calls: `"traces"` → `"history" + tab="activity"`, `"memory"` → `"history" + tab="memory"`.

### 3.4 Settings page (rebuilt — 4 left-rail tabs)

Left-rail (not top tabs) so the tab strip stays visible across the long-scrolling content of each tab (especially Profile and Skills).

| Tab | Contents | Source |
|---|---|---|
| **General** | Workspace folder · App-data path · DB path · Re-run onboarding · Docs & guides accordion · App preferences | Existing `SettingsPage` minus connector + model sections (which move to Integrations) |
| **Profile** | Read-only Identity summary at top + Profile management (switch, create, edit) below | Merges `IdentitySection` (extracted from `IdentityPage`) + `ProfileSection` (extracted from `ProfilesPage`) |
| **Skills** | Skill registry — enable/disable, evaluate, promote | `SkillsSection` (extracted from `SkillsPage`) |
| **Governance** | Policy engine, roles, retention, audit settings | `GovernanceSection` (extracted from `GovernancePage`) |

Tab state persists in `localStorage` (`settings.activeTab`).

### 3.5 Page-to-component extraction pattern

We've already done this once this session (`SettingsPage` → `ModelAccountsSection`). Same pattern for the next round:

| Currently a page | Becomes a section component | Rendered inside |
|---|---|---|
| `ProfilesPage.tsx` | `ProfileSection.tsx` | Settings → Profile tab |
| `SkillsPage.tsx` | `SkillsSection.tsx` | Settings → Skills tab |
| `IdentityPage.tsx` | `IdentitySection.tsx` | Settings → Profile tab (top, read-only) |
| `GovernancePage.tsx` | `GovernanceSection.tsx` | Settings → Governance tab |
| `MessagingPage.tsx` | `MessagingSection.tsx` | Integrations → Messaging tab |
| `MemoryPage.tsx` | stays as page | rendered inside HistoryPage → Memory tab |
| `RunListPage.tsx` / `TracesPage.tsx` | stays as page | rendered inside HistoryPage → Activity tab |

## 4. Audit findings

Interaction-density audit on every page that survives the reorganization:

| Page | Lines | Interaction sites | Status |
|---|---|---|---|
| **ApprovalsPage** | 20 | **0** | 🔴 Empty shell — must fix before primary-nav promotion |
| AffordancePage (label: "Gaps") | — | — | 🟡 Works but file/label mismatch — rename to `GapsPage.tsx` |
| SandboxesPage | 212 | 9 | 🟢 Implemented |
| JobsPage | 299 | 19 | 🟢 Implemented |
| TeamsPage | 293 | 19 | 🟢 Implemented |
| EvaluationLabPage | 250 | 13 | 🟢 Implemented |
| MessagingPage | 300 | 18 | 🟢 Implemented |
| GovernancePage | 208 | 14 | 🟢 Implemented |
| Chat / Onboarding / SettingsPage | — | — | 🟢 Working, recently improved this session |
| TrustPage / IdentityPage / ProfilesPage / MemoryPage / TracesPage / SkillsPage | — | — | 🟢 Presumed working (verify during migration) |

**Bottom line:** one genuinely broken page (Approvals), one cosmetic mismatch (Gaps file naming), and the rest is functional code that needs to be **moved without regression**.

## 5. Migration phases

```
Phase 1 — Shell                  (no behavior change, just new chrome)
  ├─ Add PageIds: "integrations", "history" to types.ts
  ├─ Build IntegrationsPage (3 tabs): extract ConnectorsSection + MessagingSection
  ├─ Build HistoryPage (2 tabs): thin wrapper around existing Traces + Memory
  ├─ Rebuild SettingsPage as left-rail tab layout (4 tabs)
  ├─ Update App.tsx sidebar: 6 primary + collapsible Advanced (default collapsed)
  └─ Backwards-compat redirect map for deprecated PageIds

Phase 2 — Wire ApprovalsPage     (the one truly broken thing)
  ├─ Add IPC: listPendingApprovals, approveAction(id), rejectAction(id, reason)
  ├─ Rebuild ApprovalsPage as a real list view with approve/reject actions
  ├─ Add sidebar badge: count of pending → primary nav shows [N] chip
  └─ Tests for queue rendering + approve/reject roundtrip

Phase 3 — Cleanup
  ├─ Rename AffordancePage.tsx → GapsPage.tsx (label/filename align)
  ├─ Audit each migrated tab in-place (does Profile tab let you switch profiles? etc.)
  └─ Update the Docs section in Settings → General → Docs to reflect new structure
     (deep-link PageIds inside it must point at new destinations)

Phase 4 — Polish
  ├─ Empty states: every list page that can be empty gets a "what to do here" CTA
  ├─ Tests: new pages get test files; migrated pages get smoke tests
  └─ Live-verify: launch app, click every nav item, fill every form, confirm clean
```

## 6. Testing strategy

Three layers, each preventing a different class of regression:

1. **Component tests** (vitest + @testing-library/react) per new page. Pattern is established — `ChatPage.test.tsx` was added this session as a template. New ones:
   - `IntegrationsPage.test.tsx` (tab switching, empty state, "Test" button success/failure)
   - `HistoryPage.test.tsx` (tab switching, deep-link via `onNavigate("history", {tab})`)
   - `ApprovalsPage.test.tsx` (the rebuild — render queue, approve/reject roundtrip)
   - `SettingsPage.test.tsx` updates (left-rail tab restructure)

2. **Navigation smoke test** — a single `App.test.tsx` that mounts `<App />`, clicks each of the 6 primary nav items + each Advanced item, and asserts each destination renders *something interactive* (e.g., at least one button or input). Catches future "broken route / empty shell" regressions.

3. **Live verification at end of each phase** — launch dev server, manually open each section, exercise the primary action. Phase 1 = navigate to every page; Phase 2 = approve a real pending action; Phase 3 = full coverage. Checklist embedded in this design doc so future sessions can repeat it.

## 7. Backwards compatibility

The cost of reorganizing is broken internal links. Three handling points:

- **`onNavigate(pageId, payload?)` calls** from other pages: add a small redirect map: old `PageId` → new `{ pageId, tab? }`. The `onNavigate` handler in `App.tsx` resolves the redirect before setting `activePage`. Deprecated ids that map to a tab:
  - `traces` → `history` (tab: `activity`)
  - `memory` → `history` (tab: `memory`)
  - `identity` → `settings` (tab: `profile`, scroll to identity summary at top)
  - `profiles` → `settings` (tab: `profile`)
  - `skills` → `settings` (tab: `skills`)
  - `governance` → `settings` (tab: `governance`)
  - `messaging` → `integrations` (tab: `messaging`)
- **`localStorage` state** that may reference old page ids (`lastVisitedPage`): on app load, if the stored id matches a deprecated one, rewrite it to its successor.
- **`Re-run onboarding` shortcut** in Settings → General still calls `onNavigate("onboarding")` and that still works (onboarding stays reachable, just not in the sidebar).

## 8. Out of scope

- **Connector marketplace** — there's no install-new-connector UI; connectors ship with the app. Empty-state cards reference *existing* connectors.
- **Custom connector authoring UI** — adding a new connector is a code change, not a UI flow.
- **Streaming chat responses** — typing indicator added this session; full token-streaming is a separate session-sized refactor of IPC contract + apiProvider fetch loop + renderer.
- **"Test with sample data"** for connectors — connectivity ping only for v1.
- **Per-account billing dashboard** — pricing in dropdown labels is the v1 surface; a consolidated usage/billing page is future work.
- **Multi-user / team accounts** — single-user app; user/team management is not on the roadmap.

## 9. Acceptance criteria

The work is complete when:

- [ ] Sidebar shows exactly 6 primary items + collapsible Advanced (5 sub-items when expanded).
- [ ] Onboarding has no sidebar entry; new users still auto-redirect there on first launch.
- [ ] Integrations page exists with 3 functional tabs (AI models, Connectors, Messaging). The "Test" button on each connector row reports ok / not-ok.
- [ ] History page exists with 2 functional tabs (Activity, Memory).
- [ ] Settings is left-rail with 4 tabs (General, Profile, Skills, Governance), tab state persists across reloads.
- [ ] ApprovalsPage renders the actual pending-approvals queue and approve/reject buttons mutate state.
- [ ] Sidebar shows `[N]` badge next to Approvals when count > 0; no badge when 0.
- [ ] Every Advanced item (Jobs, Teams, Evals, Sandboxes, Gaps) opens to a page with at least one interactive element.
- [ ] `AffordancePage.tsx` is renamed to `GapsPage.tsx`.
- [ ] Old PageIds (`traces`, `memory`, `identity`, `profiles`, `skills`, `governance`, `messaging`) still resolve via the redirect map.
- [ ] All existing tests pass; new tests cover the new pages.
- [ ] Navigation smoke test (`App.test.tsx`) passes — every visible nav target lands on a non-empty interactive page.
- [ ] Live verification: open the app, click every nav item, no white screens, no broken buttons.

## 10. Next step

Hand off to **`superpowers:writing-plans`** to produce a detailed implementation plan derived from this design.
