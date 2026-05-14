import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import {
  commitOnboarding,
  GENERIC_BUSINESS_PROFILE_ID,
  getActiveProfile,
  guessIndustry,
  inferOnboardingProfile,
  installSeedProfiles,
  parseSystemsAndChannels,
  STANDARD_QUESTIONS,
  type OnboardingAnswer
} from "../src/index.js";

let database: SquidDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

function freshDatabase(): SquidDatabase {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-onboarding-"));
  return initializeDatabase(path.join(dir, "squidbot.sqlite"));
}

function answer(id: string, value: string, skipped = false): OnboardingAnswer {
  return { questionId: id, rawValue: value, skipped };
}

describe("STANDARD_QUESTIONS catalog", () => {
  it("ships exactly the six conversational questions in stable order", () => {
    expect(STANDARD_QUESTIONS).toHaveLength(6);
    expect(STANDARD_QUESTIONS.map((question) => question.id)).toEqual([
      "business_summary",
      "role",
      "founder_note",
      "systems",
      "sensitivity",
      "guardrail"
    ]);
    // Business summary + sensitivity must be required; the rest are skippable.
    expect(STANDARD_QUESTIONS.find((q) => q.id === "business_summary")?.required).toBe(true);
    expect(STANDARD_QUESTIONS.find((q) => q.id === "sensitivity")?.required).toBe(true);
    expect(STANDARD_QUESTIONS.find((q) => q.id === "founder_note")?.required).toBe(false);
  });
});

describe("guessIndustry", () => {
  it("detects a law firm from its name", () => {
    const guess = guessIndustry("We run a small law firm focused on real estate transactions.");
    expect(guess.industry).toBe("legal");
    expect(guess.confidence).toBeGreaterThan(0.5);
  });

  it("detects an auto dealership", () => {
    const guess = guessIndustry("Family-owned auto dealership selling and servicing Hondas.");
    expect(guess.industry).toBe("automotive_retail");
  });

  it("detects healthcare operations from 'patients' and 'clinic'", () => {
    const guess = guessIndustry("We run a chain of pediatric clinics and process insurance claims for patients.");
    expect(guess.industry).toBe("healthcare_operations");
  });

  it("detects a marketing agency from explicit naming", () => {
    const guess = guessIndustry("A boutique marketing agency running campaigns for B2B SaaS clients.");
    // Strong-keyword match wins even though SaaS is in the description.
    expect(guess.industry).toBe("marketing_agency");
  });

  it("falls back to general_business when no keywords match", () => {
    const guess = guessIndustry("Just a small team helping people.");
    expect(guess.industry).toBe("general_business");
    expect(guess.confidence).toBe(0);
  });

  it("handles empty input safely", () => {
    const guess = guessIndustry("");
    expect(guess.industry).toBe("general_business");
  });
});

describe("parseSystemsAndChannels", () => {
  it("splits comma-separated input and routes channels separately", () => {
    const parsed = parseSystemsAndChannels("Slack, Clio, Outlook, GitHub, DocuSign");
    expect(parsed.systems.sort()).toEqual(["clio", "docusign", "github"].sort());
    expect(parsed.channels.sort()).toEqual(["email", "slack"].sort());
  });

  it("returns empty arrays for empty input", () => {
    expect(parseSystemsAndChannels("")).toEqual({ systems: [], channels: [] });
    expect(parseSystemsAndChannels("   ")).toEqual({ systems: [], channels: [] });
  });

  it("dedupes systems and channels", () => {
    const parsed = parseSystemsAndChannels("Slack, slack, Gmail, gmail, Salesforce, salesforce");
    expect(parsed.systems).toEqual(["salesforce"]);
    expect(parsed.channels).toEqual(["slack", "email"]);
  });
});

describe("inferOnboardingProfile (deterministic)", () => {
  it("produces a regulated law-firm profile with vocabulary, policy packs, and read-only", () => {
    const inference = inferOnboardingProfile([
      answer("business_summary", "We are a 3-attorney law firm focused on M&A and contract review."),
      answer("role", "Managing partner"),
      answer("founder_note", "Reviewing contracts to find closing-condition clauses."),
      answer("systems", "Clio, Outlook, DocuSign, Slack"),
      answer("sensitivity", "regulated"),
      answer("guardrail", "Never share matter info externally without attorney approval.")
    ]);

    expect(inference.profile.industry).toBe("legal");
    expect(inference.profile.sensitivity).toBe("regulated");
    expect(inference.profile.readOnlyByDefault).toBe(true);
    expect(inference.profile.vocabulary).toMatchObject({ project: "matter", customer: "client" });
    expect(inference.profile.policyPacks).toContain("legal-review");
    expect(inference.profile.policyPacks).toContain("secrets-redaction");
    expect(inference.profile.primarySystems).toContain("clio");
    expect(inference.profile.primarySystems).toContain("docusign");
    expect(inference.profile.primaryChannels).toContain("slack");
    expect(inference.profile.primaryChannels).toContain("email");

    // Memory drafts: business summary + founder note + system inventory + guardrail.
    const types = inference.memories.map((memory) => memory.type).sort();
    expect(types).toEqual(["business_summary", "founder_note", "guardrail", "system_inventory"]);
    const founder = inference.memories.find((memory) => memory.type === "founder_note");
    expect(founder?.body).toContain("closing-condition");
    expect(founder?.importance).toBeGreaterThanOrEqual(0.9);
    const guardrail = inference.memories.find((memory) => memory.type === "guardrail");
    expect(guardrail?.importance).toBeGreaterThanOrEqual(0.9);

    // Rationale must mention industry, sensitivity, and the guardrail save.
    expect(inference.rationale.some((line) => line.includes("legal"))).toBe(true);
    expect(inference.rationale.some((line) => line.toLowerCase().includes("regulated"))).toBe(true);
    expect(inference.rationale.some((line) => line.toLowerCase().includes("guardrail"))).toBe(true);

    // Next actions present + non-empty
    expect(inference.nextActions.length).toBeGreaterThan(0);
    expect(inference.nextActions.some((action) => action.includes("whoami"))).toBe(true);
  });

  it("handles a generic business with no industry keywords gracefully", () => {
    const inference = inferOnboardingProfile([
      answer("business_summary", "We're a small team that helps customers."),
      answer("role", "Founder"),
      answer("founder_note", "", true),
      answer("systems", "", true),
      answer("sensitivity", "standard"),
      answer("guardrail", "", true)
    ]);

    expect(inference.profile.industry).toBe("general_business");
    expect(inference.profile.sensitivity).toBe("standard");
    expect(inference.profile.readOnlyByDefault).toBe(false);
    expect(inference.profile.policyPacks).toEqual(["developer-safe-default", "secrets-redaction"]);
    expect(inference.profile.vocabulary).toEqual({});
    expect(inference.profile.primarySystems).toEqual([]);
    expect(inference.profile.primaryChannels).toEqual([]);
    // Only business summary memory is written when skippable fields are skipped.
    expect(inference.memories.map((memory) => memory.type)).toEqual(["business_summary"]);
  });

  it("applies air-gapped sensitivity by adding the air-gapped policy pack and read-only", () => {
    const inference = inferOnboardingProfile([
      answer("business_summary", "Defense contractor handling classified records."),
      answer("role", "Compliance officer"),
      answer("founder_note", "", true),
      answer("systems", "", true),
      answer("sensitivity", "air-gapped"),
      answer("guardrail", "", true)
    ]);

    expect(inference.profile.sensitivity).toBe("air-gapped");
    expect(inference.profile.readOnlyByDefault).toBe(true);
    expect(inference.profile.policyPacks).toContain("air-gapped-default");
  });

  it("recognises numeric sensitivity choices from the CLI", () => {
    const inference = inferOnboardingProfile([
      answer("business_summary", "Engineering team building developer tools."),
      answer("sensitivity", "2")
    ]);
    expect(inference.profile.sensitivity).toBe("sensitive");
    expect(inference.profile.industry).toBe("software_engineering");
  });

  it("derives display name from a multi-word proper noun", () => {
    const inference = inferOnboardingProfile([
      answer("business_summary", "Acme Industrial Robotics."),
      answer("sensitivity", "standard")
    ]);
    expect(inference.profile.displayName).toBe("Acme Industrial Robotics");
  });

  it("extracts a single-word brand name from a longer sentence", () => {
    const inference = inferOnboardingProfile([
      answer("business_summary", "Acme is a small SaaS that helps online retailers detect fulfillment errors."),
      answer("sensitivity", "sensitive")
    ]);
    // Should be "Acme", not the whole sentence and not "Acme is a small SaaS that".
    expect(inference.profile.displayName).toBe("Acme");
  });

  it("falls back to industry display name when the opener is a pronoun like 'We'", () => {
    const inference = inferOnboardingProfile([
      answer("business_summary", "We run a small law firm focused on real estate."),
      answer("sensitivity", "regulated")
    ]);
    // No real brand at the start — use the industry display name instead.
    expect(inference.profile.displayName).toBe("Legal Practice");
  });

  it("falls back to industry display name when the opener is a generic descriptor like 'Family'", () => {
    const inference = inferOnboardingProfile([
      answer("business_summary", "Family-owned auto dealership servicing Hondas."),
      answer("sensitivity", "sensitive")
    ]);
    expect(inference.profile.displayName).toBe("Auto Dealership");
  });

  it("filters out identity vocabulary mappings (key === value)", () => {
    // saas vocabulary historically had `ticket: "ticket"` — pure dead weight that
    // showed up in the system prompt. Inference must never emit such entries.
    const inference = inferOnboardingProfile([
      answer("business_summary", "Acme is a small SaaS that helps online retailers."),
      answer("sensitivity", "sensitive")
    ]);
    const entries = Object.entries(inference.profile.vocabulary);
    expect(entries.length).toBeGreaterThan(0);
    for (const [from, to] of entries) {
      expect(from).not.toBe(to);
    }
  });
});

describe("commitOnboarding", () => {
  it("creates an active profile and persists memories with provenance", () => {
    database = freshDatabase();
    installSeedProfiles(database);
    expect(getActiveProfile(database)?.id).toBe(GENERIC_BUSINESS_PROFILE_ID);

    const inference = inferOnboardingProfile([
      answer("business_summary", "We are an auto dealership for European cars."),
      answer("role", "GM"),
      answer("founder_note", "Spend too much time chasing service appointments."),
      answer("systems", "DealerSocket, Outlook, Slack"),
      answer("sensitivity", "sensitive"),
      answer("guardrail", "Never quote prices without GM approval.")
    ]);

    const committed = commitOnboarding(database, inference, { activate: true });

    // Profile saved + active
    expect(committed.profile.industry).toBe("automotive_retail");
    expect(committed.profile.isActive).toBe(true);
    expect(getActiveProfile(database)?.id).toBe(committed.profile.id);

    // Memories saved with synthetic run id
    expect(committed.memories.length).toBe(inference.memories.length);
    expect(committed.memories.length).toBeGreaterThanOrEqual(3);
    for (const memory of committed.memories) {
      expect(memory.sourceRunId).toBe(committed.syntheticRunId);
      expect(memory.sourceRunId.startsWith("run_onboarding_")).toBe(true);
      expect(memory.approvedAt).toBeTruthy();
    }

    // Founder note is durable: a fresh memory listing call returns it.
    const founder = database.listApprovedMemories(20).find((memory) => memory.type === "founder_note");
    expect(founder).toBeDefined();
    expect(founder?.body).toContain("service appointments");
    expect(founder?.importance).toBeGreaterThanOrEqual(0.9);
  });

  it("supports activate=false: profile is created but generic stays active", () => {
    database = freshDatabase();
    installSeedProfiles(database);

    const inference = inferOnboardingProfile([
      answer("business_summary", "Boutique consulting firm."),
      answer("sensitivity", "standard")
    ]);
    const committed = commitOnboarding(database, inference, { activate: false });

    expect(committed.profile.isActive).toBe(false);
    expect(getActiveProfile(database)?.id).toBe(GENERIC_BUSINESS_PROFILE_ID);
  });
});
