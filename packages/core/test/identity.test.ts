import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import {
  activateProfile,
  AgentRuntime,
  buildIdentityReport,
  buildSystemPrompt,
  createCustomProfile,
  describeForWhoami,
  ensureIdentityCard,
  GENERIC_BUSINESS_PROFILE_ID,
  getActiveProfile,
  installSeedProfiles,
  listProfiles,
  SEED_PROFILES,
  SQUIDBOT_AGENT_NAME,
  SQUIDBOT_MISSION,
  snapshotCapabilities,
  ToolRegistry,
  updateIdentityCard
} from "../src/index.js";

let database: SquidDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

function freshDatabase(): SquidDatabase {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-identity-"));
  return initializeDatabase(path.join(dir, "squidbot.sqlite"));
}

describe("identity card singleton", () => {
  it("creates a card on first call and returns the same row afterward", () => {
    database = freshDatabase();
    const first = ensureIdentityCard(database);
    expect(first.id).toBe("singleton");
    expect(first.agentName).toBe(SQUIDBOT_AGENT_NAME);
    expect(first.mission).toBe(SQUIDBOT_MISSION);

    const second = ensureIdentityCard(database);
    expect(second.installedAt).toBe(first.installedAt);
    expect(second.updatedAt).toBe(first.updatedAt);

    const rowCount = database.db.prepare(`SELECT COUNT(*) as count FROM identity_card`).get() as { count: number };
    expect(rowCount.count).toBe(1);
  });

  it("updates fields without breaking the singleton invariant", () => {
    database = freshDatabase();
    ensureIdentityCard(database);
    const updated = updateIdentityCard(database, { mission: "Updated mission text" });
    expect(updated.mission).toBe("Updated mission text");
    expect(updated.agentName).toBe(SQUIDBOT_AGENT_NAME);
  });
});

describe("enterprise profiles", () => {
  it("installs seed profiles only once and marks them as seeded", () => {
    database = freshDatabase();
    const first = installSeedProfiles(database);
    expect(first).toHaveLength(SEED_PROFILES.length);
    expect(first.every((profile) => profile.seeded)).toBe(true);

    const second = installSeedProfiles(database);
    expect(second).toHaveLength(SEED_PROFILES.length);
    const ids = new Set(second.map((profile) => profile.id));
    expect(ids.size).toBe(SEED_PROFILES.length);
  });

  it("activates only one profile at a time", () => {
    database = freshDatabase();
    installSeedProfiles(database);
    const profiles = listProfiles(database);
    const law = profiles.find((profile) => profile.id === "profile_seed_law_firm")!;
    const engineering = profiles.find((profile) => profile.id === "profile_seed_engineering_shop")!;

    activateProfile(database, law.id);
    expect(getActiveProfile(database)?.id).toBe(law.id);

    activateProfile(database, engineering.id);
    const active = getActiveProfile(database);
    expect(active?.id).toBe(engineering.id);

    const allProfiles = listProfiles(database);
    const activeCount = allProfiles.filter((profile) => profile.isActive).length;
    expect(activeCount).toBe(1);
  });

  it("enforces regulated read-only-by-default for law / gov / healthcare seeds", () => {
    database = freshDatabase();
    installSeedProfiles(database);
    const profiles = listProfiles(database);
    const law = profiles.find((profile) => profile.id === "profile_seed_law_firm")!;
    const gov = profiles.find((profile) => profile.id === "profile_seed_gov_contractor")!;
    const healthcare = profiles.find((profile) => profile.id === "profile_seed_healthcare_ops")!;

    expect(law.readOnlyByDefault).toBe(true);
    expect(law.sensitivity).toBe("regulated");
    expect(gov.readOnlyByDefault).toBe(true);
    expect(gov.sensitivity).toBe("regulated");
    expect(healthcare.readOnlyByDefault).toBe(true);
    expect(healthcare.sensitivity).toBe("regulated");
  });
});

describe("identity report and system prompt", () => {
  it("builds an identity report and a system prompt with no active profile", () => {
    database = freshDatabase();
    const registry = new ToolRegistry();
    const report = buildIdentityReport(database, registry);
    expect(report.profile).toBeNull();
    expect(report.card.agentName).toBe(SQUIDBOT_AGENT_NAME);

    const prompt = buildSystemPrompt(report);
    expect(prompt).toContain("You are SquidBot");
    expect(prompt).toContain(SQUIDBOT_MISSION);
    // The "no profile" branch is now neutral about it — SquidBot adapts to whatever
    // the user describes, rather than nagging to run onboarding.
    expect(prompt).toContain("No enterprise profile is currently active");
    expect(prompt).toContain("adapt to whatever the user describes");
  });

  it("renders an optional memoryBulletin section when one is supplied", () => {
    database = freshDatabase();
    const report = buildIdentityReport(database, new ToolRegistry());
    const bulletin = [
      "Memory Bulletin",
      "- [guardrail] Permanent guardrail: Never share matter info externally.",
      "- [founder_note] Top time-waster: Reviewing contracts manually."
    ].join("\n");
    const prompt = buildSystemPrompt(report, { memoryBulletin: bulletin });
    expect(prompt).toContain("Relevant memories");
    expect(prompt).toContain("Permanent guardrail: Never share matter info externally.");
    expect(prompt).toContain("Top time-waster: Reviewing contracts manually.");
    // We strip the redundant "Memory Bulletin" header so there is exactly
    // one section heading instead of two stacked ones.
    expect((prompt.match(/Memory Bulletin/g) ?? []).length).toBe(0);
    // The closing instructions still tell the model to cite memories — the
    // wording is now "cite memories above only when they directly apply"
    // (rephrased as part of the conversation-style block) rather than the
    // older "cite it explicitly" phrasing.
    expect(prompt.toLowerCase()).toMatch(/cite memories|cite them/i);
  });

  it("skips the memory section when the bulletin is empty or 'no memories'", () => {
    database = freshDatabase();
    const report = buildIdentityReport(database, new ToolRegistry());
    const empty = buildSystemPrompt(report, { memoryBulletin: "" });
    expect(empty).not.toContain("Relevant memories");

    const noneFound = buildSystemPrompt(report, {
      memoryBulletin: "Memory Bulletin\n- No approved memories found for this run."
    });
    expect(noneFound).not.toContain("Relevant memories");
  });

  it("includes profile metadata in the system prompt when a profile is active", () => {
    database = freshDatabase();
    installSeedProfiles(database);
    activateProfile(database, "profile_seed_law_firm");

    const report = buildIdentityReport(database, new ToolRegistry());
    const prompt = buildSystemPrompt(report);

    expect(prompt).toContain("Law Firm");
    expect(prompt).toContain("Sensitivity: regulated");
    expect(prompt).toContain("Read-only by default: yes");
    expect(prompt).toContain("attorney-client-privilege");
  });

  it("describeForWhoami produces a human-readable summary", () => {
    database = freshDatabase();
    installSeedProfiles(database);
    activateProfile(database, "profile_seed_auto_dealer");

    const report = buildIdentityReport(database, new ToolRegistry());
    const description = describeForWhoami(report);
    expect(description).toContain("SquidBot");
    expect(description).toContain("Auto Dealership");
  });

  it("system prompt teaches the agent the connector-call pending-approval convention", () => {
    database = freshDatabase();
    installSeedProfiles(database);
    activateProfile(database, "profile_seed_generic_business");
    const report = buildIdentityReport(database, new ToolRegistry());
    const prompt = buildSystemPrompt(report);
    expect(prompt).toMatch(/pending.*approval/i);
    expect(prompt).toMatch(/Do NOT retry/i);
  });

  it("system prompt instructs the model to be conversational and NOT recite capabilities on greetings", () => {
    // Reported in the wild: user said "hi" and the model dumped its entire
    // tool list grouped by family ("Sales: …, GitHub: …, GitLab: …"). Root
    // cause was the closing instruction priming the model to recite the
    // identity card. The fix adds explicit conversation-style guidance —
    // this test pins that guidance so a future edit can't quietly remove it.
    database = freshDatabase();
    installSeedProfiles(database);
    activateProfile(database, "profile_seed_auto_dealer");

    const report = buildIdentityReport(database, new ToolRegistry());
    const prompt = buildSystemPrompt(report);

    expect(prompt).toMatch(/Conversation style/i);
    // Pin the specific anti-pattern guard — small talk must NOT trigger a
    // capability dump.
    expect(prompt).toMatch(/small talk/i);
    expect(prompt).toMatch(/Do NOT recite your tools/i);
    expect(prompt).toMatch(/short greeting deserves a short greeting back/i);
    // And the "no tool-names-as-feature-list" rule.
    expect(prompt).toMatch(/Never read tool names out loud/i);
  });

  it("snapshots tool capabilities deterministically", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "demo.read",
      description: "demo",
      inputSchema: {},
      permissionScopes: ["demo.read"],
      riskLevel: "low",
      handler: async () => ({ ok: true })
    });
    const snapshot = snapshotCapabilities(registry);
    expect(snapshot.toolCount).toBe(1);
    expect(snapshot.tools[0].name).toBe("demo.read");
    expect(snapshot.permissionScopes).toEqual(["demo.read"]);
  });
});

describe("generic business is the default profile", () => {
  it("ships a generic_business seed profile as the first entry of SEED_PROFILES", () => {
    expect(SEED_PROFILES[0].id).toBe(GENERIC_BUSINESS_PROFILE_ID);
    expect(SEED_PROFILES[0].industry).toBe("general_business");
    expect(SEED_PROFILES[0].displayName).toBe("Generic Business");
    expect(SEED_PROFILES[0].sensitivity).toBe("standard");
    expect(SEED_PROFILES[0].readOnlyByDefault).toBe(false);
    expect(SEED_PROFILES[0].vocabulary).toEqual({});
    expect(SEED_PROFILES[0].primarySystems).toEqual([]);
  });

  it("auto-activates the generic profile on first installSeedProfiles call", () => {
    database = freshDatabase();
    const active = getActiveProfile(database);
    expect(active).toBeNull();

    installSeedProfiles(database);
    const newlyActive = getActiveProfile(database);
    expect(newlyActive).not.toBeNull();
    expect(newlyActive?.id).toBe(GENERIC_BUSINESS_PROFILE_ID);
  });

  it("does not change an already-active profile on subsequent seed calls", () => {
    database = freshDatabase();
    installSeedProfiles(database);
    activateProfile(database, "profile_seed_law_firm");
    expect(getActiveProfile(database)?.id).toBe("profile_seed_law_firm");

    // Calling install again is idempotent and must not flip back to generic.
    installSeedProfiles(database);
    expect(getActiveProfile(database)?.id).toBe("profile_seed_law_firm");
  });

  it("AgentRuntime constructor auto-installs seeds and activates generic", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-runtime-default-"));
    const workspacePath = path.join(dir, "workspace");
    fs.mkdirSync(workspacePath);
    database = initializeDatabase(path.join(dir, "squidbot.sqlite"));
    expect(getActiveProfile(database)).toBeNull();

    new AgentRuntime({ database, workspacePath });
    const active = getActiveProfile(database);
    expect(active?.id).toBe(GENERIC_BUSINESS_PROFILE_ID);
    expect(active?.displayName).toBe("Generic Business");
  });

  it("generic profile shows up in system prompt as the active profile", () => {
    database = freshDatabase();
    installSeedProfiles(database);
    const report = buildIdentityReport(database, new ToolRegistry());
    expect(report.profile?.id).toBe(GENERIC_BUSINESS_PROFILE_ID);

    const prompt = buildSystemPrompt(report);
    expect(prompt).toContain("Generic Business");
    expect(prompt).toContain("general_business");
    expect(prompt).toContain("Adapts to any business");
  });
});

describe("createCustomProfile", () => {
  it("creates an inactive custom profile by default", () => {
    database = freshDatabase();
    installSeedProfiles(database); // generic becomes active
    const custom = createCustomProfile(database, {
      industry: "marketing_agency",
      displayName: "Acme Marketing",
      businessUnit: null,
      role: "operator",
      primarySystems: ["hubspot"],
      primaryChannels: ["slack"],
      sensitivity: "standard",
      vocabulary: { customer: "lead" },
      branding: { productName: "SquidBot for Acme" },
      policyPacks: ["developer-safe-default"],
      defaultSkills: [],
      defaultConnectors: [],
      readOnlyByDefault: false,
      metadata: { customCreated: true }
    });

    expect(custom.id).toMatch(/^profile_/);
    expect(custom.displayName).toBe("Acme Marketing");
    expect(custom.industry).toBe("marketing_agency");
    expect(custom.isActive).toBe(false);
    expect(custom.seeded).toBe(false);

    // Generic stays active because we didn't pass activate=true.
    expect(getActiveProfile(database)?.id).toBe(GENERIC_BUSINESS_PROFILE_ID);
  });

  it("can create and immediately activate a custom profile", () => {
    database = freshDatabase();
    installSeedProfiles(database);
    const custom = createCustomProfile(database, {
      industry: "consulting",
      displayName: "Solo Consultant",
      businessUnit: null,
      role: "founder",
      primarySystems: [],
      primaryChannels: ["email"],
      sensitivity: "sensitive",
      vocabulary: { project: "engagement", customer: "client" },
      branding: {},
      policyPacks: ["secrets-redaction"],
      defaultSkills: [],
      defaultConnectors: [],
      readOnlyByDefault: false,
      metadata: { customCreated: true },
      activate: true
    });

    expect(custom.isActive).toBe(true);
    expect(getActiveProfile(database)?.id).toBe(custom.id);

    // Generic must be deactivated by the single-active invariant.
    const profiles = listProfiles(database);
    const activeCount = profiles.filter((profile) => profile.isActive).length;
    expect(activeCount).toBe(1);
  });
});
