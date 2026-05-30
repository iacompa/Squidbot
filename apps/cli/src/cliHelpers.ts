import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Read the package version at module load time. Using createRequire from the
// file's own directory so this resolves correctly regardless of the cwd at
// runtime. Gracefully falls back to "unknown" if the package.json is missing.
function readPackageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const pkg = require(path.join(dir, "..", "package.json")) as { version?: string };
    return typeof pkg.version === "string" && pkg.version ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

export const CLI_VERSION = readPackageVersion();

export function getCliVersion(): string {
  return CLI_VERSION;
}

export type CommandEntry = {
  name: string;
  usage: string;
  description: string;
};

export type CommandCategory = {
  category: string;
  commands: CommandEntry[];
};

export const CLI_COMMAND_CATEGORIES: CommandCategory[] = [
  {
    category: "CORE",
    commands: [
      { name: "version", usage: "version [--json]", description: "Show SquidBot version." },
      { name: "init", usage: "init", description: "Initialize local data directory." },
      { name: "chat", usage: "chat --workspace <path> \"<message>\"", description: "Send a chat message to the agent." },
      { name: "run", usage: "run --workspace <path> \"<task>\" [--test-command <cmd>]", description: "Run an autonomous task with reflection." },
      { name: "doctor", usage: "doctor [--json]", description: "Check system health and configuration." }
    ]
  },
  {
    category: "MEMORY",
    commands: [
      { name: "memory", usage: "memory list|show|approve|graph <sub>", description: "Manage the memory graph." },
      { name: "reflections", usage: "reflections [show|gaps] [<id>]", description: "Browse agent reflections." },
      { name: "gaps", usage: "gaps list|show|resolve", description: "Manage affordance gaps." }
    ]
  },
  {
    category: "GOVERNANCE",
    commands: [
      { name: "trust", usage: "trust summary|report|digest|packet", description: "Audit + compliance packets." },
      { name: "profile", usage: "profile list|current|create|activate", description: "Enterprise sensitivity profiles." },
      { name: "whoami", usage: "whoami [--json]", description: "Show identity + role report." },
      { name: "governance", usage: "governance decide <actor> <action> <resource>", description: "Test governance decisions." }
    ]
  },
  {
    category: "INTEGRATIONS",
    commands: [
      { name: "connectors", usage: "connectors install|list|call|import-openapi", description: "Manage connectors + OpenAPI import." },
      { name: "mcp", usage: "mcp serve [--workspace <path>]", description: "Expose SquidBot as an MCP server." },
      { name: "messaging", usage: "messaging list|send|channels", description: "Messaging channel adapters." },
      { name: "settings", usage: "settings get|set|unset <key> [<value>]", description: "Manage configuration settings." }
    ]
  },
  {
    category: "MODELS",
    commands: [
      { name: "model", usage: "model budget|accounts", description: "Model accounts + budget." },
      { name: "accounts", usage: "accounts list|add|remove|set-active|test", description: "BYOK model accounts." }
    ]
  },
  {
    category: "SKILLS & EVALS",
    commands: [
      { name: "skill", usage: "skill list|create|promote|rollback", description: "Governed skill management." },
      { name: "eval", usage: "eval run|compare|leaderboard", description: "Evaluation runs + benchmarks." },
      { name: "evolve", usage: "evolve auto --skill <id> --dataset <id>", description: "Eval-gated autonomy loop." }
    ]
  },
  {
    category: "OBSERVABILITY",
    commands: [
      { name: "traces", usage: "traces [list|show|search|export] [--json]", description: "Agent run traces + replay." },
      { name: "metrics", usage: "metrics", description: "Export Prometheus metrics from local DB." },
      { name: "sandbox", usage: "sandbox list|create|approve|reject|status", description: "Sandbox management." }
    ]
  },
  {
    category: "TEAMS & JOBS",
    commands: [
      { name: "team", usage: "team run|status", description: "Multi-agent team runs." },
      { name: "job", usage: "job create|list|runnow|pause|resume|cancel", description: "Scheduled background jobs." }
    ]
  }
];

/**
 * Build the help output. Pass `"json"` for machine-readable output suitable
 * for scripting (`squidbot help --json | jq`).
 */
export function buildHelpText(format?: "json" | "text"): string {
  if (format === "json") {
    return JSON.stringify(
      {
        version: CLI_VERSION,
        categories: CLI_COMMAND_CATEGORIES.map((cat) => ({
          category: cat.category,
          commands: cat.commands.map((cmd) => ({
            name: cmd.name,
            usage: cmd.usage,
            description: cmd.description
          }))
        }))
      },
      null,
      2
    );
  }

  const lines: string[] = [`SquidBot CLI v${CLI_VERSION}`, ""];
  for (const cat of CLI_COMMAND_CATEGORIES) {
    lines.push(`  ${cat.category}`);
    for (const cmd of cat.commands) {
      const pad = 45;
      const usage = `  npm run ${cmd.usage}`.padEnd(pad);
      lines.push(`  ${usage}  ${cmd.description}`);
    }
    lines.push("");
  }
  lines.push("  Pass --json to commands that support it for machine-readable output.");
  return lines.join("\n");
}
