import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import {
  activateProfile,
  buildIdentityReport,
  buildSystemPrompt,
  describeForWhoami,
  ensureIdentityCard,
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
    expect(prompt).toContain("No enterprise profile is active");
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
