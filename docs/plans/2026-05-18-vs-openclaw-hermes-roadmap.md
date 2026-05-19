# SquidBot vs OpenClaw vs Hermes Agent — Strategic Roadmap

**Date:** 2026-05-18
**Status:** Strategic positioning + phased plan. Each phase has its own design doc + implementation plan to follow.
**Mission frame:** "The audit-first, self-improving AI agent — for businesses that need to deploy AI without sacrificing trust."

---

## 1. Positioning

SquidBot's identity is the **audit-first, self-improving agent**. Two dimensions where SquidBot is — or will be — demonstrably #1 of the three:

1. **Audit-first.** Every action recorded with chained-hash audit. Every tool call has a "why". Pre-flight dry-run shows what an upcoming task will touch *before it runs*. Sandboxed per tool call, not just per patch.
2. **Self-improving + compliant.** Hermes-style autonomy (skill self-improvement, memory nudges, MCP server mode) where every improvement *itself* lands in the audit trail. The agent gets smarter without sacrificing accountability.

This positioning is **defensible**:
- **Hermes can't add chained-hash audit + RBAC + compliance packets** without a 6-month detour from their research focus.
- **OpenClaw explicitly disclaims hostile multi-tenant isolation** and lacks the eval/canary/promote pipeline that makes auditable self-improvement possible.
- **SquidBot already has the foundation** (governance, audit ledger, eval suite, compliance packets, sensitivity profiles, sandbox staging). What's missing is the connective tissue and the **outward-facing surface** that lets the agent learn while staying auditable.

We are not trying to match every Hermes/OpenClaw feature. We close enough parity gaps to be evaluable side-by-side, then we **stretch the lead** on audit + self-improvement.

## 2. Capability comparison (one-line per row)

| Category | OpenClaw | Hermes Agent | SquidBot today | SquidBot after roadmap |
|---|---|---|---|---|
| Model providers | 5 + Ollama | 200+ via OpenRouter + direct | 9 providers + live discovery | unchanged (already strong) |
| Connectors / tools | 1st-class tools, MCP CLI (shallow) | 70+ built-ins + MCP server mode | manifests + MCP client + OpenAPI import | **+ MCP server mode** |
| Memory | LanceDB plugin, Honcho, QMD | FTS5 + LLM summarization + Honcho | typed-edge graph + FTS5 + pseudo-embeds | **+ autonomous memory nudges** |
| Skills | SKILL.md + ClawHub | SKILL.md + autonomous self-improvement + Hub | manifest + eval + canary + promote | **+ self-improvement loop tied to eval** |
| Multi-agent | Multi-agent routing, sub-agents | `delegation` + `kanban` | Teams (blackboard/broker/conflict/handoff/synthesis) | unchanged (already strong) |
| Scheduling | Cron + webhooks + heartbeat | `cronjob` tool | Scheduler w/ pause/resume/run-now | unchanged |
| Eval / observability | **Prometheus + OTel** | Atropos RL trajectories | full eval suite + trace taxonomy | **+ Prometheus + OTLP exporter** |
| Messaging | **22+ channels** | 17+ channels | 13 channels | **+ 9 channels** (LINE, Google Chat, IRC, Nostr, Synology, Tlon, Twitch, Zalo, Nextcloud Talk) |
| Governance | DM pairing + per-agent policies + MITRE ATLAS | DM pairing + container isolation | **RBAC + ABAC + chained-hash audit + compliance packets + retention + redaction + n8nBridge** | **+ pre-flight audit + sandboxed per tool call + hostile-tenant isolation** |
| Identity | single-operator-per-gateway | messaging allowlists only | **8 profile templates incl. air-gapped** | **+ HIPAA + PCI + ISO 27001 profile packs** |
| Surfaces | CLI + menu-bar + iOS/Android + Voice Wake + Live Canvas | TUI + browser dashboard + `computer_use` + Termux | Electron desktop + CLI | **+ responsive UI + web dashboard + menu-bar + Voice Wake** |
| Deployment | Docker / K8s / Ansible / Nix / cloud + daemon | Local + VPS + Modal + Vercel Sandbox | Local Electron only | **+ Docker / docker-compose** |
| Self-improvement | manual skill curation | **autonomous skill creation + improvement** | manual + eval pipeline | **+ autonomous trigger loop** |

## 3. Six-phase roadmap

Each phase ships as a self-contained design doc + implementation plan + executable commits. Sequencing optimized for: (a) close active pain points first, (b) build "audit-first + self-improving" identity, (c) close remaining parity gaps.

### Phase 1 — Responsive UI + Web reachability  *(current pain + unlocks Web dashboard parity)*

The reported issue: "the UI is not right for all screens." Fix it with a 3-tier breakpoint system (mobile <768px hamburger drawer / tablet 768-1023px icon rail / desktop ≥1024px current). Adds a `useBreakpoint()` hook, drawer state, focus trap, body-scroll-lock, per-page audit covering shell, headers, multi-column grids, tabs, tables, forms, chat composer, memory graph.

Critically, the same responsive React tree, behind an Express server, also becomes the **web dashboard** that Hermes ships and OpenClaw doesn't. One workstream, two parity wins.

**Acceptance:** Electron app renders correctly from 400px → 4K. Same bundle served as web dashboard at `localhost:8080` with login. Touch targets ≥44px on coarse pointers.

### Phase 2 — Voice + Menu-bar shell  *(OpenClaw parity)*

Push-to-talk overlay using Web Speech API in the renderer (no cloud STT — keeps zero-spend posture). macOS menu-bar variant of the Electron app (same React tree, tray icon, popover window, quick chat input). Out of scope for now: continuous "Voice Wake" hot-word detection (battery cost; deferred).

**Acceptance:** Holding ⌘+Space (or configurable shortcut) opens a tiny floating chat panel that responds to voice input. Tray icon menu shows recent traces and approval count.

### Phase 3 — Autonomy loop  *(the headline differentiator)*

Three Hermes-parity items wired together via SquidBot's eval pipeline so every improvement is audit-tracked:

1. **MCP server mode** — expose SquidBot as an MCP server so Hermes / Claude Desktop / any MCP client can call SquidBot skills. Every external call enters the same audit ledger.
2. **Skill self-improvement trigger loop** — when reflection identifies a failed/slow skill, automatically propose mutations via the existing `mutationProposer`, evaluate them via the existing benchmark suite, canary them, promote if they win. Audit log records every step.
3. **Memory write nudges** — periodic deterministic prompt during chats: "Anything worth remembering from the last N turns?" Proposed memories enter the existing approval flow.

**Acceptance:** Skills evolve without manual intervention, with every change traceable to the run that triggered it. Other agents (incl. Hermes) can call SquidBot via MCP and see results.

### Phase 4 — Deployment + Observability  *(OpenClaw parity; unlocks server customers)*

Dockerfile + docker-compose.yml for headless runtime. Prometheus `/metrics` endpoint mapping existing trace events. OTLP exporter for traces. New `npm run audit` command (`security audit --deep --fix` equivalent) that runs all governance checks (audit ledger integrity, RBAC drift, secrets leakage scan, retention compliance, sensitivity profile drift) and offers auto-remediation where safe.

**Acceptance:** `docker compose up squidbot` runs the headless agent + dashboard. Grafana can scrape SquidBot metrics. `npm run audit` flags every governance issue with severity + remediation hint.

### Phase 5 — Messaging adapter expansion  *(OpenClaw parity)*

Add LINE, Google Chat, IRC, Nostr, Synology Chat, Tlon, Twitch, Zalo, Nextcloud Talk. The `packages/messaging` abstraction (`adapterManifest`, `gateway`, `deliveryRouter`, `allowlist`) makes each adapter a ~300-line file matching the existing Slack/Discord/Telegram shape.

**Acceptance:** All 9 channels appear in Integrations → Messaging with the same allowlist + delivery-rule treatment.

### Phase 6 — "Better than" enterprise features  *(beyond either competitor)*

Where SquidBot leaves the competition behind. None of these exist in OpenClaw or Hermes.

1. **Pre-flight audit mode** — before a task runs, the agent dry-runs the trace and shows: every tool it will call, every secret it will need, every connector that will fire, every estimated cost. Operator can edit, deny, or approve as a whole.
2. **Sandboxed per tool call** — extend the existing sandbox-staging pattern from "before a patch promotes" to "before every write tool call". Reversible-by-default.
3. **HIPAA + PCI DSS + ISO 27001 compliance packets** — three more frameworks added to the existing SOC2 + GDPR packet generator.
4. **Hostile multi-tenant isolation** — close the gap OpenClaw explicitly disclaims. Tenant boundaries enforced at every layer: storage namespacing, secret vault per tenant, audit ledger per tenant, no cross-tenant tool call possible.
5. **Auditable autonomy log** — a dedicated "improvement ledger" tracking every self-improvement (skill mutation, memory addition, learned preference). Auditors can replay it.

**Acceptance:** A regulated buyer can run `npm run trust -- packet --framework hipaa` and get a procurement-ready PDF in their downloads. Cross-tenant tool call attempts trigger an audit event AND are rejected.

## 4. Phase ordering rationale

```
Phase 1 (immediate pain)  →  Phase 3 (differentiator)  →  Phase 4 (server reach)
                              ↓
                          Phase 6 (lead extension)  →  Phase 2 (polish)  →  Phase 5 (breadth)
```

Why this order:
- **Phase 1 first** because it's the reported active pain AND it unlocks Phase 4's web dashboard for free.
- **Phase 3 second** because it builds the headline identity. Without it, SquidBot looks like a polished OpenClaw clone instead of its own product.
- **Phase 4 third** because server deploy is the gating requirement for most enterprise buyers, and Phase 1's web bundle is the dashboard they'll see.
- **Phase 6 fourth** because by then the audit-first foundation is in place and the lead-extending features have load-bearing infrastructure to attach to.
- **Phase 2 fifth** — polish features. Useful but not gating.
- **Phase 5 last** because each adapter is small and uniform — easy to interleave with other work.

## 5. What we are explicitly NOT doing

YAGNI ruthlessly:
- **Mobile native apps** (iOS Swift / Android Kotlin) — deferred indefinitely. The responsive web bundle from Phase 1 covers mobile reach via PWA install. Native apps are 6+ months of effort per platform.
- **Continuous Voice Wake hot-word detection** — push-to-talk only in Phase 2. Hot-word listening is a battery/privacy concern that warrants its own design.
- **`computer_use` GUI control** — Hermes ships this; we don't. The audit-first identity actively *conflicts* with "agent moves your mouse." Not adding.
- **`execute_code` arbitrary Python tool** — same reason. We sandbox tool calls, not arbitrary code.
- **Hermes-style trajectory export for RL training** — niche to the Nous Research use case; not part of the audit-first identity.
- **LanceDB / external vector DBs** — the FTS5 + pseudo-embedding pipeline is intentional (zero-spend, local-first). Plug-in points exist if a future customer demands it.
- **OpenClaw's "Live Canvas"** — interesting feature but not aligned with audit-first identity. The chat surface is the canvas.
- **Termux Android support** — covered by web bundle via PWA. Real Android shell defers.

## 6. Success metrics

How we know the roadmap landed:

- **Phase 1:** Electron app renders cleanly at 400 / 768 / 1024 / 1440 / 2560 px. Web dashboard reachable at `localhost:8080`.
- **Phase 2:** Push-to-talk recognized in <1 second; menu-bar app opens in <300ms.
- **Phase 3:** A failed skill auto-improves within 24 hours with full audit trail. External agents call SquidBot via MCP successfully.
- **Phase 4:** `docker compose up` produces a working headless instance. Grafana shows metrics. `npm run audit` exits 0 on a clean install.
- **Phase 5:** All 9 new messaging adapters pass the same test fixture as the existing 13.
- **Phase 6:** A regulated buyer can execute the full compliance procurement workflow (download packet, verify audit ledger, view RBAC report) from the UI without engineering help.

## 7. Out of scope for this roadmap (cross-cutting)

- **Localization / i18n** — English-only for now. Adding later doesn't change architecture.
- **Themes / dark mode polish** — exists in skeletal form; deferred.
- **Performance profiling** — only address if Phase 1's responsive shell reveals real issues.

## 8. Next step

Resume Phase 1 (responsive UI + web reachability) brainstorm — Sections 3 (state flow + drawer interaction) and 4 (testing + acceptance criteria) — then write the implementation plan and execute. The other 5 phases get their own brainstorm → design → plan cycle in the ordered sequence above.
