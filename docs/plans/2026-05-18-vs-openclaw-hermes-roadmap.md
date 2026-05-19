# SquidBot vs OpenClaw vs Hermes Agent — Strategic Roadmap

**Date:** 2026-05-18
**Status:** Strategic positioning + phased plan. Each phase has its own design doc + implementation plan to follow.
**Mission frame:** "Your audit-first AI CEO — a single agent that handles the operations of running a one-person business, with a tamper-evident trail of every decision."
**Primary user:** Solo founder / business-of-one. The agent IS their operations team.

---

## 1. Positioning

SquidBot's identity is **"your audit-first AI CEO."** A single agent a solo founder can grant broad authority to — handling email, calendar, briefings, financial monitoring, project follow-through, vendor outreach — because every action lands in a tamper-evident audit trail.

Three dimensions where SquidBot is — or will be — demonstrably #1 of the three:

1. **AI CEO operations layer.** Email triage + calendar management + scheduled briefings + proactive task initiation. Neither OpenClaw nor Hermes ships this as the primary experience — they're chat tools that *can* do email if you wire connectors.
2. **Audit-first.** Every action recorded with chained-hash audit. Every tool call has a "why". Pre-flight dry-run shows what an upcoming task will touch *before it runs*. Sandboxed per tool call, not just per patch.
3. **Self-improving + auditable.** Hermes-style autonomy (skill self-improvement, memory nudges, MCP server mode) where every improvement *itself* lands in the audit trail. The agent gets smarter without sacrificing accountability.

The reason this works: **a CEO can delegate broadly because there's accountability.** SquidBot's existing audit ledger + sensitivity profiles + approval queue IS that accountability. So "give the agent broad authority" stops being scary.

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

## 3. Seven-phase roadmap

Each phase ships as a self-contained design doc + implementation plan + executable commits. Sequencing optimized for the **AI CEO identity** — close active pain points, then build the operations layer that makes "AI CEO" real, then layer in safety + autonomy + breadth.

### Phase 1 — Responsive UI + Briefing home screen + Web reach  *(current pain + foundation)*

The reported issue: "the UI is not right for all screens." Fix it with a 3-tier breakpoint system (mobile <768px hamburger drawer / tablet 768-1023px icon rail / desktop ≥1024px current). Adds `useBreakpoint()` hook, drawer state, focus trap, body-scroll-lock, per-page audit covering shell, headers, multi-column grids, tabs, tables, forms, chat composer, memory graph.

**Also in scope (newly elevated):** redesign the home screen from "Chat" to **"Briefing"** — the default landing page becomes a daily digest of (a) what the AI CEO handled overnight, (b) what needs the founder's attention, (c) what's planned for today, (d) running jobs. The chat surface stays accessible but is no longer the default entry point. This reframe is the visible difference between "AI agent" and "AI CEO."

Critically, the same responsive React tree, behind an Express server, also becomes the **web dashboard** Hermes ships and OpenClaw doesn't. One workstream, three wins: UI fix, AI CEO front door, web reach.

**Acceptance:** Electron app renders correctly from 400px → 4K. Default landing shows Briefing, not Chat. Same bundle served as web dashboard at `localhost:8080`. Touch targets ≥44px on coarse pointers.

### Phase 2 — AI CEO operations layer  *(headline experience — NEW)*

The phase that makes "AI CEO" real. Four workstreams under one design:

1. **Email triage + drafting connector** — Gmail / Outlook / IMAP via OAuth. AI CEO reads incoming mail, categorizes (auto-reply / draft for review / escalate / archive), drafts replies for routine, sends auto-replies for known patterns, escalates the rest via the Briefing.
2. **Calendar management connector** — Google Calendar / Outlook Calendar. AI CEO schedules meetings, reschedules conflicts, sends invites, prepares pre-meeting briefs (pull memory graph + recent emails on attendee + last meeting notes).
3. **Daily / weekly briefing scheduler** — on configured cadence (default: 8am daily, Sunday 6pm weekly), AI CEO writes a summary delivered via the Briefing home screen + optionally pushed to messaging adapters (Slack DM, Telegram, email). Format: what I handled, what I drafted, what needs you, what's coming up.
4. **Proactive task initiation** — extension of reflection: when the AI CEO notices a recurring pattern (e.g., invoice from same vendor monthly), it proposes a new scheduled job. Operator approves once; recurring task lands in the scheduler.

Every action is recorded in the audit ledger with reasoning. Sensitivity profiles gate what the AI CEO can do unilaterally vs what gets escalated.

**Acceptance:** A solo founder can connect Gmail + Google Cal, set a daily briefing time, and within 24 hours receive a digest showing the AI CEO categorized N emails, drafted M replies, scheduled K meetings, with a tamper-evident audit trail of every decision.

### Phase 3 — Autonomy loop  *(the AI CEO learns over time)*

Three Hermes-parity items wired together via SquidBot's eval pipeline so every improvement is audit-tracked:

1. **MCP server mode** — expose SquidBot as an MCP server so Hermes / Claude Desktop / any MCP client can call SquidBot skills. Every external call enters the same audit ledger. Also lets the AI CEO delegate to specialist external agents.
2. **Skill self-improvement trigger loop** — when reflection identifies a failed/slow skill, automatically propose mutations via the existing `mutationProposer`, evaluate them via the existing benchmark suite, canary them, promote if they win. Audit log records every step.
3. **Memory write nudges** — periodic deterministic prompt: "Anything worth remembering from the last N interactions?" Proposed memories enter the existing approval flow. For an AI CEO: remembering vendor quirks, meeting preferences, personal context — automatically.

**Acceptance:** A skill the AI CEO uses (e.g., "draft a polite decline to a sales pitch") improves over time without manual intervention, with every change traceable. External agents can call SquidBot via MCP.

### Phase 4 — Beyond-parity enterprise features  *(the "is it safe to trust?" layer)*

For an AI CEO with email + calendar authority, trust matters more, not less. These five close the loop:

1. **Pre-flight audit mode** — before a task runs, the AI CEO dry-runs the trace and shows: every tool it will call, every secret it will need, every email it will send, every estimated cost. Operator can edit, deny, or approve as a whole.
2. **Sandboxed per tool call** — extend the existing sandbox-staging pattern from "before a patch promotes" to "before every write tool call" — every outbound email, every calendar change, every connector write. Reversible-by-default. Until approved, the AI CEO produces *drafts* rather than committing.
3. **Auditable autonomy log** — a dedicated "improvement ledger" tracking every self-improvement. For an AI CEO: when it learned a new vendor pattern, when it changed its email-triage heuristic, when it promoted a new skill. The operator can replay why the AI behaves the way it does.
4. **HIPAA + PCI DSS + ISO 27001 compliance packets** — three more frameworks added to the existing SOC2 + GDPR packet generator.
5. **Hostile multi-tenant isolation** — close the gap OpenClaw explicitly disclaims. Tenant boundaries enforced at every layer. Less critical for a solo founder, but unlocks future multi-user deploys.

**Acceptance:** Founder can run `squidbot preflight "answer my emails"` and see the full action plan before approving. A draft mode toggles on `email.send` requiring confirmation per message.

### Phase 5 — Voice + Menu-bar shell  *(quick access)*

Push-to-talk overlay using Web Speech API in the renderer (no cloud STT — keeps zero-spend posture). macOS menu-bar variant of the Electron app — tray icon, popover window, quick "what's on my plate" shortcut. Out of scope: continuous "Voice Wake" hot-word detection.

**Acceptance:** Holding ⌘+Space opens a tiny floating chat panel that responds to voice. Tray icon menu shows today's briefing summary + approval count.

### Phase 6 — Deployment + Observability  *(later — for shipping to others)*

Dockerfile + docker-compose.yml for headless runtime. Prometheus `/metrics` endpoint mapping existing trace events. OTLP exporter for traces. New `npm run audit` command running all governance checks with severity + remediation. **Less urgent for a solo founder running locally**, but gates eventual sale to other businesses.

**Acceptance:** `docker compose up squidbot` runs the headless agent + dashboard. `npm run audit` exits 0 on a clean install.

### Phase 7 — Messaging adapter expansion  *(breadth — interleavable)*

Add LINE, Google Chat, IRC, Nostr, Synology Chat, Tlon, Twitch, Zalo, Nextcloud Talk. ~300 lines each, mostly copy-and-adapt from existing Slack/Discord/Telegram. Can be interleaved with other phases since each adapter is independent.

**Acceptance:** All 9 channels appear in Integrations → Messaging with the same allowlist + delivery-rule treatment.

## 4. Phase ordering rationale

```
Phase 1 (UI + Briefing home + Web reach)
     │
     ▼
Phase 2 (AI CEO operations — email/cal/briefings/proactive)
     │
     ▼
Phase 3 (Autonomy loop — CEO learns over time)
     │
     ▼
Phase 4 (Beyond-parity safety — pre-flight, draft mode, autonomy log)
     │
     ▼
Phase 5 (Voice + Menu-bar) →  Phase 6 (Deployment) →  Phase 7 (Messaging breadth)
```

Why this order:
- **Phase 1 first** because it's the reported active pain AND the Briefing home screen is the visible difference between "AI agent" and "AI CEO" — without it, Phase 2 has nowhere to surface.
- **Phase 2 second** because it makes "AI CEO" real. Email + calendar + briefings are the highest-leverage operations for a solo founder. Without it, SquidBot is still just a chat tool with extra trust features.
- **Phase 3 third** because once the AI CEO is operating, *learning from operation* is what makes it durable. Hermes-style autonomy without our audit layer is reckless; with it, it's a differentiator.
- **Phase 4 fourth** because by now the AI CEO has email-send authority and that needs explicit safety mechanisms (pre-flight, draft mode, autonomy ledger). Trust scales with action authority.
- **Phase 5 fifth** — quick-access surfaces. Useful but not gating.
- **Phase 6 sixth** — only matters when you ship to others.
- **Phase 7 last/interleavable** — each messaging adapter is independent; can be slotted between other phases as filler.

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

Resume Phase 1 brainstorm with two additions to scope: (a) the Briefing home screen replaces Chat as the default landing page, (b) the responsive shell is designed from day one to also serve as a web bundle behind Express. Sections 3 (state flow) and 4 (testing + acceptance) follow, then write the implementation plan and execute.

The other 6 phases each get their own brainstorm → design → plan cycle in the sequence above.
