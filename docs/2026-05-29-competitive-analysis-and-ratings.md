# SquidBot vs OpenClaw vs Hermes — Code-Verified Competitive Analysis, Ratings & Hardening Plan

**Date:** 2026-05-29
**Author:** AI analysis pass (code-verified against all three codebases + SquidBot's own reference docs)
**Method:** Four parallel research agents cataloged OpenClaw (`zz- insperation/openclaw-main`), Hermes (`zz- insperation/hermes-agent-main`), SquidBot's *actual* code (not its optimistic docs), and SquidBot's vision/criteria docs. Findings cross-checked by direct reads of the runtime, providers, and the 10/10 hardening backlog.

> The two reference projects are **inspiration only** — never committed, never imitated wholesale. They set the bar; SquidBot wins on its own thesis.

---

## 0. Honest Scope Reality (read first — Karpathy rule #1)

OpenClaw (~129 plugins, 60+ model providers, ~24 chat channels, voice, native macOS/iOS/Android apps, Live Canvas, Dreaming memory) and Hermes (24 channels, real closed-loop self-improvement, 6 sandbox backends incl. serverless, MCP client+server, ACP, trajectory training tooling) each represent **person-years** of work. SquidBot is a ~343-file TS monorepo.

**"Match every feature, but better" is not literally achievable** — and SquidBot's own reference docs (§2.3, §21.2) explicitly say *do not try*: "SquidBot can be worse at channel count, bundled-skill count, mobile polish, marketplace size — these are scale features, not the core bet."

So "SquidBot is the obvious choice" is interpreted the way the vision docs define it — **the obvious choice for the buyer who needs a trustworthy, inspectable, governable, self-improving agent OS** (developers, teams, regulated orgs). The win condition is:

1. The **core agent loop actually works** and is excellent (today it is broken — see BUG-001).
2. The **differentiated pillars** (trust/audit, structured memory, eval-gated evolution, governance/compliance, AI Studio) are genuinely best-in-class — beating both competitors *on those axes*.
3. **All bugs fixed**; every shipped feature honestly rated ≥8.5.
4. Where SquidBot deliberately doesn't match breadth, that's stated honestly, not faked.

This document drives the work. Ratings are updated in place as fixes land.

---

## 1. Differentiation thesis (from SquidBot's own reference §21)

> "OpenClaw is the assistant everywhere. Hermes is the agent that learns. **SquidBot is the agent operating system you can trust, inspect, govern, and improve.**"

SquidBot does **not** compete on channel count or generic "self-improving" language. It competes on: **trust · traces/replay · structured graph memory · eval-gated evolution · governance/compliance · AI Studio + blueprints.**

---

## 2. Feature Comparison Matrix

Legend — Status: ✅ shipped & solid · 🟡 partial/scaffold · 🟥 stub/placeholder · ⬜ absent.
Rating = honest 1–10 of SquidBot's *current* implementation (not the competitor's). Target ≥8.5.

| # | Capability | OpenClaw | Hermes | SquidBot status | Rating | Gap → action |
|---|---|---|---|---|---|---|
| **CORE AGENT** |
| C1 | Multi-step agentic tool loop (model sees tool results, iterates) | ✅ | ✅ | ✅ **real loop + cap(8) + dedup; results fed back** | **8.5** | ✅ **FIXED** (BUG-001) — TDD'd, full suite green |
| C2 | Streaming tool/token output | ✅ | ✅ | ⬜ blocking only | **4** | Add streaming + cancellation |
| C3 | Tool registry w/ schema, risk, permission, dry-run | ✅ | ✅ | ✅ strong (governance-gated) | **8** | Validate args vs inputSchema (3.6) |
| C4 | Model router: capability/cost/latency + fallback + budgets | ✅ | ✅ | ✅ router+fallback+budget | **8** | Per-account budget (3.1); fetch timeout (2.7) |
| C5 | Provider breadth (BYOK) | 60+ | 25+ | 🟡 1 OpenAI-compat + local + mock | **6** | Add Anthropic + Ollama native; provider catalog |
| **MEMORY** |
| M1 | Structured/semantic memory | ✅ hybrid+Dreaming+Wiki | ✅ pluggable | ✅ typed graph + FTS + provenance | **8** | Real strength |
| M2 | Vector/embedding retrieval | ✅ real embeds | ✅ | 🟡 **hash pseudo-embeddings** | **6** | Optional real local embeddings behind contract |
| M3 | Contradiction detection | 🟡 (Wiki) | 🟡 | ⬜ missing (1.4) | **5** | Add `contradicts` edge + operator prompt |
| M4 | Sensitivity-scoped retrieval | 🟡 | ✅ (promptware) | 🟥 labels not enforced (1.6) | **5** | Enforce at retrieval |
| **REFLECTION / EVOLUTION** |
| R1 | Reflection + missing-affordance capture | 🟡 | ✅ | ✅ taxonomy + gaps + graph | **8** | Strength |
| R2 | Eval-gated skill evolution (variant→bench→canary→promote/rollback) | 🟡 | ✅ self-improve | 🟡 pipeline exists, not auto-triggered | **7** | Wire reflection→mutation→canary autotrigger |
| R3 | Skills system | ✅ AgentSkills | ✅ + Hub (19k) | 🟡 manifest+evaluator, few skills | **7** | Add reference skills; importer |
| **SAFETY / GOVERNANCE (SquidBot's moat)** |
| G1 | Approval-gating high-risk actions | ✅ | ✅ | ✅ queue + risk tiers + lock | **8.5** | Approval path → governance (2.2) |
| G2 | Chained-hash tamper-evident audit | ⬜ | ⬜ | ✅ **unique** | **9** | Keep; surface in every flow |
| G3 | RBAC/ABAC + policy packs | 🟡 scopes | 🟡 | ✅ full engine, wired to runtime | **8.5** | Owner-role RBAC bypass (2.6) |
| G4 | Secrets at rest | ✅ keychain/Bitwarden | ✅ Bitwarden | ✅ **AES-256-GCM; key in 0600 file outside DB; legacy-key migration** | **8.5** | ✅ **FIXED** (BUG-002 1.2+1.3) — TDD'd, security harness green |
| G5 | SSRF / command-injection guards | ✅ | ✅ | ✅ SSRF + MCP allowlist (Sprint 0) | **8.5** | Good |
| G6 | Secret redaction in traces/logs | ✅ | ✅ | ✅ **+ GitHub/Slack/AWS/JWT/Bearer patterns** | **8.5** | ✅ FIXED (2.1) — TDD'd, no over-redaction |
| G7 | Compliance packets (SOC2/GDPR/…) | ⬜ | ⬜ | ✅ generator (SOC2/GDPR) | **8** | Add HIPAA/PCI/ISO |
| G8 | Tenant isolation | ⬜ (single-op) | 🟡 profiles | 🟡 primitives, not all callsites | **6** | Sweep callsites |
| **SANDBOX** |
| S1 | Sandboxed execution | ✅ Docker/SSH/OpenShell | ✅ 6 backends incl serverless | 🟡 local spawn + heuristic net-block | **6** | Doc backend behind iface (optional) |
| **MULTI-AGENT** |
| A1 | Persistent role-based teams | 🟡 routing | ✅ Kanban swarm | ✅ broker+blackboard+coordinator | **8** | Role-scoped tool filtering |
| **OBSERVABILITY** |
| O1 | Trace viewer / timeline / replay | ✅ trajectory | ✅ trajectory+compress | ✅ trace+replay+cost waterfall+UI | **8.5** | Strength; trace-on-throw (2.4) |
| O2 | Metrics export (OTel/Prom) | ✅ plugins | ✅ Langfuse | ⬜ local only | **5** | Optional exporter (deferred) |
| **INTERFACES** |
| I1 | Desktop app | menu-bar | web dash | ✅ Electron, 22 pages | **8** | Strength |
| I2 | CLI / TUI | ✅ rich CLI | ✅ Ink TUI | 🟡 single-entry CLI | **6** | OK; TUI deferred |
| I3 | Messaging channels | ~24 | 24 | 🟥 **9/10 are fixtures; only Slack real** | **4** | Make Discord/Telegram real |
| I4 | Voice (STT/TTS) | ✅ rich | ✅ rich | ⬜ none | **N/A** | Deferred (vision §20.3) |
| I5 | Web/PWA reach | ✅ | ✅ | 🟡 web bridge (no auth) | **5** | Auth the bridge (5.7) |
| **INTEGRATIONS** |
| N1 | MCP client (consume servers) | ✅ | ✅ | ✅ pooled client | **8** | Strength |
| N2 | MCP server (expose self) | ✅ | ✅ | ⬜ **absent** | **N/A** | Add — unlocks Claude-driven testing |
| N3 | Connector framework + OpenAPI import | ✅ | 🟡 | ✅ registry+importer+HTTP | **8** | Strength |
| N4 | Real dev integrations (GitHub etc.) | ✅ skills | ✅ | 🟡 GitHub read real; writes gated | **6** | E2E PR-creation UX |
| **AI STUDIO (the centerpiece differentiator)** |
| ST1 | Blueprint backend (manifest/registry/versioning) | ⬜ | ⬜ | ✅ backend only | **7** | Backend solid |
| ST2 | AI Studio UI (catalog, canvas, KPI, deploy) | ⬜ | ⬜ | 🟥 **designed, never built** | **2** | Build the UI — unique moat |
| **DISTRIBUTION** |
| D1 | Daemon/service, Docker, cloud deploy | ✅ rich | ✅ rich | ⬜ desktop only | **4** | Deferred (vision §20.3) |
| D2 | Auto-update + doctor + migration import | ✅ | ✅ | 🟡 doctor yes; no updater/import | **6** | Doctor strong; rest deferred |
| **EXTENSIBILITY** |
| E1 | Plugin SDK | ✅ ClawHub | ✅ | 🟥 `productization` empty | **3** | Build SDK scaffold |

**Scorecard today (shipped/partial features):** mean ≈ **6.3/10**. Pillars where SquidBot already leads or ties (G2 audit, G3 RBAC, O1 traces, M1 memory, G1 approvals, ST1 blueprint backend) are 8–9. The drags are **core correctness (C1/C2), secrets-at-rest (G4), messaging reality (I3), and the unbuilt AI Studio UI (ST2)** — exactly the work list.

---

## 3. Bug List (prioritized) — "find and fix all bugs"

Confirmed by direct code read or by SquidBot's own two-audit backlog (`docs/superpowers/plans/2026-05-26-...md`, Sprints 1–5). P0 = breaks the core promise.

### P0 — existential
- **BUG-001** Single-round tool loop — model never sees tool results (`runtime.ts:297-303`). The agent can't do multi-step work. *(confirmed by read)*
- **BUG-002** API keys + vault master key stored **plaintext** in the same SQLite the vault protects (`modelAccounts.ts:217`, `localEncryptedVault.ts:57-64`).

**✅ RESOLVED this session:** BUG-001, BUG-002 (1.2+1.3), 1.7, 2.3, 2.4, 2.7. **2.6 verified NOT a bug** (owner bypasses RBAC permission grants by design, but ABAC deny/zero-spend/approval/sandbox still apply — gated correctly in `policyEngine.ts`).

### P1 — correctness / security
- ✅ ~~1.7 FTS truncated to 12 tokens~~ · 1.4 Memory contradiction detection missing · 1.5 memory approval check-then-insert race · 1.6 sensitivity labels not enforced at retrieval
- ✅ ~~2.3 BYOK→local fallback silent~~ · ✅ ~~2.4 trace dropped when sendMessage throws~~ · ✅ ~~2.7 BYOK fetch has no timeout~~ · 2.1 connector responses leak creds into traces · 2.2 approval queue bypasses governance · 2.6 owner role bypasses RBAC *(by design — closed)*
- 3.1 per-account budget keyed by provider not account · 3.6 tool args not validated vs inputSchema *(deferred — breakage risk; loop now surfaces tool errors for self-correction)*

### P2 — UX / robustness
- 3.4 no streaming/cancellation · 3.7 React setState-after-unmount in ChatPage · 3.8 chat UI history lost on nav · 3.9 CLI REPL exits on first error
- 4.1/4.2 Settings deep-links + tab routing broken · 4.3 feedback modal dark-in-light · 4.4 Trust+Approvals same icon · 4.5 settings-load failure → infinite skeleton · 4.6 modal no focus-trap · 4.10 memory delete no confirm · 4.11/4.12 aria gaps

### P3 — coverage
- 5.1 preload↔ipc symmetry test · 5.3 axe on all pages · 5.7 web bridge rejects unknown/proto-pollution methods

---

## 4. Execution Plan (priority order; each item TDD'd + verified)

**Sprint A — Core agent works (P0 correctness).**
1. **BUG-001 agentic tool loop** — message type carries tool-call linkage; runtime loops with cap + dedup; apiProvider serializes `tool_calls`/`tool`; deterministic provider terminates on tool results. ← *starting now*
2. **C2 streaming + cancellation** — incremental output + `cancelChat`.
3. **3.6 tool-arg validation**, **2.4 trace-on-throw**.

**Sprint B — Secrets & governance integrity (P0/P1 security).**
4. **BUG-002 encryption at rest** — Electron `safeStorage`/keychain; vault key out of DB.
5. 2.1 redaction expansion · 2.2 approval→governance · 2.6 owner RBAC · 2.7 fetch timeout · 3.1 per-account budget.

**Sprint C — Memory integrity (P1).**
6. 1.4 contradiction · 1.5 approval race · 1.6 sensitivity enforcement · 1.7 FTS.

**Sprint D — Differentiators that beat the field.**
7. **ST2 AI Studio UI** (the unique moat — designed, never built).
8. **N2 MCP server mode** (lets Claude drive SquidBot — also a test surface).
9. **R2 autonomy loop** (reflection→eval→promote) with full audit.

**Sprint E — Make the "have it but fake" features real.**
10. **I3 real Discord + Telegram adapters** (turn 2 fixtures into real).
11. **N4 GitHub write PR-creation E2E.**

**Sprint F — UX/a11y/coverage polish (P2/P3).**
12. Sprint 4 + Sprint 5 items.

**Verification gate after every item:** `npm run test` + `npm run typecheck` (+ `npm run verify:security` after security items). No item is "done" until green.

---

## 5. Final assessment criteria (the user's 4 conditions)

1. ✅ when every shipped feature in §2 rates ≥8.5 (deferred-by-design items I4/D1/O2 documented as deliberate non-goals per vision §20.3, not faked).
2. ✅ when SquidBot matches-or-beats OpenClaw/Hermes on its **thesis axes** (trust, traces, memory, evolution, governance, AI Studio) — with the core loop actually working.
3. ✅ when the "obviously better" feelings (vision §21.1) are demonstrably true: *see exactly what it did · replay any work · memory with evidence · catches gaps · tests itself · improves only after eval · safe to grant access.*
4. ✅ when the bug list in §3 is closed (or explicitly won't-fix with justification).

*Ratings in §2 are updated in place as each fix lands and is verified.*

---

## 6. Progress Log

- **2026-05-29 — BUG-001 (P0) agentic tool loop FIXED.** Root-caused by code read (`sendMessage` called the model once, ran tools, returned — model never saw results). Fix (TDD, 3 new tests): extended `ChatMessage` with `toolCalls`/`toolCallId`; rewrote `sendMessage` as a bounded loop (cap 8 + identical-call dedup) that feeds tool results back; `apiProvider` now serializes `tool_calls`/`tool` for real OpenAI APIs; deterministic provider terminates by summarizing results. **C1 rating 3 → 8.5.** Verified: full `npm run test` green, `npm run typecheck` clean.
- **2026-05-29 — 2.4 trace-on-throw FIXED.** `sendMessage` wrapped in try/catch/finally so a failed run still persists a trace (with an `error` event) to History + audit. New test `runtime-trace-integrity.test.ts`. **O1 strengthened.**
- **2026-05-29 — 2.7 BYOK fetch timeout FIXED.** `apiProvider` now aborts via `AbortController` after `fetchTimeoutMs` (default 60s) with a clear "timed out" error — a hung endpoint can't freeze the agent loop. New test in `apiProvider.test.ts`. **C4 strengthened.**
- **2026-05-29 — 2.1 credential redaction expanded FIXED.** `redactSecrets` now catches GitHub (`ghp_`/`gho_`/…), Slack (`xoxb-`/…), AWS (`AKIA…`), JWTs, and `Bearer <token>` — closing the connector-response-into-trace leak. Patterns scoped to avoid over-redacting prose (guard test). New test `redaction-tokens.test.ts`. **G6 rating 6 → 8.5.**
- **2026-05-29 — 2.3 paid→free fallback transparency FIXED.** When a configured PAID provider fails mid-turn and a free/local provider answers, `sendMessage` now appends a clear note to the reply. Free→free (default zero-spend) fallback stays silent. New test `runtime-fallback-note.test.ts`. **C4/trust strengthened.**
- **2026-05-29 — 2.6 owner-RBAC-bypass VERIFIED NOT A BUG.** Owner passes RBAC permission grants by design, but ABAC `deny`, zero-spend, external-model restriction, sandbox-for-writes, and high-risk-approval all still apply to owners (`policyEngine.ts` orders the safety checks around the owner allow). Closed as by-design.
- **2026-05-29 — 1.7 FTS truncation FIXED.** `toFtsQuery` kept only the first 12 tokens, silently dropping the rest of any longer query. Now keeps up to 256 deduped prefix terms. New test `fts-truncation.test.ts`. **M-retrieval strengthened.**
- **2026-05-29 — BUG-002 (P0) encryption at rest FIXED (1.2 + 1.3).** New `packages/core/src/secretCrypto.ts` (AES-256-GCM, key from env or 0600 file, `enc:v1:` prefix + lazy plaintext migration). Model-account `apiKey` now encrypts on write / decrypts on read; threaded through runtime router-build + desktop IPC + CLI account commands (incl. `accounts test` bearer token). Governance vault gained a `keyFilePath` that migrates any legacy in-DB master key to a 0600 file and clears it from the DB — wired into desktop `createGovernance` + CLI. **G4 rating 3 → 8.5.** Verified: 640 tests green, typecheck clean, `verify:security` exit 0.
