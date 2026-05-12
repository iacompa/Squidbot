import type { SquidDatabase } from "@squidbot/db";
import type { EnterpriseProfile } from "./enterpriseProfile.js";
import { getActiveProfile } from "./enterpriseProfile.js";
import type { ToolRegistry } from "./toolRegistry.js";

export const SQUIDBOT_AGENT_NAME = "SquidBot";
export const SQUIDBOT_AGENT_VERSION = "0.1.0";

export const SQUIDBOT_MISSION =
  "Be the auditable, self-hosted AI agent operating system that any business — including regulated ones — can deploy without sacrificing trust, control, or security.";

export type IdentityCard = {
  id: "singleton";
  agentName: string;
  agentVersion: string;
  mission: string;
  installedAt: string;
  updatedAt: string;
};

export type CapabilityToolSummary = {
  name: string;
  riskLevel: string | null;
  permissionScopes: string[];
};

export type CapabilitySnapshot = {
  toolCount: number;
  tools: CapabilityToolSummary[];
  permissionScopes: string[];
};

export type IdentityReport = {
  card: IdentityCard;
  profile: EnterpriseProfile | null;
  capabilities: CapabilitySnapshot;
};

export function ensureIdentityCard(database: SquidDatabase): IdentityCard {
  const row = database.db
    .prepare(
      `SELECT id, agentName, agentVersion, mission, installedAt, updatedAt
       FROM identity_card
       WHERE id = 'singleton'`
    )
    .get() as IdentityCard | undefined;

  if (row) {
    return row;
  }

  const now = new Date().toISOString();
  database.db
    .prepare(
      `INSERT INTO identity_card (id, agentName, agentVersion, mission, installedAt, updatedAt)
       VALUES ('singleton', @agentName, @agentVersion, @mission, @installedAt, @updatedAt)`
    )
    .run({
      agentName: SQUIDBOT_AGENT_NAME,
      agentVersion: SQUIDBOT_AGENT_VERSION,
      mission: SQUIDBOT_MISSION,
      installedAt: now,
      updatedAt: now
    });

  return {
    id: "singleton",
    agentName: SQUIDBOT_AGENT_NAME,
    agentVersion: SQUIDBOT_AGENT_VERSION,
    mission: SQUIDBOT_MISSION,
    installedAt: now,
    updatedAt: now
  };
}

export function getIdentityCard(database: SquidDatabase): IdentityCard {
  return ensureIdentityCard(database);
}

export function updateIdentityCard(
  database: SquidDatabase,
  update: Partial<Pick<IdentityCard, "agentName" | "agentVersion" | "mission">>
): IdentityCard {
  ensureIdentityCard(database);
  const now = new Date().toISOString();
  database.db
    .prepare(
      `UPDATE identity_card
       SET agentName = COALESCE(@agentName, agentName),
           agentVersion = COALESCE(@agentVersion, agentVersion),
           mission = COALESCE(@mission, mission),
           updatedAt = @updatedAt
       WHERE id = 'singleton'`
    )
    .run({
      agentName: update.agentName ?? null,
      agentVersion: update.agentVersion ?? null,
      mission: update.mission ?? null,
      updatedAt: now
    });
  return getIdentityCard(database);
}

export function snapshotCapabilities(toolRegistry: ToolRegistry | undefined): CapabilitySnapshot {
  if (!toolRegistry) {
    return { toolCount: 0, tools: [], permissionScopes: [] };
  }
  const tools = toolRegistry.list();
  const tally = new Set<string>();
  const summaries: CapabilityToolSummary[] = tools.map((tool) => {
    const scopes = (tool.permissionScopes ?? []).slice().sort();
    scopes.forEach((scope) => tally.add(scope));
    return {
      name: tool.name,
      riskLevel: (tool.riskLevel as string | undefined) ?? null,
      permissionScopes: scopes
    };
  });
  return {
    toolCount: summaries.length,
    tools: summaries.sort((a, b) => a.name.localeCompare(b.name)),
    permissionScopes: [...tally].sort()
  };
}

export function buildIdentityReport(
  database: SquidDatabase,
  toolRegistry: ToolRegistry | undefined
): IdentityReport {
  return {
    card: ensureIdentityCard(database),
    profile: getActiveProfile(database),
    capabilities: snapshotCapabilities(toolRegistry)
  };
}

export type SystemPromptOptions = {
  includeCapabilityHints?: boolean;
  maxTools?: number;
};

export function buildSystemPrompt(
  report: IdentityReport,
  options: SystemPromptOptions = {}
): string {
  const includeCapabilityHints = options.includeCapabilityHints ?? true;
  const maxTools = options.maxTools ?? 12;
  const lines: string[] = [];

  const productName = report.profile?.branding.productName ?? `${report.card.agentName}`;
  lines.push(`You are ${report.card.agentName} (running as "${productName}", v${report.card.agentVersion}).`);
  lines.push(`Mission: ${report.card.mission}`);
  lines.push("");
  lines.push("Operating principles:");
  lines.push("- Every action is permissioned, traced, and auditable.");
  lines.push("- Risky actions require explicit user approval before execution.");
  lines.push("- Memory is structured, sourced, and inspectable.");
  lines.push("- Reflection runs after complex work.");
  lines.push("- Self-improvement requires evaluation before promotion.");
  lines.push("- Zero project-side spend by default; paid providers are opt-in BYOK.");

  if (report.profile) {
    const profile = report.profile;
    lines.push("");
    lines.push("Active enterprise profile:");
    lines.push(`- Industry: ${profile.industry}`);
    lines.push(`- Display name: ${profile.displayName}`);
    if (profile.role) lines.push(`- Operator role: ${profile.role}`);
    if (profile.businessUnit) lines.push(`- Business unit: ${profile.businessUnit}`);
    lines.push(`- Sensitivity: ${profile.sensitivity}`);
    lines.push(`- Read-only by default: ${profile.readOnlyByDefault ? "yes" : "no"}`);
    if (profile.policyPacks.length > 0) {
      lines.push(`- Active policy packs: ${profile.policyPacks.join(", ")}`);
    }
    if (profile.primarySystems.length > 0) {
      lines.push(`- Primary systems: ${profile.primarySystems.join(", ")}`);
    }
    if (profile.primaryChannels.length > 0) {
      lines.push(`- Primary channels: ${profile.primaryChannels.join(", ")}`);
    }
    const vocabEntries = Object.entries(profile.vocabulary);
    if (vocabEntries.length > 0) {
      lines.push("- Vocabulary: " + vocabEntries.map(([from, to]) => `${from}→${to}`).join(", "));
    }
    const regulatedNotes = profile.metadata?.regulatedNotes;
    if (Array.isArray(regulatedNotes) && regulatedNotes.length > 0) {
      lines.push("- Regulated notes:");
      for (const note of regulatedNotes) {
        lines.push(`  - ${String(note)}`);
      }
    }
    const genericNotes = profile.metadata?.genericNotes;
    if (Array.isArray(genericNotes) && genericNotes.length > 0) {
      lines.push("- Notes:");
      for (const note of genericNotes) {
        lines.push(`  - ${String(note)}`);
      }
    }
  } else {
    // No profile at all (e.g. operator explicitly deactivated everything).
    // The generic profile is auto-installed on first runtime construction,
    // so this branch is rare — but we keep it neutral and non-prescriptive.
    lines.push("");
    lines.push("No enterprise profile is currently active. You can still help with general work — adapt to whatever the user describes about their business.");
  }

  if (includeCapabilityHints) {
    const caps = report.capabilities;
    lines.push("");
    lines.push(`Currently registered tools (${caps.toolCount} total):`);
    if (caps.tools.length === 0) {
      lines.push("- No tools registered for this session.");
    } else {
      for (const tool of caps.tools.slice(0, maxTools)) {
        const scopes = tool.permissionScopes.length > 0 ? ` [${tool.permissionScopes.join(",")}]` : "";
        const risk = tool.riskLevel ? ` risk=${tool.riskLevel}` : "";
        lines.push(`- ${tool.name}${risk}${scopes}`);
      }
      if (caps.tools.length > maxTools) {
        lines.push(`- … and ${caps.tools.length - maxTools} more (use a discover-tools call to inspect all).`);
      }
    }
  }

  lines.push("");
  lines.push(
    "When the user asks who you are, what you can do, or for help getting started, answer in your own words using the facts above. Never claim capabilities you do not have. SquidBot adapts to any business: if the user wants to switch to an industry-tailored profile (law firm, dealership, gov contractor, engineering, healthcare, or a custom one) they can run `npm run profile -- list` and `npm run profile -- activate <id>`, or create their own with `npm run profile -- create`."
  );

  return lines.join("\n");
}

export function describeForWhoami(report: IdentityReport): string {
  const lines: string[] = [];
  const productName = report.profile?.branding.productName ?? report.card.agentName;
  lines.push(`${report.card.agentName} v${report.card.agentVersion} — running as "${productName}".`);
  lines.push("");
  lines.push(`Mission: ${report.card.mission}`);

  if (report.profile) {
    lines.push("");
    lines.push(`Active profile: ${report.profile.displayName} (${report.profile.industry}).`);
    lines.push(`  Sensitivity: ${report.profile.sensitivity}`);
    lines.push(`  Read-only by default: ${report.profile.readOnlyByDefault ? "yes" : "no"}`);
    if (report.profile.policyPacks.length > 0) {
      lines.push(`  Policy packs: ${report.profile.policyPacks.join(", ")}`);
    }
  } else {
    lines.push("");
    lines.push("Active profile: none. SquidBot still works for general tasks; pick or create one via `npm run profile -- list` / `create`.");
  }

  lines.push("");
  lines.push(`Tools registered: ${report.capabilities.toolCount}`);
  lines.push(`Permission scopes: ${report.capabilities.permissionScopes.join(", ") || "(none)"}`);

  return lines.join("\n");
}
