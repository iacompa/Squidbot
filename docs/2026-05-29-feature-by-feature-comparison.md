# Feature-by-Feature: OpenClaw + Hermes vs SquidBot

**Date:** 2026-05-29 · **Method:** code-verified (parallel agents read all three codebases). Companion to `2026-05-29-competitive-analysis-and-ratings.md` (which holds SquidBot's own ratings + fix log).

**Legend:** ✅ have (solid) · 🟡 partial/slice · ❌ missing · ⏸️ deliberate non-goal (per SquidBot vision §20.3 / §21.2 — "don't compete on breadth").

Each row: a feature OpenClaw (OC) and/or Hermes (H) ships → does SquidBot have it → note/plan. "Better?" flags where SquidBot's version is (or will be) stronger on its thesis (trust/inspect/govern/improve).

---

## 1. Interfaces & surfaces

| Feature (OC/H) | SquidBot | Note / plan |
|---|---|---|
| CLI | ✅ | ✅ `apps/cli` (single-entry, ~30 commands) |
| Desktop app | OC menu-bar; H web dash | ✅ Electron, 23 pages | SquidBot's desktop is richer (governance/trust/memory-graph/evals/studio pages) |
| TUI (full-screen terminal UI) | OC ✅ / H Ink TUI | ❌ | ⏸️ low priority; CLI covers it |
| Web / PWA control surface | OC ✅ / H ✅ | 🟡 web bundle exists, **bridge unauthenticated** | Plan: auth the web bridge (5.7) before promoting |
| Slash commands | OC ✅ / H ✅ | 🟡 CLI subcommands, no in-chat `/cmd` | Minor; add in-chat slash router later |
| Live Canvas / agent-driven UI (OC) | OC ✅ | ❌ | ⏸️ "chat is the canvas" (vision §6.3 out-of-scope) |
| Theming / i18n | OC ✅ / H ✅ | 🟡 single theme, English | ⏸️ deferred (vision: multilingual deferred) |

## 2. Model providers

| Feature | SquidBot | Note / plan |
|---|---|---|
| BYOK provider count | OC 60+ · H 25+ | 🟡 1 OpenAI-compatible (covers OpenAI/OpenRouter/Gemini/Groq/Together/Ollama/etc. via one wire format) + local + mock | ⏸️ breadth is a non-goal; the OpenAI-compat path already reaches most providers. Plan: provider-preset catalog (exists in `providerCatalog.ts`) |
| OAuth / subscription auth (ChatGPT/Grok/Copilot) | OC ✅ / H ✅ | ❌ | ⏸️ deferred; BYOK key is the supported path |
| Runtime model switching | OC ✅ / H ✅ | ✅ `model.useAccount` (chat-driven + CLI) |
| Cross-provider fallback | OC ✅ / H ✅ | ✅ router fallback chain | **Better:** now surfaces a paid→free fallback note to the user (2.3) |
| Per-token cost tracking + budgets | OC usage / H insights | ✅ token accounting + **per-account daily budget** (3.1) | **Better:** cost-owner labels + hard budget + zero-spend default |
| Request timeout | — | ✅ 60s AbortController (2.7) |

## 3. Tool execution & agent loop

| Feature | SquidBot | Note / plan |
|---|---|---|
| Multi-step agent loop (sees tool results) | OC ✅ / H ✅ | ✅ **FIXED** — real loop + cap + dedup (was broken) |
| Tool registry w/ schema/risk/permission | OC ✅ / H ✅ | ✅ + **governance-gated** (PolicyEngine + ABAC) | **Better:** every tool call is policy-checked + audited |
| Streaming tool/token output | OC ✅ / H ✅ | ❌ | **Plan (next):** streaming + cancellation (C2) — needs running app to verify |
| `execute_code` (agent writes code calling tools) | H ✅ | ❌ | ⏸️ conflicts with audit-first identity (vision out-of-scope) |
| Browser automation / computer-use | OC ✅ / H ✅ | ❌ | ⏸️ `computer_use` explicitly out-of-scope (vision §20.3) |
| Tool-arg validation vs schema | — | 🟡 deferred (3.6) | Loop now surfaces tool errors so the model self-corrects |
| Pluggable agent runtimes/harnesses (Codex/Copilot/Claude CLI/ACP) | OC ✅ | ❌ | ⏸️ niche; not core thesis |

## 4. Memory

| Feature | SquidBot | Note / plan |
|---|---|---|
| Structured/semantic memory | OC file+search · H curated | ✅ **typed graph** w/ provenance/confidence/edges | **Better:** graph + provenance vs flat notes |
| Hybrid FTS + vector search | OC ✅ / H session_search | ✅ FTS5 + pseudo-embeddings (FTS no longer truncates — 1.7) | Plan: optional real local embeddings (M2) |
| Contradiction handling | OC Wiki / — | ❌ (1.4) | Plan: `contradicts` edge on conflicting approval (hard/fuzzy — deterministic heuristic) |
| Memory consolidation ("Dreaming") | OC ✅ | ❌ | ⏸️ novel to OC; not core thesis |
| Memory write nudges | OC commitments / H review | 🟡 reflection captures candidates | Plan: periodic nudge (Phase 4) |
| Sensitivity-scoped retrieval | — | 🟡 (1.6) | ⏸️ moot in single-operator; needed for multi-tenant |
| User model / personalization | OC USER.md / H Honcho | 🟡 enterprise profiles + onboarding | Partial |

## 5. Reflection / self-improvement (SquidBot thesis axis)

| Feature | SquidBot | Note / plan |
|---|---|---|
| Reflection after tasks | 🟡 / H ✅ | ✅ taxonomy + affordance gaps + memory-graph link |
| Self-improving skills | H ✅ (forked review agent) | ✅ **autonomy loop** (R2) — reflection→propose→eval-gate→canary | **Better:** eval-gated + audited + never auto-promotes (Hermes auto-creates skills without an eval gate) |
| Skill lifecycle / curator | H ✅ | 🟡 versioning + promote/rollback | Partial; no auto-archive of stale variants yet |
| Skills count / Skills Hub | OC ~55 / H 19k catalog | 🟡 manifest + few skills | ⏸️ breadth; SquidBot competes on eval-gating not count |

## 6. Multi-agent

| Feature | SquidBot | Note / plan |
|---|---|---|
| Sub-agent delegation | OC ✅ / H ✅ | ✅ team broker + delegation |
| Persistent role-based teams | OC routing / — | ✅ blackboard + coordinator + roles + conflict detection | **Better:** persistent teams vs one-off delegation |
| Kanban/swarm board (H) | H ✅ | ❌ | ⏸️ niche |

## 7. Messaging / channels

| Feature | SquidBot | Note / plan |
|---|---|---|
| Channel count | OC ~24 / H 24 | 🟡 **1 real (Slack)**, 9 fixtures + 27-platform matrix | ⏸️ **deliberate non-goal** (vision §20.3: don't chase channel count). Gateway/allowlist/approval-bridge are real |
| Group-chat / DM pairing / allowlists | OC ✅ / H ✅ | ✅ allowlist + approval bridge + webhook security |
| Media in/out | OC ✅ / H ✅ | 🟡 attachment normalization | Partial |

## 8. Voice / media generation

| Feature | SquidBot | Note / plan |
|---|---|---|
| Voice (STT/TTS/talk/wake) | OC rich / H rich | ❌ | ⏸️ deferred to Phase 9 (vision) — push-to-talk only, no cloud STT |
| Image/video/music generation | OC ✅ / H ✅ | ❌ | ⏸️ out-of-scope (vision) |

## 9. Integrations & protocols

| Feature | SquidBot | Note / plan |
|---|---|---|
| MCP client (consume servers) | OC ✅ / H ✅ | ✅ pooled client |
| **MCP server (expose self)** | OC ✅ / H ✅ | ✅ **ADDED** (N2) — 68 governed tools over stdio | **Better:** every external call is PolicyEngine-gated + audited |
| ACP editor server (VS Code/Zed) | H ✅ | ❌ | ⏸️ niche |
| Connector framework + OpenAPI import | OC skills / H | ✅ registry + importer + real HTTP + SSRF guard | **Better:** sensitivity-policy + approval-queue + audit on every call |
| Web search providers | OC 12 / H 8 | ❌ | ⏸️ breadth non-goal |
| Real dev integrations (GitHub etc.) | OC ✅ / H ✅ | 🟡 GitHub read real; writes approval-gated | Plan: E2E PR-creation UX (N4) |
| Home Assistant / Spotify / domain connectors | H ✅ | ❌ | ⏸️ breadth |

## 10. Sandbox / safety

| Feature | SquidBot | Note / plan |
|---|---|---|
| Sandboxed execution | OC Docker/SSH / H 6 backends | 🟡 local spawn + net-block heuristic | Plan: optional Docker backend behind same iface (S1) |
| Per-tool allow/deny + risk policy | OC ✅ / H ✅ | ✅ PolicyEngine + governance ABAC | **Better:** ABAC + sensitivity profiles |
| Approval gating | OC pairing / H approvals | ✅ queue + risk tiers + lock | **Better:** chained-hash audited |
| Serverless/cloud sandbox (Modal/Daytona) | H ✅ | ❌ | ⏸️ breadth |

## 11. Governance / security / audit (SquidBot's moat)

| Feature | SquidBot | Note / plan |
|---|---|---|
| **Chained-hash tamper-evident audit** | ❌ / ❌ | ✅ **unique to SquidBot** | **Better:** neither competitor has this |
| RBAC/ABAC + policy packs | OC scopes / H | ✅ full engine, runtime-wired | **Better:** real ABAC vs scopes |
| Secrets at rest | OC keychain / H Bitwarden | ✅ **FIXED** AES-256-GCM, key outside DB, migration | At parity, now |
| Secret redaction (traces/logs) | OC ✅ / H ✅ | ✅ + GitHub/Slack/AWS/JWT/Bearer patterns (2.1) |
| SSRF / command-injection guards | OC ✅ / H ✅ | ✅ SSRF + MCP allowlist |
| Compliance packets (SOC2/GDPR/HIPAA…) | ❌ / ❌ | ✅ SOC2/GDPR generator | **Better (unique);** plan: + HIPAA/PCI/ISO |
| Supply-chain audit | OC `security audit` / H OSV | 🟡 `verify:security` harness | Partial |
| Tenant isolation | OC single-op / H profiles | 🟡 primitives, not all callsites | Plan: sweep (G8) |

## 12. Observability

| Feature | SquidBot | Note / plan |
|---|---|---|
| Trace viewer / timeline / replay | OC trajectory / H trajectory | ✅ trace + replay + cost waterfall + UI | **Better:** replay-from-events + cost waterfall |
| Trace persisted even on failure | — | ✅ FIXED (2.4) |
| Metrics export (OTel/Prometheus) | OC ✅ / H Langfuse | ❌ | ⏸️ deferred (Phase 11); local-first default |
| Trajectory export for RL training | H ✅ | ❌ | ⏸️ niche to Nous Research |

## 13. Autonomy / scheduling

| Feature | SquidBot | Note / plan |
|---|---|---|
| Scheduled tasks (cron) | OC ✅ / H ✅ | ✅ `packages/scheduler` + Jobs page |
| Heartbeat / inferred commitments | OC ✅ | 🟡 briefing home | Partial |
| Hooks / lifecycle events | OC ✅ / H ✅ | 🟡 event taxonomy | Partial |

## 14. AI Studio & blueprints (SquidBot's centerpiece — neither competitor has it)

| Feature | SquidBot | Note / plan |
|---|---|---|
| Blueprint backend (manifest/registry/versioning) | ❌ / ❌ | ✅ | **Unique** |
| Blueprint catalog UI | ❌ / ❌ | 🟡 **shipped** (list/detail/export) | **Unique;** plan: canvas/KPI/deploy tabs |
| Visual workflow canvas | ❌ / ❌ | ❌ | Plan: next big UI session (needs running app) |
| KPI/ROI dashboards + deploy/canary controls | ❌ / ❌ | ❌ | Plan |

## 15. Deployment / distribution

| Feature | SquidBot | Note / plan |
|---|---|---|
| npm install + daemon / Docker / cloud | OC ✅ / H ✅ | ❌ desktop only | ⏸️ deferred (Phase 11) |
| Auto-update + rollback | OC ✅ / H ✅ | ❌ | ⏸️ deferred |
| Doctor / diagnostics | OC `doctor --fix` / H ✅ | ✅ `squidbot doctor` | At parity |
| Migration importers (from Claude/OC/Hermes) | OC ✅ / H ✅ | ❌ | ⏸️ niche |

## 16. Extensibility

| Feature | SquidBot | Note / plan |
|---|---|---|
| Plugin SDK | OC ClawHub / H plugins | ❌ `packages/productization` empty | **Plan (candidate next):** build the SDK scaffold (E1) — backend, verifiable |
| Connector/skill manifests as extension points | OC ✅ / H ✅ | ✅ manifests + OpenAPI/MCP import |
| Marketplace | OC ClawHub / H Skills Hub | ❌ | ⏸️ breadth/scale |

---

## Summary

**SquidBot now matches or beats both competitors on its thesis axes:** trust (chained-hash audit — unique), governance (ABAC — stronger), traces/replay, structured graph memory, eval-gated self-improvement (stronger than Hermes), MCP interop (now at parity), and the unique AI Studio (catalog shipped). **It deliberately does not chase** the breadth axes (channel/provider count, voice, media-gen, cloud deploy, marketplace) per its own strategy docs — those are explicit non-goals, not gaps.

**Genuine remaining gaps to close** (not non-goals): streaming (C2), full AI Studio (canvas/KPI/deploy), plugin SDK (E1), real GitHub-write UX (N4), Docker sandbox backend (S1), more compliance packets. These are tracked with ratings in the companion doc.
