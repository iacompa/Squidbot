import type { SquidDatabase } from "@squidbot/db";
import type { EnterpriseProfile } from "./enterpriseProfile.js";
import { getActiveProfile } from "./enterpriseProfile.js";
import type { ModelAccount } from "./modelAccounts.js";
import { getActiveModelAccount, listModelAccounts, redactAccount } from "./modelAccounts.js";
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

/**
 * Compact snapshot of saved model accounts for the system prompt. We don't
 * include API keys or URLs — just the names + which one is active — so the
 * model can recognise switch intents and call `model.useAccount` with the
 * right identifier.
 */
export type ModelAccountsSnapshot = {
  count: number;
  activeName: string | null;
  /** Up to 12 saved accounts, ordered active-first then alphabetical. */
  accounts: Array<{
    name: string;
    providerKind: string;
    apiModel: string;
    isActive: boolean;
  }>;
};

export type IdentityReport = {
  card: IdentityCard;
  profile: EnterpriseProfile | null;
  capabilities: CapabilitySnapshot;
  modelAccounts: ModelAccountsSnapshot;
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
    capabilities: snapshotCapabilities(toolRegistry),
    modelAccounts: snapshotModelAccounts(database)
  };
}

function snapshotModelAccounts(database: SquidDatabase): ModelAccountsSnapshot {
  // Failures here would block every chat call, so we swallow them and
  // return an empty snapshot. The model_accounts table may not yet exist
  // in test fixtures that hand-craft a stripped database.
  let accounts: ModelAccount[];
  try {
    accounts = listModelAccounts(database);
  } catch {
    return { count: 0, activeName: null, accounts: [] };
  }
  const active = accounts.find((account) => account.isActive) ?? getActiveModelAccount(database);
  const ordered = [...accounts]
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 12);
  return {
    count: accounts.length,
    activeName: active?.name ?? null,
    accounts: ordered.map((account) => ({
      name: account.name,
      providerKind: account.providerKind,
      apiModel: account.apiModel,
      isActive: account.isActive
    }))
  };
}

// Re-export so callers that already imported `redactAccount` via the identity
// barrel don't need to chase another file. Keeps the contract that the
// identity module is the one-stop shop for "describe SquidBot to itself."
export { redactAccount as redactModelAccountForDisplay };

export type SystemPromptOptions = {
  includeCapabilityHints?: boolean;
  maxTools?: number;
  /**
   * Optional memory bulletin to render as a "Relevant memories" section so the
   * agent can cite operator guardrails, founder notes, and other approved
   * memories during chat. Pass the raw output of `buildMemoryBulletin(...)` —
   * an empty / whitespace-only string skips the section entirely.
   */
  memoryBulletin?: string;
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

  // Saved model accounts — printed *before* memories so the model sees a
  // strong, explicit pairing of account names with the model.useAccount tool.
  // The list shows up to 12 accounts (active marked with [active]). If the
  // user mentions any of these names and asks to switch, the model is
  // expected to call model.useAccount with the matching name.
  if (report.modelAccounts.count > 0) {
    lines.push("");
    lines.push("Saved model accounts (use the `model.useAccount` tool to switch active):");
    for (const account of report.modelAccounts.accounts) {
      const marker = account.isActive ? "[active] " : "";
      lines.push(`- ${marker}${account.name}  (${account.providerKind}, ${account.apiModel})`);
    }
    if (report.modelAccounts.count > report.modelAccounts.accounts.length) {
      lines.push(`- … and ${report.modelAccounts.count - report.modelAccounts.accounts.length} more (call model.listAccounts to see them all).`);
    }
    lines.push(
      "If — and only if — the user explicitly asks to change the active LLM/account (\"switch to <name>\", \"use my <name> account\", \"change the model to <name>\"), call the `model.useAccount` tool with the matching name. Do not call it for unrelated requests, even if a name is mentioned in passing. This is different from enterprise *profiles* (industry settings) — those have their own commands."
    );
  }

  // Memory bulletin rendered as a "Relevant memories" section. Includes the
  // operator's guardrails, founder notes from onboarding, and any other
  // approved memories surfaced by hybrid retrieval. We render this AFTER the
  // capability list so the agent has full context before being told what to
  // cite back.
  const trimmedBulletin = (options.memoryBulletin ?? "").trim();
  if (trimmedBulletin.length > 0 && !/^Memory Bulletin\s*[\r\n]+- No approved memories/i.test(trimmedBulletin)) {
    lines.push("");
    lines.push("Relevant memories (sourced, importance-ranked — cite these when they apply):");
    // Bulletin already includes its own "Memory Bulletin" header — drop our
    // own header and just inline the entries so the model sees a single
    // block instead of two stacked headings.
    const bodyLines = trimmedBulletin
      .split(/\r?\n/)
      .filter((line) => !/^Memory Bulletin\s*$/i.test(line.trim()));
    for (const line of bodyLines) {
      lines.push(line);
    }
  }

  lines.push("");
  lines.push(
    "When the user asks who you are, what you can do, or for help getting started, answer in your own words using the facts above. Never claim capabilities you do not have. SquidBot adapts to any business: if the user wants to switch to an industry-tailored profile (law firm, dealership, gov contractor, engineering, healthcare, or a custom one) they can run `npm run profile -- list` and `npm run profile -- activate <id>`, or create their own with `npm run profile -- create`. When the user's question relates to a memory above (guardrail, founder note, system inventory, ...), cite it explicitly so they can see SquidBot is acting on what they told it."
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
