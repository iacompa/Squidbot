# SquidBot Strategic Roadmap — Reconciled Against Future-Ready Agent Reference

**Date:** 2026-05-18 (created), 2026-05-21 (reconciled v2)
**Status:** Strategic positioning + phased plan reconciled against the authoritative reference docs in `~/Projects/SquidBot 2/docs/FUTURE_READY_AGENT_REFERENCE.md` (3,250 lines) and `FUTURE_READY_AGENT_EXECUTION_PLAN.md` (3,524 lines).
**Mission frame:** "The agent operating system you can trust, inspect, govern, and improve. Built for individuals, teams, and organizations — without project-side spend, without vendor lock-in, and with a tamper-evident trail of every decision."
**Primary differentiation statement (from reference §21):** "OpenClaw is the assistant everywhere. Hermes is the agent that learns. SquidBot is the agent operating system you can trust, inspect, govern, and improve."

---

## 0. Why this v2 reconciliation exists

The v1 roadmap (2026-05-18 original) framed SquidBot's competitive position as **"audit-first AI CEO for a solo founder"** — a personal-user lens. It proposed 7 phases: responsive UI / AI CEO operations / autonomy loop / beyond-parity safety / voice & menu-bar / deployment / messaging.

Re-reading the reference docs (which predate the v1 roadmap by 3 weeks) revealed the v1 was **narrower than your stated vision**. The reference doc frames SquidBot as an **agent operating system for individuals, teams, *and* organizations** — with explicit demands for:

- **AI Studio + Blueprint Center** (reference §6.15) — centralized hub for designing, testing, approving, deploying, and measuring agents. **Neither OpenClaw nor Hermes ships this.** PwC research (§5.10) confirms it's the enterprise adoption pattern.
- **Vertical Blueprint Library** (§5.12) — business-ready packages for sales, support, finance, HR, healthcare, automotive dealerships, government, aviation, regulated finance, etc.
- **Universal Integration Fabric** (§6.13) — connector builder that imports API specs, infers resources, generates manifests + mock servers + tests + approval gates.
- **Enterprise Profile + Adaptive UI** (§6.16) — UI that adapts based on industry, with admin-reviewable generated dashboards/reports.
- **Responsible AI Center** (§16.8) — policy packs, red-team tests, prompt-injection tests, fairness review, regulatory evidence collection.
- **Digital Twins + Scenario Analysis** (§12.4) — "what if" simulations of business operations.
- **Federated governance** (§19.3.1) — shared skill libraries / policy packs with local approval, air-gapped update bundles.

None of these were on the v1 roadmap.

**This v2 reconciles the gap.** It is not a feature dump — it's the explicit mapping of (a) every reference doc capability, (b) what's already in the code, (c) what's missing, (d) the new phase ordering that closes the gap with the smallest possible scope expansion.

---

## 1. Positioning

SquidBot's identity is **"the agent operating system you can trust, inspect, govern, and improve."**

Defensible against both competitors:
- **Hermes can't add chained-hash audit + RBAC + compliance packets + AI Studio + Blueprint catalog** without a 6+ month detour from its research focus.
- **OpenClaw explicitly disclaims hostile multi-tenant isolation** (per its docs) and lacks the eval/canary/promote pipeline + AI Studio that would make managed enterprise rollout possible.

Three dimensions where SquidBot is — or will be — demonstrably #1 of the three:

1. **Inspectable autonomy.** Every action recorded with chained-hash audit. Every tool call has a "why." Pre-flight dry-run shows what an upcoming task will touch *before it runs*. Sandboxed per tool call, not just per patch.
2. **Self-improving + auditable.** Hermes-style autonomy (skill self-improvement, memory nudges, MCP server mode) where every improvement *itself* lands in the audit trail.
3. **AI Studio + Blueprint Library for organizations.** Centralized hub for authoring, testing, approving, deploying, and measuring workflows — with built-in vertical blueprints for sales, support, finance, HR, healthcare, automotive, etc.

---

## 2. Capability mapping — reference doc → current code

The reference doc names 16 capability domains. The execution plan names 17 modules (16 + AI Studio as Module 17). This is the honest mapping of what's built today.

| Ref § | Capability | Status | Lives in / why |
|---|---|---|---|
| 6.1 | Conversation + interface layer | ✅ **Done** | Electron desktop + CLI + web bundle (Phase 1 work landed 2026-05-21) |
| 6.2 | Model router | ✅ **Done** | `@squidbot/models` — 9 providers + live discovery + budget enforcement + fallback chain |
| 6.3 | Tool registry + execution | ✅ **Done** | `@squidbot/core` (ToolRegistry) + `@squidbot/connectors` (manifest connectors + sensitivity-gated approval queue + MCP client) |
| 6.4 | Structured semantic memory | ✅ **Done** | `@squidbot/memory` (typed graph w/ FTS5 + deterministic pseudo-embeds, hybrid retrieval, memory bulletins) |
| 6.5 | Reflection + learning loop | ⚠ **Partial** | `@squidbot/reflection` (affordance detector, failure taxonomy) exists; **no auto-trigger from reflection → mutation proposer → benchmark → canary** |
| 6.6 | Skills + workflow system | ⚠ **Partial** | `@squidbot/skills` (manifest + loader + versioning) + `@squidbot/evals` (evaluator + canary + promote/rollback); **no visual workflow editor** |
| 6.7 | Planning + world modeling | ⚠ **Partial** | Planning happens inside the runtime; `@squidbot/sandbox` provides staging; **no digital twin / scenario analysis layer** |
| 6.8 | Multi-agent coordination | ✅ **Done** | `@squidbot/team` (blackboard, broker, coordinator, conflict detector, handoff, role registry, synthesis) |
| 6.9 | Developer instrumentation | ✅ **Done** | trace event taxonomy + History page in desktop + CLI `npm run traces` |
| 6.10 | Integrations + messaging | ⚠ **Partial** | 13 messaging adapters (need 9 more for OpenClaw parity); 4 manifest connectors (github/gitlab/jira/jenkins) shipped real-mode; **no business-system connectors yet (Salesforce, HubSpot, Stripe, Shopify, etc.)** |
| 6.11 | Governance + safety + compliance | ✅ **Done** | `@squidbot/governance` — RBAC + ABAC + chained-hash audit ledger + SOC2/GDPR compliance packets + retention + redaction + n8nBridge + 8 sensitivity profiles incl. air-gapped + identity store |
| 6.12 | Business + enterprise operating layer | ⚠ **Partial** | Identity store + 8 enterprise profile templates exist; **no AI Studio surface tying the pieces together** |
| **6.13** | **Universal Integration Fabric** | ❌ **Missing UI** | OpenAPI import works in `@squidbot/connectors` backend; **no connector builder UI in desktop app** — admins can't visually import an API spec, infer resources, configure permissions, generate mocks |
| 6.14 | Competitor mention policy | ✅ **Done** | Internal docs reference; product UI never names OpenClaw/Hermes |
| **6.15** | **AI Studio + Blueprint Center** | ❌ **Not built** | Reference's centerpiece capability. **Doesn't exist.** Should host: blueprint catalog, workflow canvas, agent role builder, connector selector, data source selector, policy/approval builder, fixture/test data manager, benchmark runner, KPI dashboard, ROI dashboard, deployment readiness checklist, pilot/canary controls, user feedback collection, skill leaderboards, promotion/rollback |
| **6.16** | **Enterprise Profile + Adaptive Native Experience** | ⚠ **Profile data yes, no adaptive UI** | 8 profile templates exist; **no UI that adapts dashboards / workflows / reports based on industry** |
| 16.8 | Responsible AI Center | ⚠ **Policies yes, no center** | Policy packs in governance package; **no dedicated UI surface for policy management, red-team tests, prompt-injection tests, fairness review, regulatory evidence collection** |

**Summary:** 8 capabilities fully built. 6 partial (backend strong, frontend/glue missing). **2 entirely missing — AI Studio and Connector Builder UI.** Plus Responsible AI Center which exists as primitives but lacks the centralized surface.

---

## 3. What's done since v1 of this roadmap

**Phase 1 — Responsive UI + Briefing home + Web reach** shipped in 31 commits (2026-05-18 → 2026-05-21):

- Three-tier responsive system (mobile <768px / tablet 768–1023px / desktop ≥1024px)
- Hamburger drawer + focus trap + `inert` off-canvas + `prefers-reduced-motion` + body scroll lock
- New Briefing home screen (default landing) wired to real `listPendingApprovals` + `listJobs` IPCs; placeholder slots for Phase 2 email/calendar/financial data
- Web bundle: `apiTransport` (ipc / http auto-detect via Proxy) + `webApiBridge` (Express POST `/api/<method>`) + `serve-web.mjs` at localhost:8080
- 5-layer responsive test suite: 435 Vitest + 20 Playwright (web-smoke 3 / touch-targets 9 / a11y 3 / visual baselines 5)
- Audit trail: `audit-renderer-imports` script enforces no `electron`/`node:*` in renderer

Acceptance: 44/47 criteria fully met, 3 deviations documented inline (`docs/plans/2026-05-21-phase-1-acceptance-verification.md`).

---

## 4. Revised phase ordering (v2 — 10 phases)

Phases reordered for **leverage** and **dependency**. Each phase ships as a self-contained design + plan + commits.

### Phase 1 — Responsive UI + Briefing home + Web reach ✅ DONE

(See section 3 above. Done.)

### Phase 2 — **AI Studio v1** *(NEW headline — replaces v1 Phase 2)*

The reference doc's centerpiece. A unified control plane that ties together every existing backend (skills, evals, connectors, governance, teams, scheduler) into one workflow-design surface. **Neither OpenClaw nor Hermes ships this.**

Surfaces:
- **Blueprint catalog** — list of installed blueprints (vertical packages + user-created workflows)
- **Workflow canvas** — visual editor for assembling agents + tools + connectors + policies + data sources
- **Agent role builder** — define role manifests with permissions, memory domains, autonomy levels (uses existing `@squidbot/team`)
- **Connector selector** — pick from installed manifest connectors + MCP servers (uses existing registry)
- **Policy/approval builder** — assemble policy packs from existing governance primitives
- **Fixture/test data manager** — local fixtures for offline blueprint development
- **Benchmark runner** — runs the existing `@squidbot/evals` benchmark suite against the blueprint
- **KPI definition + ROI dashboard** — measurable business value per blueprint
- **Deployment readiness checklist** — gates promotion from draft → pilot → stable
- **Pilot/canary rollout controls** — uses existing canary pipeline
- **User feedback collection** — ratings, suggestions, issues per blueprint run
- **Skill leaderboards** — best-performing variants
- **Promotion/rollback** — uses existing `@squidbot/evals` workflow

**Acceptance:** A founder/admin can open AI Studio → pick a blueprint or create from scratch → assemble agents/tools/connectors → run against fixtures → benchmark → pilot → promote. Every step is auditable. Zero project-side spend.

**Why this is the highest-leverage next phase:**
- It's where every other capability becomes *visible and governable*
- It packages everything — Phase 2 (AI CEO ops), Phase 3 (autonomy), Phase 4 (safety), Phase 7 (messaging) all consume the Studio
- It's the PwC-research-backed enterprise adoption pattern (reference §5.10)
- It's a clean **differentiator vs OpenClaw + Hermes** — neither ships this

### Phase 3 — **Vertical Blueprint Library v1**

Pre-packaged blueprints that ship with the app and run in fixture mode out of the box. From reference §5.12:

- **Customer support** — ticket triage, SLA risk, suggested replies, knowledge base improvement, escalation routing
- **Sales** — lead qualification, account research, follow-up drafts, CRM hygiene, pipeline summaries
- **Finance** — invoice review, expense triage, budget variance, month-end checklist
- **HR/recruiting** — candidate packets, interview prep, onboarding checklists, policy Q&A
- **Engineering** — PR review, CI failure diagnosis, incident response, release notes (overlaps with the alpha killer demo from reference §20.2)
- **AI CEO operations** — email triage, calendar mgmt, daily briefing scheduler, proactive task initiation (was Phase 2 in v1 roadmap; now a blueprint)

Each blueprint includes:
- Business goal + target users
- Required data sources + connectors
- Agent roles + human approval points
- Policy + risk profile
- Offline fixture dataset
- Evaluation suite
- KPI dashboard
- Rollout checklist
- Failure/escalation plan

**Rule (reference §5.12):** Every blueprint runs in fixture mode with no project-side spend, no paid vendor credentials. High-stakes blueprints (healthcare, gov, finance) default to read-only until org enables writes.

**Acceptance:** All 6 blueprints installable from AI Studio. Each runs end-to-end with fixture data. Each has a working benchmark suite. AI CEO ops blueprint can be activated with user-provided Gmail/Calendar credentials.

### Phase 4 — **Autonomy loop** *(unchanged from v1 Phase 3)*

Three Hermes-parity items wired together via the existing eval pipeline so every improvement is audit-tracked:

1. **MCP server mode** — expose SquidBot as an MCP server so Hermes / Claude Desktop / any MCP client can call SquidBot skills + blueprints. Every external call enters the audit ledger.
2. **Skill self-improvement trigger loop** — wire reflection events to existing `mutationProposer` → benchmark suite → canary → promote/rollback. Audit log records every step.
3. **Memory write nudges** — periodic deterministic prompt: "Anything worth remembering from the last N interactions?" Proposed memories enter the existing approval flow.

**Critical Claude-testability:** this is the phase that lets *you* test SquidBot through Claude (you asked about this last message). Once MCP server mode lands, Claude.app can add SquidBot as a connector and you can drive it end-to-end as a quality check.

### Phase 5 — **Connector Builder UI + Universal Integration Fabric**

Surface the existing OpenAPI import backend through a proper admin UI. From reference §6.13:

- Import API spec (OpenAPI / Swagger / GraphQL / sample payloads)
- Infer resources, actions, scopes, data classifications
- Generate draft connector manifest
- Generate read-only tools first (write actions require explicit enable + policy)
- Generate mock server / fixture responses
- Generate schema validation tests
- Generate approval gates for writes
- Generate data lineage rules + redaction defaults
- Generate cost-owner labels
- Generate admin documentation
- Require human review before activation

**Rule (reference §6.13):** Healthcare, aviation, government, public safety, regulated finance, legal, critical infrastructure connectors **default to read-only** until org explicitly enables writes with policies, approvals, testing, and domain-owner signoff.

**Acceptance:** Admin can import the Salesforce / HubSpot / Stripe / Shopify OpenAPI spec, generate a connector, run it against fixtures, then promote to production with policies attached. Generated connector is auditable end-to-end.

### Phase 6 — **Beyond-parity safety** *(unchanged from v1 Phase 4)*

Five features neither competitor has:

1. **Pre-flight audit mode** — dry-run trace showing every tool/secret/email/cost an upcoming task will touch *before it runs*. Operator approves wholesale or edits.
2. **Sandboxed per tool call** — extend the existing sandbox-staging pattern from "before patches" to "before every write tool call." Reversible by default.
3. **Auditable autonomy log** — dedicated "improvement ledger" tracking every self-improvement (skill mutation, memory addition, learned preference). Auditors can replay.
4. **HIPAA + PCI DSS + ISO 27001 compliance packets** — three frameworks added to the SOC2/GDPR generator.
5. **Hostile multi-tenant isolation** — close the gap OpenClaw explicitly disclaims.

### Phase 7 — **Responsible AI Center**

Centralize the existing governance primitives into a single admin surface (reference §16.8):

- Policy pack management (visual editor + version history)
- Risk taxonomy builder
- Sensitive topic registry
- Bias and fairness review workflows
- Model/provider approval lists per profile
- Data classification rules
- Human approval rules per workflow
- **Red-team test suites** (prompt-injection, tool-injection, data-exfil)
- Data-flow inspection
- Generated artifact provenance
- AI usage disclosures (where required)
- Regulatory evidence collection (auto-builds compliance packets)
- Responsible AI dashboard (per-tenant, per-blueprint)

**Acceptance:** Compliance officer can open Responsible AI Center → see all policy packs → run red-team suite against a blueprint → review fairness check results → export regulatory evidence packet (SOC2/GDPR/HIPAA/PCI/ISO 27001).

### Phase 8 — **Adaptive Enterprise Profile UI**

Use the existing 8 enterprise profile templates to drive *adaptive UI generation* (reference §6.16):

- Generate role-specific home screens (e.g., "Compliance Officer" sees Responsible AI Center as default; "Sales Manager" sees CRM blueprint)
- Generate dashboard suggestions from connected systems + business KPIs
- Generate workflow suggestions from observed manual processes
- Generate approval flows from role + risk policies
- Generate report templates from business KPIs
- Generate connector onboarding checklists
- **Keep generated UI explainable, editable, versioned, and reversible** (rule from §6.16)
- AI-generated configuration must be reviewable before activation

**Acceptance:** Admin onboards a new tenant → picks "Automotive Dealership" profile → SquidBot generates a draft dashboard + workflow set + connector list for review → admin tweaks + activates → tenant users see the customized surface.

### Phase 9 — **Voice + Menu-bar shell** *(unchanged from v1 Phase 5)*

Push-to-talk via Web Speech API (no cloud STT — zero-spend). macOS menu-bar tray variant of the Electron app. Quick "what's on my plate?" shortcut.

### Phase 10 — **Digital Twins + Scenario Analysis**

From reference §12.4. Extend the existing sandbox into business-shaped simulations:

- Supply chain networks
- Inventory flows
- Finance forecasts
- Customer support queues
- Sales pipelines
- Workforce capacity
- IT incident response

Start simple: deterministic simulations + local spreadsheets + business rules. Probabilistic/ML forecasting can be added behind the same contract later.

### Phase 11 — **Deployment + Observability** *(was v1 Phase 6)*

Docker + docker-compose + Prometheus `/metrics` + OTLP exporter + `npm run audit` command. Required for any business deploy beyond a laptop.

### Phase 12 — **Messaging Adapter Expansion** *(was v1 Phase 7)*

9 missing channels (LINE, Google Chat, IRC, Nostr, Synology Chat, Tlon, Twitch, Zalo, Nextcloud Talk). Pattern is uniform; can be interleaved with other phases.

### Phase 13 — **Federated Governance**

From reference §19.3.1. Multi-installation deployments with shared skill libraries + policy packs, signed package distribution, air-gapped update bundles, trust-scoped federation. For organizations running SquidBot across departments, regions, or subsidiaries.

---

## 5. Phase ordering rationale

```
Phase 1 (UI + Briefing + Web reach) ✅ DONE
     │
     ▼
Phase 2 (AI Studio v1) ←─── the control plane that hosts everything below
     │
     ▼
Phase 3 (Vertical Blueprint Library) ←─── consumes Studio; includes AI CEO ops
     │
     ▼
Phase 4 (Autonomy loop — MCP server + self-improvement + memory nudges)
     │   └─── enables Claude.app testing of SquidBot via MCP connector
     ▼
Phase 5 (Connector Builder UI) ←─── enables business systems integration
     │
     ▼
Phase 6 (Beyond-parity safety — pre-flight audit, sandboxed-per-tool-call, autonomy ledger, HIPAA/PCI/ISO27001)
     │
     ▼
Phase 7 (Responsible AI Center) ←─── compliance officer surface
     │
     ▼
Phase 8 (Adaptive Enterprise Profile UI) ←─── industry-tailored experience
     │
     ▼
Phase 9 (Voice + menu-bar) → Phase 10 (Digital twins) → Phase 11 (Deployment + observability) → Phase 12 (Messaging breadth) → Phase 13 (Federation)
```

Why this order:
- **Phase 2 first** because the AI Studio is the surface every other capability becomes visible through. Without it, every business-facing feature is fragmented across pages.
- **Phase 3 second** because blueprints make the Studio tangible — without them it's an empty control plane. The AI CEO ops "phase" from v1 becomes a blueprint here, not a standalone workstream.
- **Phase 4 third** because once the Studio + blueprints exist, autonomy compounds on them. MCP server mode also unlocks Claude-driven testing.
- **Phase 5 fourth** because connector builder UI is what enables every business-system blueprint (CRM, ERP, commerce, finance) to be added without engineering.
- **Phase 6 fifth** because by now SquidBot has email-send / calendar-write / connector-write authority and needs explicit safety mechanisms. Trust scales with action authority.
- **Phase 7 sixth** because compliance officers need a dedicated surface once enterprise blueprints are in production.
- **Phases 8–13** are polish + breadth + scale items that compound on the core.

---

## 6. What's explicitly out of scope (per reference §3.3 + §20.3)

YAGNI ruthlessly:

- Native mobile apps (iOS Swift / Android Kotlin) — PWA via responsive web bundle covers it
- Continuous Voice Wake hot-word detection — push-to-talk only in Phase 9
- `computer_use` GUI control (Hermes ships this; we don't — conflicts with audit-first identity)
- `execute_code` arbitrary Python tool — same reason
- Hermes-style trajectory export for RL training — niche to Nous Research
- LanceDB / external vector DBs — local-first FTS5 + pseudo-embeddings is intentional
- OpenClaw "Live Canvas" — chat surface IS the canvas
- Termux Android support — PWA covers this
- Decorative dashboard before traces/approvals/memory/task state are useful (reference §3.3)
- Self-improvement that auto-promotes without evaluation gates (reference §3.3)
- Unrestricted host access by default (reference §3.3)

---

## 7. Success metrics

Per reference §18, every phase reports against these categories:

| Phase | Primary metric (reference §) | Target |
|---|---|---|
| 1 ✅ | Responsive coverage | 5-tier baselines + 9 surfaces × 44×44 + zero serious/critical a11y violations |
| 2 | Studio adoption (§18.7) | First blueprint authored end-to-end in <30 min |
| 3 | Blueprint benchmark pass rate (§18.7) | All 6 blueprints pass their fixture benchmark |
| 4 | Autonomy + Hermes parity | Skill auto-improves within 24h of failure detection w/ full audit trail; Claude.app can drive SquidBot via MCP |
| 5 | Universal integration (§6.13) | Salesforce/HubSpot/Stripe/Shopify each importable in <10 min |
| 6 | Beyond-parity safety | `npm run preflight "send email"` shows action plan before any side effect |
| 7 | Compliance (§18.6) | One-click export of SOC2/GDPR/HIPAA/PCI/ISO 27001 packet |
| 8 | Adaptive UI explainability | Every generated UI element shows source data + reviewability |
| 9 | Voice latency | <1s recognition; menu-bar opens in <300ms |
| 10 | Digital twin coverage | 3 business scenarios simulatable end-to-end |
| 11 | Deploy parity (§19.3.1) | `docker compose up squidbot` → healthy + observable |
| 12 | Messaging breadth | All 22+ channels match OpenClaw's matrix |
| 13 | Federation (§19.11) | 2-tenant deployment shares skills with trust scoping |

---

## 8. The Twenty-Year Durability Scorecard

Per reference §19.11, SquidBot grades itself periodically. As of 2026-05-21:

| Area | Question | Today's grade |
|---|---|---|
| Portability | Can a user export data and run elsewhere? | ⚠ Partial — SQLite + manifest connectors export; no full snapshot tool yet |
| Compatibility | Do old skills/memories survive upgrades? | ✅ — migrations versioned in `@squidbot/db` |
| Extensibility | Can users add capabilities without forking? | ✅ — manifest connectors + MCP client (server mode pending Phase 4) |
| Inspectability | Can users see why the agent acted? | ✅ — trace events + History page + audit ledger |
| Safety | Are high-risk actions staged/permissioned/logged? | ✅ — sensitivity profiles + approval queue + sandbox staging |
| Evolvability | Can skills improve without uncontrolled drift? | ⚠ — eval pipeline exists; auto-trigger pending Phase 4 |
| Accessibility | Can people use it across language/ability/device? | ⚠ Partial — responsive + touch + a11y done; multilingual deferred |
| Governance | Can teams define policy/retention/roles? | ✅ — RBAC + ABAC + policy packs + retention |
| Future models | Can new providers/modalities be added cleanly? | ✅ — ModelRouter abstracts; capability contracts in place |
| Community | Can outsiders contribute safely? | ⚠ Partial — open source but no plugin signing yet |
| Onboarding | Can new users get value quickly? | ⚠ Partial — Briefing home is the start; zero-spend quickstart needs docs |
| Feedback | Can real-world usage improve the roadmap? | ⚠ — affordance gaps captured; no rating UI yet |
| Benchmarks | Can claims be reproduced? | ✅ — eval suite + fixtures + leaderboards |
| Efficiency | Does the system respect limited hardware? | ⚠ Partial — local-first by default; no hardware profile system yet |
| Federation | Can organizations share safely without centralizing data? | ❌ — pending Phase 13 |

**Net: 6/15 ✅, 7/15 ⚠, 1/15 ❌.** Honest baseline. Phases 2–13 progressively raise grades.

---

## 9. Zero-spend audit

Per reference §4.2 and §2.7, SquidBot must build/test/run without project-side spend. As of 2026-05-21:

| Concern | Status |
|---|---|
| LLM | ✅ Mock provider + local Ollama path; BYOK paid providers optional w/ budget enforcement |
| Embeddings | ✅ Deterministic local pseudo-embeddings in `@squidbot/memory`; no hosted embedding API |
| Memory | ✅ SQLite + FTS5; no managed DB |
| Sandbox | ✅ Local process / temp workspace; no hosted sandbox |
| Browser automation | ✅ Playwright local; no hosted browser |
| Search | ✅ Local FTS5; no paid search API |
| Speech-to-text | N/A (Phase 9) |
| Text-to-speech | N/A (Phase 9) |
| Image generation | N/A — out of scope |
| Scheduler | ✅ Local in `@squidbot/scheduler` |
| Logs/metrics | ⚠ — local SQLite + trace events; Prometheus/OTLP pending Phase 11 |
| Messaging | ✅ Self-hostable adapters (email, IRC, Matrix, generic webhook); paid platform APIs are BYOK |
| CI | ✅ No hosted services required for tests |

**Net: zero-spend defaults respected.** Phase 11 adds optional Prometheus/OTLP exporters; they remain optional.

---

## 10. Open questions to resolve before Phase 2 design

Per reference §22, these are worth picking up before writing the Phase 2 (AI Studio) design doc:

1. **First vertical blueprint to ship in Phase 3?** Engineering (matches existing alpha killer demo) or Customer Support (highest business leverage) or AI CEO Operations (matches v1 framing)?
2. **AI Studio default sub-page on open?** Blueprint catalog or workflow canvas?
3. **Should workflow canvas be node-graph (React Flow) or stepper (linear list of stages)?** Node-graph is more powerful but heavier; stepper is faster to ship.
4. **Should benchmarks run client-side (in renderer) or server-side (in main process)?** Server-side is more capable but limits the web bundle.
5. **Should AI CEO operations stay as a Phase 3 blueprint or split into a separate workstream?** Reframing it as a blueprint reduces special-case code.

These get answered in the Phase 2 brainstorming pass.

---

## 11. Comparison statement (revised for v2)

| Question | Answer |
|---|---|
| Is SquidBot better than OpenClaw + Hermes today? | **Mixed.** Wins on governance/compliance/identity/audit + structured memory + multi-agent. Behind on autonomy, voice, deployment breadth, messaging breadth, **and lacks the AI Studio + Blueprint Library that the reference doc identifies as the centerpiece capability.** |
| Will SquidBot be better after the full 13-phase v2 roadmap? | **Yes — in the chosen identity.** "Trust + inspect + govern + improve" with an AI Studio + Blueprint Library that neither competitor ships. |
| What's the **minimum** to flip the answer to "yes"? | **Phase 2 + Phase 3 + Phase 4.** AI Studio v1 + Vertical Blueprint Library v1 + Autonomy loop. That's roughly 6–8 weeks of focused work. Phase 1 is the prerequisite that made all three viable. |
| What's the recommended next phase? | **Phase 2 — AI Studio v1.** Without it, Phase 3's blueprints have nowhere coherent to live. |

---

## 12. Next step

Brainstorm Phase 2 (AI Studio v1) using `superpowers:brainstorming`. The design doc should explicitly cite reference §6.15 + §5.10 (PwC pattern) + §6.12 (business operating layer requirements) as the input. Output is `docs/plans/<date>-ai-studio-v1-design.md` and the corresponding implementation plan.
