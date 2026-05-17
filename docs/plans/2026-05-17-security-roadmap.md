# Security & privacy roadmap

**Date:** 2026-05-17
**Status:** Captured for future brainstorming sessions — NOT a plan to execute now.
**Origin:** Raised during the connector real-transport brainstorming on 2026-05-17. Four security asks emerged that are too big to fold into the connector design but too important to lose.

---

## Why this exists

For a business AI app, security isn't a feature checkbox — it's the brand promise. SquidBot's market positioning is *"smart + free + your data never leaves your laptop unless you say so"*, and that promise only holds up if the security mechanics actually deliver. Today the app has solid foundations (per-tool risk levels, policy packs, sensitivity-tied profiles, governance engine, approval queue) but four visible gaps remain. This doc captures them so a future session can pick any one up cold.

Each item below should become its own brainstorming session before implementation. The order I'd recommend tackling them is **S4 → S1 → S2 → S3**, explained at the bottom.

---

## S1 — PIN to downgrade profile sensitivity

### Problem
The user picks a sensitivity level during onboarding (`standard` / `sensitive` / `regulated` / `air-gapped`). Today, anyone with access to the app can downgrade `regulated` → `standard` from Settings → Profile and instantly unlock previously-gated operations. That's the worst breach vector — an attacker (or a careless user) can defeat the entire compliance posture with one menu click.

### Sketch
- At onboarding, user sets a 4–6 digit PIN (or skips with explicit "I'll add this later" warning).
- PIN is stored hashed (Argon2id or bcrypt) in a dedicated `security_credentials` table.
- Any **downgrade** transition (`regulated` → anything lower, `sensitive` → `standard`) requires entering the PIN.
- Upgrades (`standard` → `regulated`) do NOT require a PIN — you can always *increase* security without friction.
- Lost PIN: recovery flow involves wiping all sensitive memories + traces (the "factory reset" path).

### Dependencies
- Light: needs a `security_credentials` table (small migration).
- Touches: onboarding (set PIN), Settings → Profile (downgrade flow), `activateProfile` IPC (gate the call).

### Estimated size
~3 hours of design + 1 day of implementation. Single brainstorming session, single implementation session.

---

## S2 — Account ownership / device binding

### Problem
Today the app has zero user-identity concept at the OS level. Anyone who opens the laptop (a coworker, a thief, the user's kid) can open SquidBot and see every memory, every trace, every chat. For an app pitched as "your data stays on your machine," that's a confidence gap — the "your" is doing a lot of work.

### Sketch (rough — needs its own session)
Two complementary mechanisms:
1. **OS-keychain-bound credential.** On first launch, app generates a random secret, stores it in the OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service). On subsequent launches, the app must retrieve that secret to unlock. A thief booting into recovery mode → can't read the keychain entry without the OS user's password → app refuses to start.
2. **App-level lock screen.** Above the OS layer, a 4-6 digit PIN (could reuse S1's) that gates app access. Configurable timeout: lock on close, lock after 15 min idle, etc.

The two layers compose: keychain is "is this the right machine + OS user?", PIN is "is this the right human?".

### Dependencies
- Needs a cross-platform keychain library (macOS / Windows / Linux). Several mature options.
- Touches: app boot (read keychain at startup), the entire UI (lock screen modal), the DB unlock path (key derived from secrets).
- Strong dependency on S4 — without encrypted-at-rest, the keychain protection is bypassable by anyone with disk access.

### Estimated size
~1 week of brainstorming + design (multi-platform is tricky), 2 weeks of implementation.

---

## S3 — Team sharing

### Problem
Single-user model assumes one operator per laptop. Real businesses have *multiple* people who want to see what the agent has done — the founder + the COO + the ops manager all benefit from shared visibility. Today they'd need to share a laptop or duplicate the app, neither of which is acceptable.

### Sketch (rough — needs its own session)
The `governance` package already has a roles model (`securityAdmin`, etc.) and an audit-entry concept — half the infra exists. What's missing:
- Multi-user accounts within a single SquidBot install.
- Login flow on app launch (username + password / PIN / OS-account binding).
- Per-user visibility: my chats vs everyone's chats. (Or "owner mode" — everyone sees everything except secrets.)
- Per-user identity flowed into traces (`trace.userId`) so the audit log knows *who did what*.

Open questions for a future session:
- Is the unit of sharing "the SquidBot install" (= "this laptop") or "the team" (= "this org, possibly across machines")? Massively different scope.
- Does each user have their own model accounts + connector keys, or are they shared at the team level?
- Sync mechanism if multi-machine? (Almost certainly cloud-backed — kills the local-first pitch unless designed very carefully.)

### Dependencies
- Strongly depends on S2 (auth foundation).
- Depends on S4 (encrypted DB, with separate key-encryption keys per user).
- Touches *every* page that displays user-specific content (memories, traces, chats, settings).

### Estimated size
Months. This is the biggest item. The "single-machine multi-user" version is much smaller than "multi-machine team sync" — start with the former if at all.

---

## S4 — Data-at-rest encryption

### Problem
The SQLite database is plaintext. Anyone with disk access — a coworker plugging in a USB drive, a stolen laptop with no FileVault, an IT person, a malicious cleanup script — can read every memory, every chat, every connector key. For an app whose primary value is "your data lives only on your machine," that's the load-bearing security gap.

### Sketch (rough — needs its own session)
- SQLCipher (transparent encryption layer on top of SQLite) is the standard answer. Drop-in replacement for `better-sqlite3`'s underlying engine.
- Encryption key derived from: keychain-bound secret (S2) + user PIN (S1, S2). Both required → defense in depth.
- Migration path: existing users have plaintext DBs. On first launch after the upgrade, the app prompts for the PIN (or sets one), then encrypts the DB in place.
- API key store inside the DB now safely encrypted too — currently those are plaintext in the `model_accounts` and `settings` tables.

### Dependencies
- Light at the data layer: replace `better-sqlite3` with `better-sqlite3-multiple-ciphers` (community fork with SQLCipher support) or a similar drop-in.
- Heavy at the user-experience layer: every cold start now requires a key. If S1+S2 are in place, the unlock flow already exists; if not, we need a minimal version just for the encryption check.
- Backup considerations — exported traces / packets need to be re-encrypted or marked sensitive.

### Estimated size
~1 week of design + implementation, IF the migration story is clean. Migration is usually the hardest part.

---

## Recommended order

**S4 → S1 → S2 → S3**

Rationale:
1. **S4 first** because the others are bypassable without encrypted-at-rest. PIN-gates and account-ownership UI mean nothing if a thief can `sqlite3 squidbot.sqlite` and dump the table. Encryption is the load-bearing primitive.
2. **S1 next** because it's small, isolated, and immediately closes the most-clicked breach path (the in-app sensitivity downgrade). High-value per hour of work.
3. **S2 after that** because it builds on S4's key-derivation infrastructure and S1's PIN UX. Natural progression.
4. **S3 last** because it's an order of magnitude more complex than the other three and only makes sense once 1–3 are in place. It also fundamentally changes the product (single-user → multi-user), so it deserves a strategic decision moment, not just a tech decision.

If only ONE of these gets shipped in the next 3 months, make it **S4**. It's the security promise the brand is making.

---

## Cross-cutting principles for any of these

- **Local-first remains non-negotiable.** None of S1–S4 should add a network dependency. S2's keychain is local. S4's encryption key derivation is local. S3's "team sync" is the only one that might involve a network, and even there we should explore P2P or self-hosted relay before SaaS.
- **No backdoors.** Including for the developer. If the user loses their PIN, recovery wipes data — it doesn't bypass.
- **Audit trail covers the security plane itself.** Every PIN change, every sensitivity downgrade, every login is in the audit log. Same governance pattern the rest of the app uses.
- **Defaults err on the side of safe.** New install → encrypted DB by default, lock-on-close by default, sensitivity defaults to `sensitive` not `standard`.

---

## What's NOT here

- Threat model: a structured threat-modelling document (attacker, asset, capability) belongs in its own artifact. This doc is feature-shaped; that one would be defensive-shaped.
- Compliance certifications (SOC 2, GDPR, HIPAA assertions): out of scope until the product has a customer paying for them.
- Bug bounty / responsible-disclosure policy: relevant only once the app has external users.

---

## Next step

Pick one of S1/S2/S3/S4. Run `superpowers:brainstorming` for that item — this doc gives the brainstorming session enough context to start cold. Output: a per-feature design doc + implementation plan, same shape as the connector / sidebar reorg work.
