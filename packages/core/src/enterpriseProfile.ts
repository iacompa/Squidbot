import type { SquidDatabase } from "@squidbot/db";
import { createId } from "./types.js";

export type ProfileSensitivity = "standard" | "sensitive" | "regulated" | "air-gapped";

export type EnterpriseProfileBranding = {
  productName?: string;
  accentColor?: string;
  logoPath?: string;
  supportEmail?: string;
};

export type EnterpriseProfile = {
  id: string;
  industry: string;
  displayName: string;
  businessUnit: string | null;
  role: string | null;
  primarySystems: string[];
  primaryChannels: string[];
  sensitivity: ProfileSensitivity;
  vocabulary: Record<string, string>;
  branding: EnterpriseProfileBranding;
  policyPacks: string[];
  defaultSkills: string[];
  defaultConnectors: string[];
  readOnlyByDefault: boolean;
  isActive: boolean;
  seeded: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type EnterpriseProfileInput = Omit<
  EnterpriseProfile,
  "id" | "isActive" | "seeded" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

type StoredEnterpriseProfile = {
  id: string;
  industry: string;
  displayName: string;
  businessUnit: string | null;
  role: string | null;
  primarySystems: string;
  primaryChannels: string;
  sensitivity: ProfileSensitivity;
  vocabulary: string;
  branding: string;
  policyPacks: string;
  defaultSkills: string;
  defaultConnectors: string;
  readOnlyByDefault: number;
  isActive: number;
  seeded: number;
  metadata: string;
  createdAt: string;
  updatedAt: string;
};

function parseProfile(row: StoredEnterpriseProfile): EnterpriseProfile {
  return {
    id: row.id,
    industry: row.industry,
    displayName: row.displayName,
    businessUnit: row.businessUnit,
    role: row.role,
    primarySystems: JSON.parse(row.primarySystems) as string[],
    primaryChannels: JSON.parse(row.primaryChannels) as string[],
    sensitivity: row.sensitivity,
    vocabulary: JSON.parse(row.vocabulary) as Record<string, string>,
    branding: JSON.parse(row.branding) as EnterpriseProfileBranding,
    policyPacks: JSON.parse(row.policyPacks) as string[],
    defaultSkills: JSON.parse(row.defaultSkills) as string[],
    defaultConnectors: JSON.parse(row.defaultConnectors) as string[],
    readOnlyByDefault: row.readOnlyByDefault === 1,
    isActive: row.isActive === 1,
    seeded: row.seeded === 1,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function listProfiles(database: SquidDatabase): EnterpriseProfile[] {
  const rows = database.db
    .prepare(
      `SELECT id, industry, displayName, businessUnit, role,
              primarySystems, primaryChannels, sensitivity, vocabulary,
              branding, policyPacks, defaultSkills, defaultConnectors,
              readOnlyByDefault, isActive, seeded, metadata,
              createdAt, updatedAt
       FROM enterprise_profile
       ORDER BY displayName ASC`
    )
    .all() as StoredEnterpriseProfile[];
  return rows.map(parseProfile);
}

export function getProfile(database: SquidDatabase, id: string): EnterpriseProfile | null {
  const row = database.db
    .prepare(
      `SELECT id, industry, displayName, businessUnit, role,
              primarySystems, primaryChannels, sensitivity, vocabulary,
              branding, policyPacks, defaultSkills, defaultConnectors,
              readOnlyByDefault, isActive, seeded, metadata,
              createdAt, updatedAt
       FROM enterprise_profile
       WHERE id = ?`
    )
    .get(id) as StoredEnterpriseProfile | undefined;
  return row ? parseProfile(row) : null;
}

export function getActiveProfile(database: SquidDatabase): EnterpriseProfile | null {
  const row = database.db
    .prepare(
      `SELECT id, industry, displayName, businessUnit, role,
              primarySystems, primaryChannels, sensitivity, vocabulary,
              branding, policyPacks, defaultSkills, defaultConnectors,
              readOnlyByDefault, isActive, seeded, metadata,
              createdAt, updatedAt
       FROM enterprise_profile
       WHERE isActive = 1
       LIMIT 1`
    )
    .get() as StoredEnterpriseProfile | undefined;
  return row ? parseProfile(row) : null;
}

export function upsertProfile(database: SquidDatabase, input: EnterpriseProfileInput): EnterpriseProfile {
  const id = input.id ?? createId("profile");
  const now = new Date().toISOString();
  const existing = getProfile(database, id);

  if (existing) {
    database.db
      .prepare(
        `UPDATE enterprise_profile
         SET industry = @industry,
             displayName = @displayName,
             businessUnit = @businessUnit,
             role = @role,
             primarySystems = @primarySystems,
             primaryChannels = @primaryChannels,
             sensitivity = @sensitivity,
             vocabulary = @vocabulary,
             branding = @branding,
             policyPacks = @policyPacks,
             defaultSkills = @defaultSkills,
             defaultConnectors = @defaultConnectors,
             readOnlyByDefault = @readOnlyByDefault,
             metadata = @metadata,
             updatedAt = @updatedAt
         WHERE id = @id`
      )
      .run({
        id,
        industry: input.industry,
        displayName: input.displayName,
        businessUnit: input.businessUnit,
        role: input.role,
        primarySystems: JSON.stringify(input.primarySystems),
        primaryChannels: JSON.stringify(input.primaryChannels),
        sensitivity: input.sensitivity,
        vocabulary: JSON.stringify(input.vocabulary),
        branding: JSON.stringify(input.branding),
        policyPacks: JSON.stringify(input.policyPacks),
        defaultSkills: JSON.stringify(input.defaultSkills),
        defaultConnectors: JSON.stringify(input.defaultConnectors),
        readOnlyByDefault: input.readOnlyByDefault ? 1 : 0,
        metadata: JSON.stringify(input.metadata),
        updatedAt: now
      });
  } else {
    database.db
      .prepare(
        `INSERT INTO enterprise_profile (
           id, industry, displayName, businessUnit, role,
           primarySystems, primaryChannels, sensitivity, vocabulary,
           branding, policyPacks, defaultSkills, defaultConnectors,
           readOnlyByDefault, isActive, seeded, metadata,
           createdAt, updatedAt
         ) VALUES (
           @id, @industry, @displayName, @businessUnit, @role,
           @primarySystems, @primaryChannels, @sensitivity, @vocabulary,
           @branding, @policyPacks, @defaultSkills, @defaultConnectors,
           @readOnlyByDefault, 0, 0, @metadata,
           @createdAt, @updatedAt
         )`
      )
      .run({
        id,
        industry: input.industry,
        displayName: input.displayName,
        businessUnit: input.businessUnit,
        role: input.role,
        primarySystems: JSON.stringify(input.primarySystems),
        primaryChannels: JSON.stringify(input.primaryChannels),
        sensitivity: input.sensitivity,
        vocabulary: JSON.stringify(input.vocabulary),
        branding: JSON.stringify(input.branding),
        policyPacks: JSON.stringify(input.policyPacks),
        defaultSkills: JSON.stringify(input.defaultSkills),
        defaultConnectors: JSON.stringify(input.defaultConnectors),
        readOnlyByDefault: input.readOnlyByDefault ? 1 : 0,
        metadata: JSON.stringify(input.metadata),
        createdAt: now,
        updatedAt: now
      });
  }

  return getProfile(database, id)!;
}

export function activateProfile(database: SquidDatabase, id: string): EnterpriseProfile {
  const target = getProfile(database, id);
  if (!target) {
    throw new Error(`Enterprise profile ${id} not found`);
  }
  const now = new Date().toISOString();
  const tx = database.db.transaction(() => {
    database.db.prepare(`UPDATE enterprise_profile SET isActive = 0, updatedAt = ?`).run(now);
    database.db
      .prepare(`UPDATE enterprise_profile SET isActive = 1, updatedAt = ? WHERE id = ?`)
      .run(now, id);
  });
  tx();
  return getProfile(database, id)!;
}

export function deactivateAllProfiles(database: SquidDatabase): void {
  const now = new Date().toISOString();
  database.db.prepare(`UPDATE enterprise_profile SET isActive = 0, updatedAt = ?`).run(now);
}

export const SEED_PROFILES: EnterpriseProfileInput[] = [
  {
    id: "profile_seed_law_firm",
    industry: "legal",
    displayName: "Law Firm",
    businessUnit: null,
    role: "attorney",
    primarySystems: ["clio", "filevine", "office365", "lexisnexis"],
    primaryChannels: ["email", "slack"],
    sensitivity: "regulated",
    vocabulary: {
      project: "matter",
      task: "matter task",
      customer: "client",
      issue: "filing",
      ticket: "intake",
      record: "matter record"
    },
    branding: {
      productName: "SquidBot for Law Firms",
      accentColor: "#1d4ed8",
      supportEmail: "support@squidbot.dev"
    },
    policyPacks: ["attorney-client-privilege", "ediscovery-readiness", "soc2-light"],
    defaultSkills: [
      "contract-clause-extraction",
      "matter-status-summary",
      "discovery-evidence-collection",
      "policy-comparison"
    ],
    defaultConnectors: ["email", "calendar"],
    readOnlyByDefault: true,
    metadata: {
      regulatedNotes: ["Outputs must respect attorney-client privilege.", "No autonomous filing actions."]
    }
  },
  {
    id: "profile_seed_auto_dealer",
    industry: "automotive_retail",
    displayName: "Auto Dealership",
    businessUnit: null,
    role: "operations_manager",
    primarySystems: ["dms", "crm", "inventory", "f&i"],
    primaryChannels: ["sms", "email"],
    sensitivity: "sensitive",
    vocabulary: {
      project: "deal",
      task: "RO",
      customer: "buyer",
      issue: "service ticket",
      ticket: "service ticket",
      record: "repair order"
    },
    branding: {
      productName: "SquidBot for Dealerships",
      accentColor: "#dc2626"
    },
    policyPacks: ["fni-pii-redaction", "gramm-leach-bliley"],
    defaultSkills: [
      "inventory-anomaly-summary",
      "service-ro-summary",
      "customer-followup-draft",
      "fni-checklist"
    ],
    defaultConnectors: ["email"],
    readOnlyByDefault: false,
    metadata: {
      regulatedNotes: ["Customer financial data falls under Gramm-Leach-Bliley."]
    }
  },
  {
    id: "profile_seed_gov_contractor",
    industry: "government_contracting",
    displayName: "Government Contractor",
    businessUnit: null,
    role: "compliance_officer",
    primarySystems: ["sam.gov", "case_management", "records_management"],
    primaryChannels: ["email", "matrix"],
    sensitivity: "regulated",
    vocabulary: {
      project: "case",
      task: "case action",
      customer: "constituent",
      issue: "incident",
      ticket: "request",
      record: "case record"
    },
    branding: {
      productName: "SquidBot for Public Sector",
      accentColor: "#15803d"
    },
    policyPacks: ["foia-readiness", "records-retention", "fedramp-aligned"],
    defaultSkills: [
      "case-intake-triage",
      "records-request-support",
      "policy-research",
      "audit-evidence-collection"
    ],
    defaultConnectors: [],
    readOnlyByDefault: true,
    metadata: {
      regulatedNotes: [
        "Default read-only until a records officer signs off on write scopes.",
        "Air-gapped deployment supported."
      ]
    }
  },
  {
    id: "profile_seed_engineering_shop",
    industry: "software_engineering",
    displayName: "Engineering Shop",
    businessUnit: null,
    role: "engineer",
    primarySystems: ["github", "gitlab", "jira", "ci"],
    primaryChannels: ["slack", "github"],
    sensitivity: "standard",
    vocabulary: {
      project: "repo",
      task: "ticket",
      customer: "stakeholder",
      issue: "issue",
      ticket: "issue",
      record: "PR"
    },
    branding: {
      productName: "SquidBot for Engineering",
      accentColor: "#7c3aed"
    },
    policyPacks: ["secrets-redaction", "secure-defaults"],
    defaultSkills: [
      "pr-review",
      "ci-failure-diagnosis",
      "incident-summary",
      "release-readiness"
    ],
    defaultConnectors: ["github", "gitlab"],
    readOnlyByDefault: false,
    metadata: {}
  },
  {
    id: "profile_seed_healthcare_ops",
    industry: "healthcare_operations",
    displayName: "Healthcare Operations",
    businessUnit: null,
    role: "operations_lead",
    primarySystems: ["ehr_export", "scheduling", "claims"],
    primaryChannels: ["email"],
    sensitivity: "regulated",
    vocabulary: {
      project: "encounter",
      task: "encounter task",
      customer: "patient",
      issue: "claim",
      ticket: "support case",
      record: "encounter record"
    },
    branding: {
      productName: "SquidBot for Healthcare Operations",
      accentColor: "#0891b2"
    },
    policyPacks: ["hipaa-baseline", "phi-redaction", "minimum-necessary"],
    defaultSkills: [
      "claims-prior-auth-support",
      "operations-summary",
      "documentation-assistance",
      "care-coordination-summary"
    ],
    defaultConnectors: [],
    readOnlyByDefault: true,
    metadata: {
      regulatedNotes: [
        "Defaults to read-only until HIPAA covered-entity signoff.",
        "PHI redaction policy enforced on every retrieval."
      ]
    }
  }
];

export function installSeedProfiles(database: SquidDatabase): EnterpriseProfile[] {
  const tx = database.db.transaction(() => {
    const now = new Date().toISOString();
    for (const seed of SEED_PROFILES) {
      const existing = getProfile(database, seed.id!);
      if (existing && existing.seeded) {
        continue;
      }
      if (existing) {
        // Skip — operator has customized a seed-id; do not overwrite.
        continue;
      }
      database.db
        .prepare(
          `INSERT INTO enterprise_profile (
             id, industry, displayName, businessUnit, role,
             primarySystems, primaryChannels, sensitivity, vocabulary,
             branding, policyPacks, defaultSkills, defaultConnectors,
             readOnlyByDefault, isActive, seeded, metadata,
             createdAt, updatedAt
           ) VALUES (
             @id, @industry, @displayName, @businessUnit, @role,
             @primarySystems, @primaryChannels, @sensitivity, @vocabulary,
             @branding, @policyPacks, @defaultSkills, @defaultConnectors,
             @readOnlyByDefault, 0, 1, @metadata,
             @now, @now
           )`
        )
        .run({
          id: seed.id,
          industry: seed.industry,
          displayName: seed.displayName,
          businessUnit: seed.businessUnit,
          role: seed.role,
          primarySystems: JSON.stringify(seed.primarySystems),
          primaryChannels: JSON.stringify(seed.primaryChannels),
          sensitivity: seed.sensitivity,
          vocabulary: JSON.stringify(seed.vocabulary),
          branding: JSON.stringify(seed.branding),
          policyPacks: JSON.stringify(seed.policyPacks),
          defaultSkills: JSON.stringify(seed.defaultSkills),
          defaultConnectors: JSON.stringify(seed.defaultConnectors),
          readOnlyByDefault: seed.readOnlyByDefault ? 1 : 0,
          metadata: JSON.stringify(seed.metadata),
          now
        });
    }
  });
  tx();
  return listProfiles(database).filter((profile) => profile.seeded);
}
