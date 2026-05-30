import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { execFileSync } from "node:child_process";
import { buildHelpText, getCliVersion } from "./cliHelpers.js";
import { checkForUpdates, exportMigrationBundle, importMigrationBundle } from "./migrate.js";
import { createSquidbotServer, generateDockerfile } from "./server.js";
import fs from "node:fs";
import path from "node:path";
import { ConnectorRegistry, importOpenApi, installDeveloperWorkflowConnectors, registerConnectorTools, SquidbotMcpServer } from "@squidbot/connectors";
import { initializeDatabase, type SandboxRecord } from "@squidbot/db";
import {
  BenchmarkRunner,
  compareEvalRuns,
  createCanaryForVariant,
  DatasetRegistry,
  EvalResultStore,
  listLeaderboard,
  loadDatasetManifest,
  MutationProposer,
  promoteVariant,
  rollbackEvolution,
  runImprovementCycle,
  runStaticChecks,
  SkillVariantStore
} from "@squidbot/evals";
import {
  AuditExporter,
  buildCompliancePacket,
  buildTrustReport,
  DEFAULT_ADMIN_USER_ID,
  DEFAULT_TENANT_ID,
  digestTrustReport,
  formatTrustReportMarkdown,
  GovernanceEngine,
  policyPacks,
  summarizeTrustReport,
  type ComplianceFramework
} from "@squidbot/governance";
import { MemoryGraphStore } from "@squidbot/memory";
import {
  DeliveryRouter,
  getPlatformMatrixEntry,
  listPlatformMatrix,
  MessagingAdapterRegistry,
  MessagingGateway,
  MessagingStore,
  startSlackWebhookServer,
  unwrapSlackWebhookPayloads,
  type MessagingPlatform
} from "@squidbot/messaging";
import { parseCommandLine, SandboxManager, sandboxFromRecord } from "@squidbot/sandbox";
import { Scheduler, type CreateJobRequest } from "@squidbot/scheduler";
import { evaluateSkill, installDeveloperWorkflowSkills, normalizeSkillId, SkillService, validateSkillManifest } from "@squidbot/skills";
import { defaultTeamManifest, RoleRegistry, TeamCoordinator, TeamStore, validateTeamManifest } from "@squidbot/team";
import {
  activateModelAccount,
  activateProfile,
  AgentRuntime,
  approveMemoryCandidate,
  buildIdentityReport,
  buildTrace,
  commitOnboarding,
  computeTraceMetrics,
  createCustomProfile,
  createId,
  createSecretCipher,
  deleteModelAccount,
  describeForWhoami,
  ensureLegacyAccountMigrated,
  ensureLocalConfig,
  exportTraceMarkdown,
  formatNextActions,
  formatOnboardingSummary,
  getActiveModelAccount,
  getActiveProfile,
  getModelAccountByName,
  getProviderPreset,
  getTrace,
  getLatestTrace,
  inferOnboardingProfile,
  installSeedProfiles,
  EventLog,
  listModelAccounts,
  listProfiles,
  listRuns,
  loadOrCreateMasterKey,
  PolicyEngine,
  PROVIDER_PRESETS,
  redactAccount,
  redactValue,
  registerModelAccountTools,
  registerTerminalTools,
  exportPrometheusMetrics,
  registerTestTools,
  registerWorkspaceTools,
  searchEvents,
  STANDARD_QUESTIONS,
  ToolRegistry,
  upsertModelAccount,
  type AgentEvent,
  type JsonObject,
  type ModelAccountInput,
  type OnboardingAnswer,
  type OnboardingQuestion,
  type SecretCipher,
  type ProviderKind
} from "@squidbot/core";

type ParsedArgs = {
  command: string;
  workspace?: string;
  testCommand?: string;
  message?: string;
};

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  let workspace: string | undefined;
  let testCommand: string | undefined;
  const messageParts: string[] = [];

  const takeFlagValue = (flag: string, index: number): string => {
    const next = rest[index + 1];
    if (typeof next !== "string" || next.startsWith("--")) {
      throw new Error(`${flag} requires a value.`);
    }
    return next;
  };

  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (item === "--workspace") {
      workspace = takeFlagValue("--workspace", index);
      index += 1;
    } else if (item === "--test-command") {
      testCommand = takeFlagValue("--test-command", index);
      index += 1;
    } else {
      messageParts.push(item);
    }
  }

  return { command, workspace, testCommand, message: messageParts.join(" ").trim() || undefined };
}

function resolveFromInvocationCwd(targetPath: string): string {
  const invocationCwd = process.env.INIT_CWD ?? process.cwd();
  return path.resolve(invocationCwd, targetPath);
}

// Decrypts/encrypts BYOK keys in model_accounts. Master key lives in a 0600
// file under appDataDir (never in the DB). Set once at startup in main().
let cliSecretCipher: SecretCipher | undefined;
// Path to the governance vault's master-key file (outside the DB).
let cliVaultKeyFile: string | undefined;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = ensureLocalConfig();
  const database = initializeDatabase(config.databasePath);
  cliSecretCipher = createSecretCipher(
    loadOrCreateMasterKey({ keyFilePath: path.join(config.appDataDir, "secret.key") })
  );
  cliVaultKeyFile = path.join(config.appDataDir, "vault.master.key");

  try {
    if (args.command === "version") {
      const parts = splitCommandParts(args.message);
      if (parts.includes("--json")) {
        printJson({ version: getCliVersion(), name: "@squidbot/cli" });
      } else {
        console.log(`SquidBot CLI v${getCliVersion()}`);
      }
      return;
    }

    if (args.command === "init") {
      database.setSetting("model.provider", "local");
      console.log(`Initialized SquidBot local data at ${config.appDataDir}`);
      console.log(`Database: ${config.databasePath}`);
      return;
    }

    if (args.command === "traces") {
      handleTracesCommand(database, splitCommandParts(args.message));
      return;
    }

    if (args.command === "reflections") {
      const parts = splitCommandParts(args.message);
      const subcommand = parts[0] ?? "list";

      if (subcommand === "show") {
        const reflectionId = parts[1];
        if (!reflectionId) {
          throw new Error("Reflection ID is required. Example: npm run reflections -- show reflection_...");
        }

        const reflection = database.getReflection(reflectionId);
        console.log(reflection ? JSON.stringify(reflection, null, 2) : `Reflection not found: ${reflectionId}`);
        return;
      }

      if (subcommand === "gaps") {
        const reflectionId = parts[1];
        if (!reflectionId) {
          throw new Error("Usage: npm run reflections -- gaps <reflection-id>");
        }

        const reflection = database.getReflection(reflectionId);
        if (!reflection) {
          throw new Error(`Reflection not found: ${reflectionId}`);
        }

        printJson({
          reflection,
          gaps: database.listAffordanceGapsForReflection(reflectionId)
        });
        return;
      }

      const reflections = database.listReflections(10);
      if (reflections.length === 0) {
        console.log("No reflections recorded yet.");
        return;
      }

      console.log("Recent reflections");
      for (const reflection of reflections) {
        console.log(`- ${reflection.id}`);
        console.log(`  task: ${reflection.task}`);
        console.log(`  outcome: ${reflection.outcome}`);
        console.log(`  candidates: ${reflection.memoryCandidates.length}`);
        console.log(`  created: ${reflection.createdAt}`);
      }
      return;
    }

    if (args.command === "gaps") {
      handleGapsCommand(database, splitCommandParts(args.message));
      return;
    }

    if (args.command === "sandbox") {
      await handleSandboxCommand(database, splitCommandParts(args.message));
      return;
    }

    if (args.command === "skill" || args.command === "skills") {
      await handleSkillCommand(database, config.appDataDir, args, splitCommandParts(args.message));
      return;
    }

    if (args.command === "job" || args.command === "jobs") {
      await handleJobCommand(database, config.appDataDir, args, splitCommandParts(args.message));
      return;
    }

    if (args.command === "team" || args.command === "teams") {
      await handleTeamCommand(database, args, splitCommandParts(args.message));
      return;
    }

    if (args.command === "eval") {
      await handleEvalCommand(database, config.appDataDir, splitCommandParts(args.message));
      return;
    }

    if (args.command === "evolve") {
      await handleEvolveCommand(database, config.appDataDir, splitCommandParts(args.message));
      return;
    }

    if (args.command === "messaging") {
      await handleMessagingCommand(database, args, splitCommandParts(args.message));
      return;
    }

    if (args.command === "mcp") {
      await handleMcpCommand(database, args, splitCommandParts(args.message));
      return;
    }

    if (args.command === "governance") {
      await handleGovernanceCommand(database, splitCommandParts(args.message));
      return;
    }

    if (args.command === "project:status") {
      await handleProjectStatusCommand(database);
      return;
    }

    if (args.command === "doctor") {
      await handleDoctorCommand(database, config.appDataDir);
      return;
    }

    if (args.command === "demo") {
      await handleDemoCommand(database, args);
      return;
    }

    if (args.command === "metrics") {
      // Prometheus text-exposition format — pipe to a file or scrape endpoint.
      // Local-first: the data is computed from the local DB and never leaves.
      process.stdout.write(exportPrometheusMetrics(database));
      return;
    }

    if (args.command === "serve") {
      const parts = splitCommandParts(args.message);
      const port = collectFlagNumber(parts, "--port") ?? 8080;
      const apiToken = collectFlagValue(parts, "--token") ?? process.env.SQUIDBOT_TOKEN;
      const workspacePath = args.workspace ? resolveFromInvocationCwd(args.workspace) : config.appDataDir;

      if (parts.includes("--dockerfile")) {
        // Output Dockerfile + .dockerignore to stdout (redirect to files).
        const { dockerfile, dockerignore } = generateDockerfile({ port });
        console.log("=== Dockerfile ===");
        process.stdout.write(dockerfile);
        console.log("\n=== .dockerignore ===");
        process.stdout.write(dockerignore);
        return;
      }

      // Bind to loopback by default — the banner used to claim "localhost"
      // while Node bound 0.0.0.0 (LAN-reachable). Operators opt into a public
      // interface with --host 0.0.0.0 (e.g. inside a container), which should
      // always be paired with --token.
      const host = collectFlagValue(parts, "--host") ?? "127.0.0.1";
      const app = createSquidbotServer(database, { workspace: workspacePath, apiToken });
      app.listen(port, host, () => {
        const shownHost = host === "0.0.0.0" || host === "::" ? "0.0.0.0" : host;
        console.log(`SquidBot server running at http://${shownHost}:${port} (bound to ${host})`);
        console.log(`  GET  /health   — readiness check`);
        console.log(`  GET  /metrics  — Prometheus scrape`);
        console.log(`  POST /api/*    — IPC bridge`);
        if (apiToken) console.log(`  Auth: Bearer token required`);
        if (host !== "127.0.0.1" && host !== "localhost" && !apiToken) {
          console.log(`  WARNING: bound to ${host} without --token — anyone who can reach this port can call the API.`);
        }
      });
      // Keep the process alive — SIGINT/SIGTERM stop it.
      await new Promise(() => {});
      return;
    }

    if (args.command === "update") {
      const current = getCliVersion();
      const result = await checkForUpdates(current);
      printJson(result);
      if (!result.upToDate) process.exitCode = result.upToDate === false ? 2 : 1;
      return;
    }

    if (args.command === "migrate") {
      const parts = splitCommandParts(args.message);
      const sub = parts[0];
      if (sub === "export") {
        const outFile = collectFlagValue(parts, "--out");
        const bundle = exportMigrationBundle(database);
        const json = JSON.stringify(bundle, null, 2);
        if (outFile) {
          fs.writeFileSync(resolveFromInvocationCwd(outFile), json, "utf8");
          console.log(`Exported migration bundle to ${outFile}`);
        } else {
          process.stdout.write(json + "\n");
        }
        return;
      }
      if (sub === "import") {
        const inFile = collectFlagValue(parts, "--from");
        if (!inFile) throw new Error("Usage: npm run migrate -- import --from <bundle.json> [--overwrite]");
        const raw = fs.readFileSync(resolveFromInvocationCwd(inFile), "utf8");
        const bundle = JSON.parse(raw) as Parameters<typeof importMigrationBundle>[1];
        const overwrite = parts.includes("--overwrite");
        const result = importMigrationBundle(database, bundle, { overwrite });
        printJson({ ok: true, ...result });
        return;
      }
      throw new Error("Usage: npm run migrate -- export [--out file.json] | import --from file.json [--overwrite]");
    }

    if (args.command === "memory") {
      const parts = splitCommandParts(args.message);
      const subcommand = parts[0] ?? "list";

      if (subcommand === "graph") {
        handleMemoryGraphCommand(database, parts.slice(1));
        return;
      }

      if (subcommand === "show") {
        const memoryId = parts[1];
        if (!memoryId) {
          throw new Error("Memory ID is required. Example: npm run memory -- show memory_...");
        }

        const memory = database.getMemory(memoryId);
        console.log(memory ? JSON.stringify(memory, null, 2) : `Memory not found: ${memoryId}`);
        return;
      }

      if (subcommand === "approve") {
        const reflectionId = parts[1];
        const candidateIndex = Number(parts[2]);
        if (!reflectionId || !Number.isInteger(candidateIndex)) {
          throw new Error("Usage: npm run memory -- approve <reflection-id> <candidate-index>");
        }

        const result = approveMemoryCandidate(database, reflectionId, candidateIndex);
        console.log("Approved memory");
        console.log(`- id: ${result.memory.id}`);
        console.log(`- type: ${result.memory.type}`);
        console.log(`- title: ${result.memory.title}`);
        console.log(`- source reflection: ${result.reflection.id}`);
        return;
      }

      const memories = database.listApprovedMemories(50);
      if (memories.length === 0) {
        console.log("No approved memories yet.");
        return;
      }

      console.log("Approved memories");
      for (const memory of memories) {
        console.log(`- ${memory.id}`);
        console.log(`  type: ${memory.type}`);
        console.log(`  title: ${memory.title}`);
        console.log(`  approved: ${memory.approvedAt ?? "not approved"}`);
      }
      return;
    }

    if (args.command === "connectors") {
      const parts = splitCommandParts(args.message);
      const subcommand = parts[0] ?? "list";
      const registry = new ConnectorRegistry(database);
      installDeveloperWorkflowConnectors(registry);

      if (subcommand === "install") {
        const manifestPath = parts[1];
        if (!manifestPath) {
          throw new Error("Usage: npm run connectors -- install ./connectors/demo/githubConnector.json");
        }

        const manifest = registry.installManifest(resolveFromInvocationCwd(manifestPath));
        console.log(`Installed connector: ${manifest.name}`);
        console.log(`- protocol: ${manifest.protocol}`);
        console.log(`- fixture mode: ${manifest.fixtureMode ? "on" : "off"}`);
        console.log(`- operations: ${manifest.endpoints.map((endpoint) => endpoint.operationId).join(", ")}`);
        return;
      }

      if (subcommand === "import-openapi") {
        const specPath = parts[1];
        const nameFlagIndex = parts.indexOf("--name");
        const connectorName = nameFlagIndex >= 0 ? parts[nameFlagIndex + 1] : undefined;
        if (!specPath || !connectorName) {
          throw new Error("Usage: npm run connectors -- import-openapi ./packages/connectors/test/fixtures/petstore.json --name petstore");
        }

        const result = importOpenApi({
          specPath: resolveFromInvocationCwd(specPath),
          name: connectorName,
          manifestOutputPath: resolveFromInvocationCwd(`connectors/generated/${connectorName}.json`),
          generatedRoot: resolveFromInvocationCwd(`packages/connectors/src/generated/${connectorName}`)
        });
        registry.registerConnector(result.manifest);
        console.log(`Imported OpenAPI connector: ${result.manifest.name}`);
        console.log(`- manifest: ${result.manifestPath}`);
        console.log(`- generated: ${result.generatedDir}`);
        console.log(`- operations: ${result.manifest.endpoints.map((endpoint) => endpoint.operationId).join(", ")}`);
        return;
      }

      if (subcommand === "call") {
        const connectorName = parts[1];
        const operationName = parts[2];
        if (!connectorName) {
          throw new Error("Usage: npm run connectors -- call <connector-name> [operation-name]");
        }

        const connector = registry.getConnector(connectorName);
        if (!connector) {
          throw new Error(`Connector is not installed: ${connectorName}`);
        }

        const workspacePath = resolveFromInvocationCwd(args.workspace ?? ".");
        const runtime = createRuntime({ database, workspacePath });
        const result = await runtime.sendMessage(`Call ${connectorName} connector ${operationName ?? ""}`.trim());
        console.log(result.content);
        return;
      }

      const connectors = registry.listConnectors();
      if (connectors.length === 0) {
        console.log("No connectors installed yet.");
        return;
      }

      console.log("Installed connectors");
      for (const connector of connectors) {
        console.log(`- ${connector.name}`);
        console.log(`  type: ${connector.systemType}`);
        console.log(`  protocol: ${connector.protocol}`);
        console.log(`  fixture: ${connector.fixtureMode ? "on" : "off"}`);
        console.log(`  operations: ${connector.endpoints.map((endpoint) => endpoint.operationId).join(", ")}`);
      }
      return;
    }

    if (args.command === "settings") {
      const parts = splitCommandParts(args.message);
      const subcommand = parts[0] ?? "list";

      if (subcommand === "get") {
        const key = parts[1];
        if (!key) {
          throw new Error("Usage: npm run settings -- get <key>");
        }

        console.log(`${key}: ${redactSettingValue(key, readSettingWithDefault(database, key))}`);
        return;
      }

      if (subcommand === "set") {
        const key = parts[1];
        const value = parts.slice(2).join(" ");
        if (!key || !value) {
          throw new Error("Usage: npm run settings -- set <key> <value>");
        }

        database.setSetting(key, parseSettingValue(key, value));
        console.log(`Saved setting: ${key}`);
        return;
      }

      if (subcommand === "unset") {
        const key = parts[1];
        if (!key) {
          throw new Error("Usage: npm run settings -- unset <key>");
        }

        database.deleteSetting(key);
        console.log(`Removed setting: ${key}`);
        return;
      }

      const settings = withDefaultModelSettings(database.getAllSettings());
      console.log("Settings");
      for (const [key, value] of Object.entries(settings)) {
        if (key === "modelProvider" || key === "byokEnabled") {
          continue;
        }
        console.log(`- ${key}: ${redactSettingValue(key, value)}`);
      }
      return;
    }

    if (args.command === "model") {
      const parts = splitCommandParts(args.message);
      const subcommand = parts[0] ?? "budget";

      if (subcommand === "budget") {
        const budget = database.getSetting<string | number>("model.budget.api");
        const budgetTokens = normalizeTokenBudget(budget);
        const today = new Date().toISOString().slice(0, 10);
        const usage = database.getModelUsage("api", today);
        const usedTokens = usage?.tokens ?? 0;
        console.log("Model budget");
        console.log(`- provider: api`);
        console.log(`- date: ${today}`);
        console.log(`- budget tokens: ${budgetTokens ?? "not set"}`);
        console.log(`- used tokens: ${usedTokens}`);
        console.log(`- remaining tokens: ${budgetTokens === null ? "unlimited" : Math.max(0, budgetTokens - usedTokens)}`);
        console.log(`- estimated cost: ${formatCost(usage?.cost ?? 0)}`);
        return;
      }

      if (subcommand === "accounts" || subcommand === "account") {
        await handleModelAccountsCommand(database, parts.slice(1));
        return;
      }

      if (subcommand === "presets") {
        if (parts.includes("--json")) {
          printJson({ presets: PROVIDER_PRESETS });
          return;
        }
        console.log("Provider presets:");
        for (const preset of PROVIDER_PRESETS) {
          console.log(`- ${preset.kind}  ${preset.displayName}`);
          console.log(`    URL: ${preset.defaultApiUrl || "(set per-account)"}`);
          if (preset.commonModels.length > 0) {
            console.log(`    Common models: ${preset.commonModels.slice(0, 4).map((model) => model.id).join(", ")}${preset.commonModels.length > 4 ? ", ..." : ""}`);
          }
        }
        return;
      }

      throw new Error("Usage: npm run model -- budget | accounts <subcommand> | presets [--json]");
    }

    if (args.command === "chat") {
      const workspacePath = resolveFromInvocationCwd(args.workspace ?? ".");
      database.setSetting("workspacePath", workspacePath);

      const runtime = createRuntime({ database, workspacePath });

      if (args.message) {
        const result = await runtime.sendMessage(args.message);
        console.log(result.content);
        deliverMessagingRunSummary(database, result.runId, result.content);
        return;
      }

      console.log(`SquidBot mock chat. Workspace: ${workspacePath}`);
      console.log("Type a message or /exit.");
      const rl = readline.createInterface({ input, output });

      while (true) {
        const answer = await rl.question("> ");
        if (answer.trim() === "/exit") {
          rl.close();
          return;
        }

        // A single failed turn must not kill the whole REPL session — print
        // the error and keep prompting (3.9).
        try {
          const result = await runtime.sendMessage(answer);
          console.log(result.content);
          deliverMessagingRunSummary(database, result.runId, result.content);
        } catch (error) {
          console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    if (args.command === "run") {
      if (!args.message) {
        throw new Error("A quoted task is required. Example: npm run run -- --workspace ./examples/buggy-python \"Fix the failing test\"");
      }

      const workspacePath = resolveFromInvocationCwd(args.workspace ?? ".");
      database.setSetting("workspacePath", workspacePath);

      const runtime = createRuntime({ database, workspacePath });
      const result = await runtime.runTask(args.message, { testCommand: args.testCommand });

      console.log("Plan");
      console.log(`- Problem: ${result.plan.problem}`);
      console.log(`- Risk: ${result.plan.riskLevel}`);
      console.log("- Actions:");
      for (const action of result.plan.actions) {
        console.log(`  - ${action.description} (${action.toolName})`);
      }

      console.log("");
      console.log("Tool calls");
      for (const toolResult of result.toolResults) {
        const status = toolResult.ok ? "ok" : "failed";
        console.log(`- ${toolResult.toolName}: ${status}`);
        if (toolResult.toolName === "workspace.createPatch" && toolResult.ok) {
          const output = toolResult.output as { patch?: string };
          console.log(indentBlock(output.patch ?? "", "  "));
        }
        if (toolResult.toolName === "test.run" && toolResult.ok) {
          const output = toolResult.output as { exitCode?: number | null; stdout?: string; stderr?: string; dryRun?: boolean };
          console.log(`  ${output.dryRun ? "dry run" : `exit code: ${output.exitCode ?? "unknown"}`}`);
          if (output.stdout) {
            console.log(indentBlock(output.stdout.trim(), "  stdout: "));
          }
          if (output.stderr) {
            console.log(indentBlock(output.stderr.trim(), "  stderr: "));
          }
        }
        if (toolResult.toolName.startsWith("connector.") && toolResult.ok) {
          const output = toolResult.output as { fixture?: boolean; response?: unknown };
          console.log(`  ${output.fixture ? "fixture response" : "response"}`);
          console.log(indentBlock(JSON.stringify(output.response ?? output, null, 2), "  "));
        }
      }

      console.log("");
      console.log(result.finalSummary);
      console.log(`Reflection: ${result.reflection.id} (${result.reflection.outcome})`);
      console.log(`Memory candidates: ${result.reflection.memoryCandidates.length}`);
      console.log(`Memories loaded: ${result.retrievedMemories.length}`);
      deliverMessagingRunSummary(database, result.runId, result.finalSummary);
      return;
    }

    if (args.command === "whoami") {
      installSeedProfiles(database);
      const toolRegistry = createToolRegistryForReporting();
      const report = buildIdentityReport(database, toolRegistry);
      const parts = splitCommandParts(args.message);
      if (parts.includes("--json")) {
        printJson(report);
      } else {
        console.log(describeForWhoami(report));
      }
      return;
    }

    if (args.command === "trust") {
      await handleTrustCommand(database, splitCommandParts(args.message));
      return;
    }

    if (args.command === "profile" || args.command === "profiles") {
      await handleProfileCommand(database, splitCommandParts(args.message));
      return;
    }

    if (args.command === "onboarding" || args.command === "onboard") {
      await handleOnboardingCommand(database, splitCommandParts(args.message));
      return;
    }

    // Show categorized help. `help --json` outputs machine-readable JSON for
    // piping into jq / scripting; plain `help` shows human-readable categories.
    const helpParts = splitCommandParts(args.message);
    const helpFormat = helpParts.includes("--json") ? "json" : "text";
    console.log(buildHelpText(helpFormat));
  } finally {
    database.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

function indentBlock(value: string, prefix: string): string {
  if (!value) {
    return "";
  }

  return value
    .split(/\r?\n/)
    .map((line, index) => `${index === 0 ? prefix : " ".repeat(prefix.length)}${line}`)
    .join("\n");
}

function splitCommandParts(value: string | undefined): string[] {
  return value?.split(/\s+/).filter(Boolean) ?? [];
}

/**
 * `npm run mcp -- serve [--workspace <path>]` — run SquidBot as an MCP server
 * over stdio so Claude Desktop / Cursor / any MCP client can call its tools.
 * Every call is governed by the PolicyEngine and audited to the event log.
 */
async function handleMcpCommand(
  database: ReturnType<typeof initializeDatabase>,
  args: { workspace?: string },
  parts: string[]
): Promise<void> {
  const sub = parts[0] ?? "serve";
  if (sub !== "serve") {
    throw new Error("Usage: npm run mcp -- serve [--workspace <path>]");
  }

  const workspacePath = args.workspace
    ? resolveFromInvocationCwd(args.workspace)
    : database.getSetting<string>("workspacePath") ?? resolveFromInvocationCwd(".");

  const toolRegistry = new ToolRegistry();
  registerWorkspaceTools(toolRegistry);
  registerTerminalTools(toolRegistry);
  registerTestTools(toolRegistry);
  registerModelAccountTools(toolRegistry, database);
  const connectorRegistry = new ConnectorRegistry(database);
  installDeveloperWorkflowConnectors(connectorRegistry);
  registerConnectorTools(toolRegistry, connectorRegistry);

  const server = new SquidbotMcpServer(toolRegistry, {
    policyEngine: new PolicyEngine(),
    eventLog: new EventLog(database),
    database,
    workspacePath
  });

  // Diagnostics go to STDERR — stdout is the JSON-RPC channel and any stray
  // byte there corrupts the MCP protocol stream the client is parsing.
  console.error(
    `SquidBot MCP server ready over stdio — ${toolRegistry.list().length} governed tools (workspace: ${workspacePath}). Ctrl+C to stop.`
  );
  await server.serveStdio();
  // Keep the process (and DB connection) alive while the stdio transport
  // services requests via its stdin/stdout listeners.
  await new Promise<void>(() => undefined);
}

function createRuntime(options: { database: ReturnType<typeof initializeDatabase>; workspacePath: string; sessionId?: string }): AgentRuntime {
  const toolRegistry = new ToolRegistry();
  registerWorkspaceTools(toolRegistry);
  registerTerminalTools(toolRegistry);
  registerTestTools(toolRegistry);
  // Model-account management tools (model.listAccounts + model.useAccount)
  // must be registered HERE because we pass `toolRegistry` into AgentRuntime,
  // which suppresses its built-in registration block. Without these the
  // agent has no way to switch accounts via chat — only the CLI / Settings
  // UI paths work.
  registerModelAccountTools(toolRegistry, options.database);
  const connectorRegistry = new ConnectorRegistry(options.database);
  installDeveloperWorkflowConnectors(connectorRegistry);
  registerConnectorTools(toolRegistry, connectorRegistry);

  return new AgentRuntime({
    database: options.database,
    workspacePath: options.workspacePath,
    sessionId: options.sessionId,
    toolRegistry,
    secretCipher: cliSecretCipher
  });
}

function createMessagingGateway(database: ReturnType<typeof initializeDatabase>, workspacePath?: string): MessagingGateway {
  const store = new MessagingStore(database);
  new MessagingAdapterRegistry(store).installDefaults();
  return new MessagingGateway({
    database,
    workspacePath: workspacePath ?? database.getSetting<string>("workspacePath") ?? resolveFromInvocationCwd("."),
    createRuntime: (resolvedWorkspacePath, sessionId) => createRuntime({ database, workspacePath: resolvedWorkspacePath, sessionId }),
    runSkillCommand: async (skillArgs, sessionId) => {
      const subcommand = skillArgs[0];
      const skillRef = skillArgs[1];
      if (subcommand !== "run" || !skillRef) {
        throw new Error("Usage: /squid skill run <skillId> --workspace <path> [--test]");
      }
      const service = new SkillService(database);
      installDeveloperWorkflowSkills(service);
      const skillId = resolveSkillReference(service, skillRef);
      if (!skillId) {
        throw new Error(`Skill not found: ${skillRef}`);
      }
      const plan = service.prepareRun(skillId, collectFlagValue(skillArgs, "--version"));
      const requestedWorkspace = collectFlagValue(skillArgs, "--workspace");
      const skillWorkspacePath =
        requestedWorkspace ??
        plan.version.testFixtures[0]?.repoPath ??
        workspacePath ??
        database.getSetting<string>("workspacePath");
      if (!skillWorkspacePath) {
        throw new Error("Messaging skill run requires --workspace <path> or a skill fixture.");
      }
      const runtime = createRuntime({
        database,
        workspacePath: resolveFromInvocationCwd(skillWorkspacePath),
        sessionId
      });
      const result = await runtime.runTask(plan.task, {
        testCommand: collectFlagValue(skillArgs, "--test-command") ?? plan.testCommand,
        skillCall: {
          skillId,
          version: plan.version.version,
          testMode: skillArgs.includes("--test")
        }
      });
      service.appendSkillRunEvent({
        runId: result.runId,
        skillId,
        version: plan.version.version,
        workspacePath: skillWorkspacePath,
        testMode: skillArgs.includes("--test"),
        traceId: result.trace.id
      });
      return { runId: result.runId, summary: result.finalSummary };
    }
  });
}

function deliverMessagingRunSummary(database: ReturnType<typeof initializeDatabase>, runId: string, text: string): void {
  const store = new MessagingStore(database);
  if (store.listDeliveryRules("runSummary").some((rule) => rule.enabled)) {
    createMessagingGateway(database).deliverRunSummary(runId, text);
  }
}

function deliverMessagingTrigger(
  database: ReturnType<typeof initializeDatabase>,
  triggerType: Parameters<DeliveryRouter["deliverToRules"]>[0],
  message: Parameters<DeliveryRouter["deliverToRules"]>[1]
): void {
  const store = new MessagingStore(database);
  const router = new DeliveryRouter(store);
  if (!router.listRules(triggerType).some((rule) => rule.enabled)) {
    return;
  }
  const results = router.deliverToRules(triggerType, message);
  for (const result of results) {
    database.appendEvent({
      id: createId("evt"),
      timestamp: new Date().toISOString(),
      sessionId: "session_messaging",
      type: result.ok ? "messaging.delivery.sent" : "messaging.delivery.failed",
      data: {
        runId: message.runId ?? message.teamRunId ?? message.jobId ?? message.skillId ?? "run_session_messaging",
        triggerType,
        messagingEventId: result.eventId ?? null,
        error: result.error ?? null
      }
    });
  }
  refreshTraceForSession(database, "session_messaging");
}

async function handleMessagingCommand(database: ReturnType<typeof initializeDatabase>, args: ParsedArgs, parts: string[]): Promise<void> {
  const store = new MessagingStore(database);
  const registry = new MessagingAdapterRegistry(store);
  registry.installDefaults();
  const gateway = createMessagingGateway(database, resolveFromInvocationCwd(args.workspace ?? database.getSetting<string>("workspacePath") ?? "."));
  const subcommand = parts[0] ?? "adapters";

  if (subcommand === "adapters") {
    const action = parts[1] ?? "list";
    if (action === "list") {
      printJson({ adapters: registry.list(parts.includes("--include-archived")) });
      return;
    }
    if (action === "show") {
      const adapter = resolveMessagingAdapter(store, registry, requireValue(parts[2], "Adapter ID is required."));
      printJson({ adapter });
      return;
    }
    if (action === "install") {
      printJson({ adapter: registry.installFromFile(resolveFromInvocationCwd(requireValue(parts[2], "Adapter manifest path is required."))) });
      return;
    }
    if (action === "enable") {
      const adapter = resolveMessagingAdapter(store, registry, requireValue(parts[2], "Adapter ID is required."));
      if (!adapter) {
        throw new Error(`Adapter not found: ${parts[2]}`);
      }
      printJson({ adapter: registry.enable(adapter.id) });
      return;
    }
    if (action === "disable") {
      const adapter = resolveMessagingAdapter(store, registry, requireValue(parts[2], "Adapter ID is required."));
      if (!adapter) {
        throw new Error(`Adapter not found: ${parts[2]}`);
      }
      printJson({ adapter: registry.disable(adapter.id) });
      return;
    }
    if (action === "test") {
      const adapter = resolveMessagingAdapter(store, registry, requireValue(parts[2], "Adapter ID is required."));
      if (!adapter) {
        throw new Error(`Adapter not found: ${parts[2]}`);
      }
      printJson({ ok: adapter.status !== "archived", adapter });
      return;
    }
  }

  if (subcommand === "matrix") {
    const platform = parts[1];
    printJson(platform ? { platform: getPlatformMatrixEntry(platform) } : { matrix: listPlatformMatrix() });
    return;
  }

  if (subcommand === "configure") {
    const platform = requireValue(parts[1], "Platform is required.");
    const entries = collectKeyValueFlags(parts.slice(2));
    for (const [key, value] of Object.entries(entries)) {
      database.setSetting(`messaging.${platform}.${key}`, value);
    }
    printJson({ platform, configured: Object.keys(entries), redacted: true });
    return;
  }

  if (subcommand === "channels") {
    const action = parts[1] ?? "list";
    if (action === "list") {
      printJson({ channels: store.listChannels(collectFlagValue(parts, "--platform")) });
      return;
    }
    if (action === "add") {
      const platform = requireValue(collectFlagValue(parts, "--platform"), "--platform is required") as MessagingPlatform;
      const adapter = store.getAdapterByPlatform(platform) ?? store.getAdapter(`adapter_${platform}`);
      if (!adapter) {
        throw new Error(`Adapter not installed for platform: ${platform}`);
      }
      const externalChannelId = requireValue(collectFlagValue(parts, "--external-channel"), "--external-channel is required");
      const channel = store.createChannel({
        adapterId: adapter.id,
        platform,
        externalChannelId,
        displayName: collectFlagValue(parts, "--name") ?? externalChannelId,
        channelType: normalizeChannelType(collectFlagValue(parts, "--type"), platform)
      });
      printJson({ channel });
      return;
    }
    if (action === "enable" || action === "disable" || action === "pause") {
      const channelId = requireValue(parts[2], "Channel ID is required.");
      const status = action === "enable" ? "active" : action === "pause" ? "paused" : "disabled";
      printJson({ channel: store.updateChannelStatus(channelId, status) });
      return;
    }
  }

  if (subcommand === "allowlist") {
    const action = parts[1] ?? "list";
    if (action === "list") {
      printJson({ rules: store.listAllowlistRules(collectFlagValue(parts, "--platform")) });
      return;
    }
    if (action === "add-user") {
      printJson({
        rule: store.createAllowlistRule({
          platform: requireValue(collectFlagValue(parts, "--platform"), "--platform is required"),
          externalUserId: requireValue(collectFlagValue(parts, "--external-user"), "--external-user is required"),
          externalChannelId: collectFlagValue(parts, "--external-channel") ?? null,
          ruleType: "allowUser",
          riskLimit: normalizeRisk(collectFlagValue(parts, "--risk-limit"))
        })
      });
      return;
    }
    if (action === "add-channel") {
      printJson({
        rule: store.createAllowlistRule({
          platform: requireValue(collectFlagValue(parts, "--platform"), "--platform is required"),
          externalChannelId: requireValue(collectFlagValue(parts, "--external-channel"), "--external-channel is required"),
          ruleType: "allowChannel",
          riskLimit: normalizeRisk(collectFlagValue(parts, "--risk-limit"))
        })
      });
      return;
    }
    if (action === "remove") {
      printJson({ removed: store.removeAllowlistRule(requireValue(parts[2], "Rule ID is required.")) });
      return;
    }
  }

  if (subcommand === "fixture") {
    const action = parts[1];
    if (action !== "send") {
      throw new Error("Usage: npm run messaging -- fixture send ./fixtures/messaging/slack/inbound-message.json");
    }
    const fixturePath = resolveFromInvocationCwd(requireValue(parts[2], "Fixture path is required."));
    const raw = loadFixturePayload(fixturePath);
    const platform = inferFixturePlatform(raw);
    const adapter = store.getAdapterByPlatform(platform) ?? store.getAdapter(`adapter_${platform}`);
    if (!adapter) {
      throw new Error(`Adapter not installed for fixture platform: ${platform}`);
    }
    const normalized = await gateway.ingest(raw, adapter.id);
    maybeTrustFixture(store, raw, normalized);
    const route = await gateway.route(normalized);
    printJson({ event: normalized, route });
    return;
  }

  if (subcommand === "send") {
    const channelId = requireValue(collectFlagValue(parts, "--channel"), "--channel is required");
    const text = requireValue(collectFlagValue(parts, "--text"), "--text is required");
    printJson({ delivery: await gateway.send({ channelId }, { text }) });
    return;
  }

  if (subcommand === "delivery") {
    const action = parts[1] ?? "list";
    const router = new DeliveryRouter(store);
    if (action === "list") {
      printJson({ rules: router.listRules(collectFlagValue(parts, "--trigger")) });
      return;
    }
    if (action === "add") {
      const channelId = requireValue(collectFlagValue(parts, "--channel"), "--channel is required");
      const triggerType = requireValue(collectFlagValue(parts, "--trigger"), "--trigger is required") as Parameters<DeliveryRouter["addRule"]>[0]["triggerType"];
      printJson({ rule: router.addRule({ name: collectFlagValue(parts, "--name") ?? `${triggerType} delivery`, triggerType, targetChannelId: channelId }) });
      return;
    }
    if (action === "remove") {
      printJson({ removed: router.removeRule(requireValue(parts[2], "Delivery rule ID is required.")) });
      return;
    }
    if (action === "enable" || action === "disable") {
      printJson({ rule: router.setRuleEnabled(requireValue(parts[2], "Delivery rule ID is required."), action === "enable") });
      return;
    }
  }

  if (subcommand === "inbox") {
    printJson({ events: store.listEvents({ platform: collectFlagValue(parts, "--platform"), runId: collectFlagValue(parts, "--run"), limit: collectFlagNumber(parts, "--limit") ?? 100 }) });
    return;
  }

  if (subcommand === "sessions") {
    const action = parts[1] ?? "list";
    if (action === "list") {
      printJson({ sessions: store.listSessions(collectFlagValue(parts, "--platform")) });
      return;
    }
    if (action === "show") {
      const sessionId = requireValue(parts[2], "Session ID is required.");
      printJson({ session: store.getSession(sessionId), events: store.listEvents({ limit: 25 }).filter((event) => event.sessionId === sessionId) });
      return;
    }
    printJson({ sessions: store.listSessions(collectFlagValue(parts, "--platform")) });
    return;
  }

  if (subcommand === "identities") {
    const action = parts[1] ?? "list";
    if (action === "list") {
      printJson({ identities: store.listIdentities(collectFlagValue(parts, "--platform")) });
      return;
    }
    if (action === "link") {
      const platform = requireValue(collectFlagValue(parts, "--platform"), "--platform is required");
      const externalUserId = requireValue(collectFlagValue(parts, "--external-user"), "--external-user is required");
      const identity = store.upsertIdentity({ platform, externalUserId, trustLevel: "trusted", metadata: { linkedViaCli: true, localUserId: collectFlagValue(parts, "--local-user") ?? "local" } });
      printJson({ identity });
      return;
    }
  }

  if (subcommand === "webhook") {
    const action = parts[1] ?? "serve";
    if (action === "serve") {
      const port = collectFlagNumber(parts, "--port") ?? 8787;
      const platform = (collectFlagValue(parts, "--platform") ?? "slack") as MessagingPlatform;
      const adapter = store.getAdapterByPlatform(platform) ?? store.getAdapter(`adapter_${platform}`);
      if (!adapter) {
        throw new Error(`Adapter not installed for platform: ${platform}. Run: npm run messaging -- adapters list`);
      }
      const signingSecret =
        database.getSetting<string>(`messaging.${platform}.signingSecret`) ?? process.env.SLACK_SIGNING_SECRET;
      if (!signingSecret || !signingSecret.trim()) {
        throw new Error(
          `Messaging webhook requires a signing secret. Set messaging.${platform}.signingSecret (settings) or SLACK_SIGNING_SECRET (env).`
        );
      }
      const { ready, close } = startSlackWebhookServer({
        port,
        signingSecret,
        onPayload: async (payload) => {
          const events = unwrapSlackWebhookPayloads(payload);
          for (const event of events) {
            const normalized = await gateway.ingest(event, adapter.id);
            await gateway.route(normalized);
          }
        }
      });
      const { url } = await ready;
      console.log(`Messaging webhook listening at ${url}`);
      console.log(`Platform: ${platform} · adapter: ${adapter.id}`);
      console.log("Press Ctrl+C to stop.");
      await new Promise<void>((resolve) => {
        const shutdown = () => {
          void close().then(resolve);
        };
        process.once("SIGINT", shutdown);
        process.once("SIGTERM", shutdown);
      });
      return;
    }
  }

  throw new Error("Usage: npm run messaging -- adapters|matrix|configure|channels|allowlist|fixture|send|delivery|inbox|sessions|identities|webhook serve [--port 8787] [--platform slack]");
}

async function handleGovernanceCommand(database: ReturnType<typeof initializeDatabase>, parts: string[]): Promise<void> {
  const governance = new GovernanceEngine(database, undefined, cliVaultKeyFile);
  const subcommand = parts[0] ?? "status";

  if (subcommand === "bootstrap") {
    const result = governance.bootstrap();
    database.appendEvent({
      id: createId("evt"),
      timestamp: new Date().toISOString(),
      sessionId: "session_governance",
      type: "governance.bootstrap.completed",
      data: { runId: "run_governance", ...result }
    });
    refreshTraceForSession(database, "session_governance");
    printJson(result);
    return;
  }

  if (subcommand === "status") {
    governance.identities.bootstrap();
    printJson(governance.status());
    return;
  }

  if (subcommand === "user") {
    const action = parts[1] ?? "list";
    governance.identities.bootstrap();
    if (action === "create") {
      const user = governance.identities.createUser({
        username: requireValue(collectFlagValue(parts, "--username"), "--username is required"),
        email: collectFlagValue(parts, "--email") ?? null,
        tenantId: collectFlagValue(parts, "--tenant") ?? DEFAULT_TENANT_ID,
        displayName: collectFlagValue(parts, "--display-name") ?? null
      });
      governance.audit.append({
        actorType: "user",
        actorId: DEFAULT_ADMIN_USER_ID,
        action: "governance.user.create",
        resourceType: "user",
        resourceId: user.id,
        outcome: "created",
        detail: { username: user.username, email: user.email }
      });
      printJson({ user });
      return;
    }
    if (action === "show") {
      printJson({ user: governance.identities.getUser(requireValue(parts[2], "User ID is required.")) });
      return;
    }
    if (action === "disable") {
      printJson({ user: governance.identities.disableUser(requireValue(parts[2], "User ID is required.")) });
      return;
    }
    printJson({ users: governance.identities.listUsers(collectFlagValue(parts, "--tenant") ?? DEFAULT_TENANT_ID) });
    return;
  }

  if (subcommand === "role") {
    const action = parts[1] ?? "list";
    governance.identities.bootstrap();
    if (action === "show") {
      printJson({ role: governance.identities.getRole(requireValue(parts[2], "Role name or ID is required.")) });
      return;
    }
    if (action === "assign") {
      const userId = requireValue(collectFlagValue(parts, "--user"), "--user is required");
      const roleName = requireValue(collectFlagValue(parts, "--role"), "--role is required");
      const scope = collectFlagValue(parts, "--scope") ?? `tenant:${DEFAULT_TENANT_ID}`;
      const [scopeType = "tenant", scopeId = DEFAULT_TENANT_ID] = scope.split(":");
      printJson({
        assignment: governance.identities.assignRole({
          principalType: "user",
          principalId: userId,
          roleName,
          scopeType,
          scopeId
        })
      });
      return;
    }
    if (action === "assignments") {
      const userId = requireValue(collectFlagValue(parts, "--user") ?? parts[2], "User ID is required.");
      printJson({ assignments: governance.identities.listAssignmentsForPrincipal("user", userId) });
      return;
    }
    printJson({ roles: governance.identities.listRoles() });
    return;
  }

  if (subcommand === "policy") {
    const action = parts[1] ?? "decisions";
    governance.identities.bootstrap();
    if (action === "simulate") {
      const actorId = requireValue(collectFlagValue(parts, "--user") ?? collectFlagValue(parts, "--service-account") ?? DEFAULT_ADMIN_USER_ID, "--user is required");
      const actorType: "serviceAccount" | "user" = collectFlagValue(parts, "--service-account") ? "serviceAccount" : "user";
      const actionName = requireValue(collectFlagValue(parts, "--action"), "--action is required");
      const resource = requireValue(collectFlagValue(parts, "--resource"), "--resource is required");
      const [resourceType = "resource", resourceId = resource] = resource.split(":");
      const decision = governance.decide({
        actor: { type: actorType, id: actorId },
        action: actionName,
        resource: { type: resourceType, id: resourceId },
        context: {
          source: "cli",
          riskLevel: collectFlagValue(parts, "--risk") ?? "low",
          modelProvider: collectFlagValue(parts, "--model-provider"),
          dataClassification: collectFlagValue(parts, "--classification")
        }
      });
      printJson({ decision });
      return;
    }
    if (action === "packs") {
      printJson({ packs: policyPacks });
      return;
    }
    if (action === "pack") {
      const packAction = parts[2] ?? "list";
      if (packAction === "show") {
        const packId = requireValue(parts[3], "Policy pack ID is required.");
        printJson({ pack: policyPacks.find((pack) => pack.id === packId) ?? null });
        return;
      }
      if (packAction === "enable") {
        const packId = requireValue(parts[3], "Policy pack ID is required.");
        const pack = policyPacks.find((entry) => entry.id === packId);
        if (!pack) {
          throw new Error(`Policy pack not found: ${packId}`);
        }
        database.setSetting(`governance.policyPack.${packId}`, { enabled: true, tenantId: collectFlagValue(parts, "--tenant") ?? DEFAULT_TENANT_ID });
        governance.audit.append({
          actorType: "user",
          actorId: DEFAULT_ADMIN_USER_ID,
          action: "governance.policyPack.enable",
          resourceType: "policyPack",
          resourceId: packId,
          outcome: "enabled",
          detail: pack
        });
        printJson({ enabled: pack });
        return;
      }
      printJson({ packs: policyPacks });
      return;
    }
    printJson({ decisions: governance.policies.listDecisions(collectFlagNumber(parts, "--latest") ?? collectFlagNumber(parts, "--limit") ?? 20) });
    return;
  }

  if (subcommand === "secrets") {
    const action = parts[1] ?? "list";
    governance.identities.bootstrap();
    if (action === "providers") {
      printJson({ providers: governance.secrets.providers() });
      return;
    }
    if (action === "set") {
      const name = requireValue(parts[3] ?? parts[2], "Usage: npm run governance -- secrets set local <name> --value <value>");
      const value = requireValue(collectFlagValue(parts, "--value"), "--value is required");
      const reference = governance.secrets.setSecret(name, value);
      governance.audit.append({
        actorType: "user",
        actorId: DEFAULT_ADMIN_USER_ID,
        action: "secret.set",
        resourceType: "secret",
        resourceId: reference.id,
        outcome: "stored",
        detail: { name, value: "[redacted]" }
      });
      printJson({ secret: reference });
      return;
    }
    if (action === "get") {
      const name = requireValue(parts[2], "Secret name is required.");
      const reveal = parts.includes("--reveal");
      const result = governance.secrets.getSecret(name, { reveal });
      governance.auditSecretRead(name, reveal);
      printJson(result);
      return;
    }
    if (action === "rotate") {
      const name = requireValue(parts[2], "Secret name is required.");
      const value = requireValue(collectFlagValue(parts, "--value"), "--value is required");
      printJson({ secret: governance.secrets.setSecret(name, value, { rotate: true }) });
      return;
    }
    printJson({ secrets: governance.secrets.listSecrets() });
    return;
  }

  if (subcommand === "audit") {
    const action = parts[1] ?? "latest";
    governance.identities.bootstrap();
    if (action === "latest") {
      printJson({ entries: governance.audit.latest(collectFlagNumber(parts, "--limit") ?? 20) });
      return;
    }
    if (action === "export") {
      const format = collectFlagValue(parts, "--format") === "csv" ? "csv" : "jsonl";
      const out = resolveFromInvocationCwd(collectFlagValue(parts, "--out") ?? `out/audit.${format === "csv" ? "csv" : "jsonl"}`);
      const exporter = new AuditExporter(governance.audit);
      const result = format === "csv" ? exporter.exportCsv(out) : exporter.exportJsonl(out);
      governance.audit.append({
        actorType: "user",
        actorId: DEFAULT_ADMIN_USER_ID,
        action: "audit.export",
        resourceType: "audit",
        resourceId: result.path,
        outcome: "exported",
        detail: result
      });
      printJson(result);
      return;
    }
    if (action === "verify") {
      const file = resolveFromInvocationCwd(requireValue(parts[2], "Audit export path is required."));
      printJson(new AuditExporter(governance.audit).verifyJsonl(file));
      return;
    }
  }

  if (subcommand === "retention") {
    const action = parts[1] ?? "policies";
    governance.identities.bootstrap();
    if (action === "policies") {
      printJson({ policies: governance.retention.listPolicies() });
      return;
    }
    if (action === "policy" && parts[2] === "create") {
      printJson({
        policy: governance.retention.createPolicy({
          name: requireValue(collectFlagValue(parts, "--name"), "--name is required"),
          resourceType: requireValue(collectFlagValue(parts, "--resource"), "--resource is required"),
          dataClassification: collectFlagValue(parts, "--classification") ?? "internal",
          retentionDays: collectFlagNumber(parts, "--days") ?? 180,
          action: (collectFlagValue(parts, "--action") as "keep" | "archive" | "anonymize" | "delete" | undefined) ?? "archive"
        })
      });
      return;
    }
    if (action === "dry-run") {
      printJson({ results: governance.retention.dryRun() });
      return;
    }
    if (action === "apply") {
      const confirm = parts.includes("--confirm");
      if (!confirm) {
        printJson({
          ...governance.retention.apply({ confirm: false }),
          note: "Dry-run only. Pass --confirm to actually delete or archive matching rows."
        });
        return;
      }
      printJson(governance.retention.apply({ confirm: true }));
      return;
    }
  }

  if (subcommand === "legal-hold") {
    const action = parts[1] ?? "list";
    governance.identities.bootstrap();
    if (action === "create") {
      printJson({
        hold: governance.retention.createLegalHold({
          name: requireValue(collectFlagValue(parts, "--name"), "--name is required"),
          description: collectFlagValue(parts, "--description"),
          selector: collectFlagValue(parts, "--selector") ? JSON.parse(collectFlagValue(parts, "--selector")!) : {}
        })
      });
      return;
    }
    if (action === "release") {
      printJson({ hold: governance.retention.releaseLegalHold(requireValue(parts[2], "Legal hold ID is required.")) });
      return;
    }
    printJson({ holds: governance.retention.listLegalHolds() });
    return;
  }

  if (subcommand === "lineage") {
    const action = parts[1] ?? "show";
    governance.identities.bootstrap();
    if (action === "show") {
      const runId = requireValue(collectFlagValue(parts, "--run") ?? parts[2], "Run ID is required.");
      if (governance.lineage.listForRun(runId).length === 0) {
        governance.seedExampleLineage(runId);
      }
      printJson({ edges: governance.lineage.listForRun(runId) });
      return;
    }
    if (action === "export") {
      const runId = requireValue(collectFlagValue(parts, "--run"), "--run is required");
      if (governance.lineage.listForRun(runId).length === 0) {
        governance.seedExampleLineage(runId);
      }
      const outPath = resolveFromInvocationCwd(collectFlagValue(parts, "--out") ?? `out/lineage-${runId}.json`);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, `${JSON.stringify({ runId, edges: governance.lineage.listForRun(runId) }, null, 2)}\n`, "utf8");
      printJson({ runId, path: outPath });
      return;
    }
  }

  if (subcommand === "n8n") {
    await handleGovernanceN8nCommand(governance, parts.slice(1));
    return;
  }

  if (subcommand === "highstakes") {
    printJson({
      tenantId: DEFAULT_TENANT_ID,
      enabledPacks: policyPacks.filter((pack) => database.getSetting(`governance.policyPack.${pack.id}`)),
      availablePacks: policyPacks
    });
    return;
  }

  if (subcommand === "rai") {
    const suite = collectFlagValue(parts, "--suite") ?? "prompt-injection-basic";
    const suites = [
      "prompt-injection-basic",
      "tool-injection-basic",
      "connector-secret-leak-basic",
      "messaging-approval-bypass-basic",
      "n8n-approval-bypass-basic",
      "memory-poisoning-basic",
      "paid-provider-bypass-basic"
    ];
    if (parts[1] === "redteam" && parts[2] === "list") {
      printJson({ suites });
      return;
    }
    if (parts[1] === "redteam" && parts[2] === "run") {
      const decision = governance.decide({
        actor: { type: "serviceAccount", id: "service_redteam" },
        action: suite.includes("paid-provider") ? "model.call" : "sandbox.promote",
        resource: { type: "redteam", id: suite },
        context: { source: "rai", riskLevel: "high", modelProvider: suite.includes("paid-provider") ? "api" : "mock" }
      });
      printJson({ suite, passed: decision.decision !== "allow", decision });
      return;
    }
  }

  throw new Error("Usage: npm run governance -- bootstrap|status|user|role|policy|secrets|audit|retention|legal-hold|lineage|n8n|highstakes|rai");
}

async function handleGovernanceN8nCommand(governance: GovernanceEngine, parts: string[]): Promise<void> {
  const subcommand = parts[0] ?? "integrations";
  if (subcommand === "integrations" || subcommand === "integration") {
    const action = parts[1] ?? "list";
    if (action === "list") {
      printJson({ integrations: governance.n8n.listIntegrations() });
      return;
    }
    if (action === "create") {
      printJson({
        integration: governance.n8n.createIntegration({
          name: requireValue(collectFlagValue(parts, "--name"), "--name is required"),
          direction: (collectFlagValue(parts, "--direction") as "inbound" | "outbound" | undefined) ?? "outbound",
          events: (collectFlagValue(parts, "--events") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
          actions: (collectFlagValue(parts, "--actions") ?? "audit.request").split(",").map((value) => value.trim()).filter(Boolean)
        })
      });
      return;
    }
    if (action === "enable") {
      printJson({ integration: governance.n8n.enableIntegration(requireValue(parts[2], "Integration ID is required."), true) });
      return;
    }
    if (action === "test") {
      printJson(governance.n8n.testIntegration(requireValue(parts[2], "Integration ID is required.")));
      return;
    }
  }
  if (subcommand === "events") {
    printJson({ events: governance.n8n.listEvents(collectFlagNumber(parts, "--latest") ?? 20) });
    return;
  }
  if (subcommand === "templates") {
    const action = parts[1] ?? "list";
    if (action === "list") {
      printJson({ templates: governance.n8n.templates() });
      return;
    }
    if (action === "export") {
      const name = requireValue(parts[2], "Template name is required.");
      const outPath = resolveFromInvocationCwd(collectFlagValue(parts, "--out") ?? `out/${name}.json`);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, `${JSON.stringify({ name, nodes: [], note: "Fixture n8n template generated locally by SquidBot." }, null, 2)}\n`, "utf8");
      printJson({ template: name, path: outPath });
      return;
    }
  }
  if (subcommand === "fixture" && parts[1] === "receive") {
    printJson(governance.n8n.receiveFixture(resolveFromInvocationCwd(requireValue(parts[2], "Fixture path is required."))));
    return;
  }
  throw new Error("Usage: npm run governance -- n8n integrations|integration|events|templates|fixture");
}

function createToolRegistryForReporting(): ToolRegistry {
  const registry = new ToolRegistry();
  registerWorkspaceTools(registry);
  registerTerminalTools(registry);
  registerTestTools(registry);
  return registry;
}

async function handleTrustCommand(
  database: ReturnType<typeof initializeDatabase>,
  parts: string[]
): Promise<void> {
  const subcommand = parts[0] ?? "summary";
  installSeedProfiles(database);
  const toolRegistry = createToolRegistryForReporting();
  const identityReport = buildIdentityReport(database, toolRegistry);
  const report = buildTrustReport({ database, identityReport });

  if (subcommand === "summary") {
    if (parts.includes("--json")) {
      printJson({ summary: summarizeTrustReport(report) });
    } else {
      console.log(summarizeTrustReport(report));
    }
    return;
  }

  if (subcommand === "report") {
    if (parts.includes("--json")) {
      printJson(report);
      return;
    }
    console.log(formatTrustReportMarkdown(report));
    return;
  }

  if (subcommand === "digest") {
    const digest = digestTrustReport(report);
    if (parts.includes("--json")) {
      printJson(digest);
    } else {
      console.log(`${digest.agentName} v${digest.agentVersion}`);
      console.log(`Profile: ${digest.profile ?? "(none)"}`);
      console.log(`Health: ${digest.healthLabel} (${digest.healthScore}/100)`);
      console.log(`Audit chain valid: ${digest.auditChainValid ? "yes" : "NO"}`);
      console.log(`Schema: ${digest.schemaVersion}`);
      console.log(`Hash: ${digest.hash}`);
      console.log(`Generated: ${digest.generatedAt}`);
    }
    return;
  }

  if (subcommand === "packet") {
    const framework = (collectFlagValue(parts, "--framework") ?? "soc2") as ComplianceFramework;
    const supportedFrameworks: ComplianceFramework[] = ["soc2", "gdpr", "hipaa", "pci_dss", "iso27001"];
    if (!supportedFrameworks.includes(framework)) {
      throw new Error("--framework must be one of: soc2, gdpr, hipaa, pci_dss, iso27001");
    }
    const packet = buildCompliancePacket({ database, trustReport: report, framework });
    const outputPath = collectFlagValue(parts, "--out");
    if (outputPath) {
      const resolved = resolveFromInvocationCwd(outputPath);
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, packet.markdown, "utf8");
      console.log(`Wrote ${framework.toUpperCase()} compliance packet to ${resolved}`);
      console.log(`Digest: ${packet.digest}`);
      return;
    }
    if (parts.includes("--json")) {
      printJson(packet);
      return;
    }
    console.log(packet.markdown);
    console.log(`\n---\nDigest: ${packet.digest}`);
    return;
  }

  throw new Error(
    "Usage: npm run trust -- summary | report | digest | packet --framework=soc2|gdpr [--out path] [--json]"
  );
}

async function handleProfileCommand(
  database: ReturnType<typeof initializeDatabase>,
  parts: string[]
): Promise<void> {
  const subcommand = parts[0] ?? "list";

  if (subcommand === "seed") {
    const installed = installSeedProfiles(database);
    console.log(`Installed ${installed.length} seed profile(s):`);
    for (const profile of installed) {
      console.log(`- ${profile.id} ${profile.displayName} (${profile.industry}, sensitivity=${profile.sensitivity})`);
    }
    return;
  }

  if (subcommand === "list") {
    installSeedProfiles(database);
    const profiles = listProfiles(database);
    if (parts.includes("--json")) {
      printJson({ profiles });
      return;
    }
    const active = getActiveProfile(database);
    console.log("Enterprise profiles:");
    for (const profile of profiles) {
      const marker = profile.isActive ? "*" : " ";
      console.log(
        `${marker} ${profile.id}  ${profile.displayName}  (${profile.industry}, sensitivity=${profile.sensitivity}${profile.readOnlyByDefault ? ", read-only" : ""})`
      );
    }
    if (active) {
      console.log("");
      console.log(`Active profile: ${active.displayName} (${active.id})`);
    } else {
      console.log("");
      console.log("No active profile. Use: npm run profile -- activate <profile-id>");
    }
    return;
  }

  if (subcommand === "current") {
    const active = getActiveProfile(database);
    if (parts.includes("--json")) {
      printJson({ profile: active });
      return;
    }
    if (!active) {
      console.log("No active enterprise profile. Run: npm run profile -- activate <profile-id>");
      return;
    }
    console.log(`${active.displayName}  (${active.id})`);
    console.log(`Industry: ${active.industry}`);
    console.log(`Sensitivity: ${active.sensitivity}`);
    console.log(`Read-only by default: ${active.readOnlyByDefault ? "yes" : "no"}`);
    console.log(`Policy packs: ${active.policyPacks.join(", ") || "(none)"}`);
    console.log(`Default skills: ${active.defaultSkills.join(", ") || "(none)"}`);
    console.log(`Default connectors: ${active.defaultConnectors.join(", ") || "(none)"}`);
    return;
  }

  if (subcommand === "activate") {
    installSeedProfiles(database);
    const profileId = parts[1];
    if (!profileId) {
      throw new Error("Usage: npm run profile -- activate <profile-id>");
    }
    const profile = activateProfile(database, profileId);
    console.log(`Activated profile: ${profile.displayName} (${profile.id})`);
    return;
  }

  if (subcommand === "create") {
    const name = collectFlagValue(parts, "--name");
    if (!name) {
      throw new Error(
        "Usage: npm run profile -- create --name \"<display name>\" [--industry general_business] [--role operator] [--sensitivity standard|sensitive|regulated|air-gapped] [--read-only] [--activate] [--vocab from=to,from=to]"
      );
    }
    const industry = collectFlagValue(parts, "--industry") ?? "general_business";
    const role = collectFlagValue(parts, "--role") ?? null;
    const sensitivityRaw = collectFlagValue(parts, "--sensitivity") ?? "standard";
    const validSensitivities = ["standard", "sensitive", "regulated", "air-gapped"];
    if (!validSensitivities.includes(sensitivityRaw)) {
      throw new Error(`--sensitivity must be one of ${validSensitivities.join(", ")}`);
    }
    const readOnly = parts.includes("--read-only");
    const activate = parts.includes("--activate");
    const vocabRaw = collectFlagValue(parts, "--vocab");
    const vocabulary: Record<string, string> = {};
    if (vocabRaw) {
      for (const pair of vocabRaw.split(",")) {
        const [from, to] = pair.split("=").map((s) => s.trim());
        if (from && to) vocabulary[from] = to;
      }
    }
    const primarySystems = (collectFlagValue(parts, "--systems") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const primaryChannels = (collectFlagValue(parts, "--channels") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const profile = createCustomProfile(database, {
      industry,
      displayName: name,
      businessUnit: null,
      role,
      primarySystems,
      primaryChannels,
      sensitivity: sensitivityRaw as "standard" | "sensitive" | "regulated" | "air-gapped",
      vocabulary,
      branding: { productName: `SquidBot for ${name}` },
      policyPacks: ["developer-safe-default", "secrets-redaction"],
      defaultSkills: [],
      defaultConnectors: [],
      readOnlyByDefault: readOnly,
      metadata: {
        customCreated: true,
        createdVia: "cli"
      },
      activate
    });

    if (parts.includes("--json")) {
      printJson({ profile });
      return;
    }
    console.log(`Created custom profile: ${profile.displayName} (${profile.id})`);
    console.log(`  Industry: ${profile.industry}`);
    console.log(`  Sensitivity: ${profile.sensitivity}`);
    console.log(`  Read-only by default: ${profile.readOnlyByDefault ? "yes" : "no"}`);
    if (profile.isActive) {
      console.log(`  Status: ACTIVE`);
    } else {
      console.log(`  Activate with: npm run profile -- activate ${profile.id}`);
    }
    return;
  }

  throw new Error(
    "Usage: npm run profile -- list | current | activate <profile-id> | create --name \"<name>\" [flags] | seed [--json]"
  );
}

/**
 * AI-assisted onboarding wizard. Runs a short interview, infers an enterprise
 * profile + memories from the answers, and offers to save & activate them.
 *
 * Modes:
 *   - default (interactive): prompts the operator via readline.
 *   - --answers <path>: reads pre-canned answers from a JSON file, no prompts.
 *                       Used by automated tests and scripted partner setups.
 *   - --yes: skip the final "save & activate?" confirmation.
 *   - --no-activate: save the inferred profile but leave the active profile alone.
 *   - --dry-run: show what would be created, write nothing.
 *   - --json: emit the inference (and committed records, if not dry-run) as JSON.
 */
async function handleOnboardingCommand(
  database: ReturnType<typeof initializeDatabase>,
  parts: string[]
): Promise<void> {
  installSeedProfiles(database);

  const answersPath = collectFlagValue(parts, "--answers");
  const skipConfirm = parts.includes("--yes") || parts.includes("-y");
  const activate = !parts.includes("--no-activate");
  const dryRun = parts.includes("--dry-run");
  const asJson = parts.includes("--json");

  let answers: OnboardingAnswer[];

  if (answersPath) {
    answers = loadOnboardingAnswers(resolveFromInvocationCwd(answersPath));
  } else {
    answers = await runInteractiveOnboarding(STANDARD_QUESTIONS);
  }

  const inference = inferOnboardingProfile(answers);

  if (asJson && dryRun) {
    printJson({ mode: "dry-run", answers, inference });
    return;
  }

  if (!asJson) {
    console.log(formatOnboardingSummary(inference));
  }

  if (dryRun) {
    if (!asJson) {
      console.log("");
      console.log("(dry-run) Nothing was saved. Re-run without --dry-run to commit.");
    }
    return;
  }

  // Confirmation step for interactive sessions only.
  if (!answersPath && !skipConfirm) {
    const confirmed = await promptYesNo(
      "\nSave this profile and activate it? [Y/n] ",
      true
    );
    if (!confirmed) {
      console.log("Skipped. Nothing was saved.");
      return;
    }
  }

  const committed = commitOnboarding(database, inference, { activate });

  if (asJson) {
    printJson({ inference, committed });
    return;
  }

  console.log("");
  console.log(`✓ Created profile: ${committed.profile.displayName}  (${committed.profile.id})`);
  console.log(`  Status: ${committed.profile.isActive ? "ACTIVE" : "saved (not active)"}`);
  console.log(`  Memory entries written: ${committed.memories.length}`);
  console.log(`  Provenance run id: ${committed.syntheticRunId}`);
  console.log(formatNextActions(inference));
}

function loadOnboardingAnswers(filePath: string): OnboardingAnswer[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`--answers file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as { answers?: OnboardingAnswer[] } | OnboardingAnswer[];
  const list = Array.isArray(parsed) ? parsed : parsed.answers;
  if (!Array.isArray(list)) {
    throw new Error(
      `--answers file must contain a JSON array of {questionId, rawValue, skipped} or {"answers": [...]}.`
    );
  }
  return list.map((entry) => ({
    questionId: String(entry.questionId ?? ""),
    rawValue: String(entry.rawValue ?? ""),
    skipped: Boolean(entry.skipped)
  }));
}

async function runInteractiveOnboarding(questions: OnboardingQuestion[]): Promise<OnboardingAnswer[]> {
  const rl = readline.createInterface({ input, output });
  const collected: OnboardingAnswer[] = [];
  const total = questions.length;

  try {
    output.write("\n");
    output.write("Welcome to SquidBot. I'll ask a few short questions so I can adapt to your business.\n");
    output.write("This takes ~3 minutes. Type 'skip' on any optional question, or press Ctrl-C to abort.\n");
    output.write("\n");

    for (let index = 0; index < questions.length; index += 1) {
      const question = questions[index];
      const required = question.required === true;
      output.write(`Q${index + 1}/${total} — ${question.prompt}\n`);
      if (question.hint) output.write(`         ${question.hint}\n`);

      if (question.kind === "choice" && question.choices) {
        for (let choiceIndex = 0; choiceIndex < question.choices.length; choiceIndex += 1) {
          const choice = question.choices[choiceIndex];
          const desc = choice.description ? ` — ${choice.description}` : "";
          output.write(`  ${choiceIndex + 1}) ${choice.label}${desc}\n`);
        }
      }

      while (true) {
        const raw = await rl.question("> ");
        const trimmed = (raw ?? "").trim();

        if (trimmed.toLowerCase() === "skip" || trimmed === "") {
          if (required) {
            output.write(`   (This one is required — please answer.)\n`);
            continue;
          }
          collected.push({ questionId: question.id, rawValue: "", skipped: true });
          break;
        }

        let normalisedValue = trimmed;
        if (question.kind === "choice" && question.choices) {
          // Accept 1-based index OR the choice value/label directly (case-insensitive).
          const numericChoice = Number(trimmed);
          if (Number.isFinite(numericChoice) && numericChoice >= 1 && numericChoice <= question.choices.length) {
            normalisedValue = question.choices[Math.floor(numericChoice) - 1].value;
          } else {
            const match = question.choices.find(
              (choice) =>
                choice.value.toLowerCase() === trimmed.toLowerCase() ||
                choice.label.toLowerCase() === trimmed.toLowerCase()
            );
            if (!match) {
              output.write(`   (Pick one: ${question.choices.map((choice) => choice.value).join(", ")} or 1–${question.choices.length}.)\n`);
              continue;
            }
            normalisedValue = match.value;
          }
        }

        collected.push({ questionId: question.id, rawValue: normalisedValue, skipped: false });
        if (question.echoTemplate) {
          const echo = question.echoTemplate(normalisedValue);
          if (echo) output.write(`   ↳ ${echo}\n`);
        }
        break;
      }
      output.write("\n");
    }
  } finally {
    rl.close();
  }

  return collected;
}

async function promptYesNo(prompt: string, defaultYes: boolean): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const raw = (await rl.question(prompt)).trim().toLowerCase();
    if (!raw) return defaultYes;
    if (raw === "y" || raw === "yes") return true;
    if (raw === "n" || raw === "no") return false;
    return defaultYes;
  } finally {
    rl.close();
  }
}

/**
 * Manage the model_accounts table from the CLI. Mirrors the same primitives
 * the desktop Settings UI and the in-chat tools use.
 *
 *   list                              — print every saved account (key redacted)
 *   add --name "..." [--preset ...]   — create + optionally activate
 *      [--url ...] [--model ...] [--key ...] [--budget-tokens ...]
 *      [--activate]
 *   use <name>                        — set active account
 *   remove <name>                     — delete
 *   test <name>                       — send a 1-token ping through the account
 *                                       and report success + cost
 *   presets                           — print provider presets (also at `model -- presets`)
 */
async function handleModelAccountsCommand(
  database: ReturnType<typeof initializeDatabase>,
  parts: string[]
): Promise<void> {
  // Always honour legacy settings on first use so operators who upgrade
  // don't suddenly see an empty list.
  ensureLegacyAccountMigrated(database, cliSecretCipher);

  const subcommand = parts[0] ?? "list";

  if (subcommand === "list" || subcommand === "ls") {
    const accounts = listModelAccounts(database, cliSecretCipher).map((account) => redactAccount(account));
    if (parts.includes("--json")) {
      printJson({ accounts });
      return;
    }
    if (accounts.length === 0) {
      console.log("No model accounts saved. Use: npm run model -- accounts add --name \"OR Gemini\" --preset openrouter --key sk-... --model google/gemini-2.0-flash-001 --activate");
      return;
    }
    console.log("Model accounts:");
    for (const account of accounts) {
      const marker = account.isActive ? "*" : " ";
      const key = account.apiKeyConfigured ? "key set" : "no key";
      console.log(`${marker} ${account.name}  (${account.providerKind}, ${account.apiModel}, ${key})`);
      console.log(`    url: ${account.apiUrl}`);
      if (account.description) console.log(`    note: ${account.description}`);
    }
    return;
  }

  if (subcommand === "presets") {
    if (parts.includes("--json")) {
      printJson({ presets: PROVIDER_PRESETS });
      return;
    }
    console.log("Provider presets:");
    for (const preset of PROVIDER_PRESETS) {
      console.log(`- ${preset.kind}  ${preset.displayName}`);
      console.log(`    URL: ${preset.defaultApiUrl || "(set per-account)"}`);
      if (preset.commonModels.length > 0) {
        console.log(`    Common models: ${preset.commonModels.slice(0, 4).map((model) => model.id).join(", ")}${preset.commonModels.length > 4 ? ", ..." : ""}`);
      }
    }
    return;
  }

  if (subcommand === "current" || subcommand === "active") {
    const active = getActiveModelAccount(database, cliSecretCipher);
    if (parts.includes("--json")) {
      printJson({ account: active ? redactAccount(active) : null });
      return;
    }
    if (!active) {
      console.log("No active model account. Use: npm run model -- accounts use <name>");
      return;
    }
    const redacted = redactAccount(active);
    console.log(`${redacted.name}  (${redacted.providerKind})`);
    console.log(`  URL: ${redacted.apiUrl}`);
    console.log(`  Model: ${redacted.apiModel}`);
    console.log(`  API key: ${redacted.apiKeyConfigured ? "set" : "(none)"}`);
    if (redacted.description) console.log(`  Note: ${redacted.description}`);
    return;
  }

  if (subcommand === "add" || subcommand === "create") {
    const name = collectFlagValue(parts, "--name");
    if (!name) {
      throw new Error(
        `Usage: npm run model -- accounts add --name "<name>" --preset <openrouter|openai|groq|together|ollama|custom> [--url URL] [--model MODEL_ID] [--key KEY] [--budget-tokens N] [--description "..."] [--activate]`
      );
    }
    const presetSlug = (collectFlagValue(parts, "--preset") ?? "custom") as ProviderKind;
    if (!PROVIDER_PRESETS.some((entry) => entry.kind === presetSlug)) {
      throw new Error(`Unknown preset "${presetSlug}". Run: npm run model -- presets`);
    }
    const preset = getProviderPreset(presetSlug);
    const apiUrl = collectFlagValue(parts, "--url") ?? preset.defaultApiUrl;
    const apiKey = collectFlagValue(parts, "--key") ?? null;
    const apiModel = collectFlagValue(parts, "--model") ?? preset.commonModels[0]?.id ?? "";
    const budgetRaw = collectFlagValue(parts, "--budget-tokens");
    const dailyBudgetTokens = budgetRaw ? Number(budgetRaw) : undefined;
    const description = collectFlagValue(parts, "--description") ?? null;
    const activate = parts.includes("--activate");

    const input: ModelAccountInput = {
      name,
      providerKind: presetSlug,
      apiUrl,
      apiKey,
      apiModel,
      dailyBudgetTokens: dailyBudgetTokens === undefined ? undefined : (Number.isFinite(dailyBudgetTokens) ? dailyBudgetTokens : null),
      description,
      activate
    };

    const account = upsertModelAccount(database, input, cliSecretCipher);
    const redacted = redactAccount(account);
    if (parts.includes("--json")) {
      printJson({ account: redacted });
      return;
    }
    console.log(`Saved model account: ${redacted.name} (${redacted.providerKind})`);
    console.log(`  Model: ${redacted.apiModel}`);
    console.log(`  URL: ${redacted.apiUrl}`);
    console.log(`  API key: ${redacted.apiKeyConfigured ? "set" : "(none — required for paid providers)"}`);
    console.log(`  Status: ${redacted.isActive ? "ACTIVE" : "saved (not active)"}`);
    if (!redacted.isActive) {
      console.log(`  Activate with: npm run model -- accounts use ${redacted.name}`);
    }
    return;
  }

  // Account names commonly contain spaces ("OR Gemini") — join every trailing
  // positional arg into the name so the operator doesn't have to quote them
  // through both their shell AND the npm pass-through layer.
  const positionalName = parts
    .slice(1)
    .filter((part) => !part.startsWith("--"))
    .join(" ")
    .trim();

  if (subcommand === "use" || subcommand === "activate") {
    if (!positionalName) throw new Error("Usage: npm run model -- accounts use <name>");
    const account = activateModelAccount(database, positionalName);
    console.log(`Activated model account: ${account.name} (${account.providerKind}, ${account.apiModel})`);
    return;
  }

  if (subcommand === "remove" || subcommand === "delete" || subcommand === "rm") {
    if (!positionalName) throw new Error("Usage: npm run model -- accounts remove <name>");
    const target = getModelAccountByName(database, positionalName, cliSecretCipher);
    const removed = deleteModelAccount(database, positionalName);
    if (!removed) throw new Error(`Model account "${positionalName}" not found.`);
    console.log(`Removed model account: ${target?.name ?? positionalName}`);
    return;
  }

  if (subcommand === "test") {
    const name = positionalName;
    if (!name) throw new Error("Usage: npm run model -- accounts test <name>");
    const account = getModelAccountByName(database, name, cliSecretCipher);
    if (!account) throw new Error(`Model account "${name}" not found.`);
    if (!account.apiKey && getProviderPreset(account.providerKind).requiresApiKey) {
      throw new Error(`Model account "${name}" has no API key set.`);
    }
    if (!/^https?:\/\//i.test(account.apiUrl)) {
      throw new Error(`Model account "${name}" has no valid HTTP URL.`);
    }
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(account.apiUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(account.apiKey ? { authorization: `Bearer ${account.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: account.apiModel,
          messages: [
            { role: "system", content: "Reply with the single word PONG. Output nothing else." },
            { role: "user", content: "ping" }
          ],
          max_tokens: 8
        })
      });
    } catch (error) {
      console.log(`✗ Network error reaching ${account.apiUrl}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const elapsedMs = Date.now() - startedAt;
    if (!response.ok) {
      const errorBody = await response.text();
      console.log(`✗ HTTP ${response.status} from ${account.providerKind} after ${elapsedMs}ms`);
      console.log(`  ${errorBody.slice(0, 400)}`);
      return;
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number };
    };
    const content = payload.choices?.[0]?.message?.content ?? "(no content)";
    const usage = payload.usage ?? {};
    console.log(`✓ ${account.name} reachable in ${elapsedMs}ms`);
    console.log(`  reply: ${content.trim()}`);
    console.log(
      `  tokens: ${usage.prompt_tokens ?? "?"} prompt + ${usage.completion_tokens ?? "?"} completion = ${usage.total_tokens ?? "?"} total`
    );
    if (typeof usage.cost === "number" && Number.isFinite(usage.cost)) {
      console.log(`  upstream-reported cost: $${usage.cost.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}`);
    }
    return;
  }

  throw new Error(
    "Usage: npm run model -- accounts list | add --name \"...\" --preset ... | use <name> | remove <name> | test <name> | presets [--json]"
  );
}

async function handleProjectStatusCommand(database: ReturnType<typeof initializeDatabase>): Promise<void> {
  const git = runLocalCommand("git", ["status", "--short"]);
  const branch = runLocalCommand("git", ["branch", "--show-current"]);
  const migrationCount = (database.db.prepare("SELECT COUNT(*) as count FROM schema_migrations").get() as { count: number }).count;
  const settings = withDefaultModelSettings(database.getAllSettings());
  printJson({
    git: {
      isRepo: git.ok,
      branch: branch.ok ? branch.stdout.trim() : null,
      uncommittedFiles: git.ok ? git.stdout.split(/\r?\n/).filter(Boolean).length : null,
      status: git.ok ? git.stdout.trim() : git.stderr.trim()
    },
    nativeModules: "checked by root ensure:node-native wrapper",
    zeroSpend: {
      modelProvider: settings["model.provider"] ?? "mock",
      apiKey: redactSettingValue("model.apiKey", settings["model.apiKey"] ?? "")
    },
    database: {
      path: database.filePath,
      migrationsApplied: migrationCount
    }
  });
}

async function handleDoctorCommand(database: ReturnType<typeof initializeDatabase>, appDataDir: string): Promise<void> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  const nodeVersion = process.version;
  const nodeOk = Number(process.version.slice(1).split(".")[0]) >= 20;
  checks.push({ name: "node", ok: nodeOk, detail: nodeVersion });

  try {
    const migrationCount = (database.db.prepare("SELECT COUNT(*) as count FROM schema_migrations").get() as { count: number }).count;
    checks.push({ name: "database", ok: migrationCount >= 16, detail: `${migrationCount} migrations at ${database.filePath}` });
  } catch (error) {
    checks.push({ name: "database", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }

  const fixturePath = resolveFromInvocationCwd("./examples/buggy-python/calculator.py");
  const fixtureOk = fs.existsSync(fixturePath) && fs.readFileSync(fixturePath, "utf8").includes("return a - b");
  checks.push({
    name: "verticalSliceFixture",
    ok: fixtureOk,
    detail: fixtureOk ? "examples/buggy-python is ready for the killer demo" : "calculator fixture is missing or already fixed"
  });

  const governance = new GovernanceEngine(database, undefined, cliVaultKeyFile);
  try {
    governance.bootstrap();
    checks.push({ name: "governance", ok: true, detail: "bootstrap succeeded" });
  } catch (error) {
    checks.push({ name: "governance", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }

  try {
    const vaultStatus = governance.secrets.keyStatus();
    const source = vaultStatus.hasKey ? vaultStatus.source : "missing";
    // "explicit" is only safe in tests, "env" is best, "setting" is generated-once-and-stored,
    // "generated" means we made one this boot. All are real keys (not a hardcoded default).
    checks.push({
      name: "vaultKey",
      ok: vaultStatus.hasKey,
      detail: `source=${source}${vaultStatus.hasKey ? ` keyId=${vaultStatus.keyId}` : ""}`
    });
  } catch (error) {
    checks.push({ name: "vaultKey", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }

  checks.push({
    name: "appDataDir",
    ok: fs.existsSync(appDataDir),
    detail: appDataDir
  });

  const settings = withDefaultModelSettings(database.getAllSettings());
  checks.push({
    name: "modelProvider",
    ok: Boolean(settings["model.provider"] ?? "mock"),
    detail: String(settings["model.provider"] ?? "mock")
  });

  const allOk = checks.every((check) => check.ok);
  printJson({ ok: allOk, checks });
  if (!allOk) {
    process.exitCode = 1;
  }
}

async function handleDemoCommand(database: ReturnType<typeof initializeDatabase>, args: ParsedArgs): Promise<void> {
  const workspace = resolveFromInvocationCwd(args.workspace ?? "./examples/buggy-python");
  if (!fs.existsSync(workspace)) {
    throw new Error(`Workspace not found: ${workspace}`);
  }

  const runtime = createRuntime({
    database,
    workspacePath: workspace,
    sessionId: createId("session")
  });
  const result = await runtime.runTask("Fix calculator add function", {
    testCommand: args.testCommand ?? "pytest"
  });

  const sandboxes = database.listSandboxes({ status: "active" });
  const trace = getLatestTrace(database);
  printJson({
    demo: "vertical-slice",
    workspace,
    runId: result.runId,
    summary: result.finalSummary,
    activeSandboxes: sandboxes.length,
    latestTraceId: trace?.id ?? null,
    nextSteps: [
      "npm run sandbox -- list",
      "npm run sandbox -- approve <sandbox-id>",
      "npm run traces -- latest"
    ]
  });
}

function runLocalCommand(command: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  try {
    return { ok: true, stdout: execFileSync(command, args, { encoding: "utf8" }), stderr: "" };
  } catch (error) {
    const typed = error as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, stdout: typed.stdout ?? "", stderr: typed.stderr ?? typed.message ?? "" };
  }
}

function resolveMessagingAdapter(store: MessagingStore, registry: MessagingAdapterRegistry, value: string) {
  if (value === "fixture") {
    return registry.get("adapter_custom") ?? store.getAdapterByPlatform("custom");
  }
  return registry.get(value) ?? registry.get(`adapter_${value}`) ?? store.getAdapterByPlatform(value);
}

function handleTracesCommand(database: ReturnType<typeof initializeDatabase>, parts: string[]): void {
  const subcommand = parts[0] ?? "latest";

  if (subcommand === "latest") {
    const latest = getLatestTrace(database);
    printJson(latest ? { trace: latest, metrics: computeTraceMetrics(latest) } : { trace: null });
    return;
  }

  if (subcommand === "list") {
    const sortFlag = collectFlagValue(parts, "--sort-by");
    const sortBy = sortFlag === "duration" || sortFlag === "cost" || sortFlag === "createdAt" ? sortFlag : "createdAt";
    printJson({
      runs: listRuns(database, {
        limit: collectFlagNumber(parts, "--limit") ?? 50,
        offset: collectFlagNumber(parts, "--offset") ?? 0,
        sortBy
      })
    });
    return;
  }

  if (subcommand === "show") {
    const runId = parts[1];
    if (!runId) {
      throw new Error("Usage: npm run traces -- show <runId>");
    }
    const trace = getTrace(database, runId);
    if (!trace) {
      throw new Error(`Trace not found for run: ${runId}`);
    }
    printJson({ trace, metrics: computeTraceMetrics(trace) });
    return;
  }

  if (subcommand === "search") {
    printJson({
      results: searchEvents(database, {
        runId: collectFlagValue(parts, "--run-id"),
        type: collectFlagValue(parts, "--type"),
        provider: collectFlagValue(parts, "--provider"),
        tool: collectFlagValue(parts, "--tool"),
        jobId: collectFlagValue(parts, "--job-id"),
        teamRunId: collectFlagValue(parts, "--team-run-id"),
        text: collectFlagValue(parts, "--text"),
        limit: collectFlagNumber(parts, "--limit") ?? 100
      })
    });
    return;
  }

  if (subcommand === "export") {
    const runId = parts[1];
    if (!runId) {
      throw new Error("Usage: npm run traces -- export <runId> --format json|md");
    }

    const format = collectFlagValue(parts, "--format") === "md" ? "md" : "json";
    const trace = getTrace(database, runId);
    if (!trace) {
      throw new Error(`Trace not found for run: ${runId}`);
    }

    const outPath =
      collectFlagValue(parts, "--out") ??
      `squidbot-trace-${runId.replace(/[^a-zA-Z0-9_-]/g, "_")}.${format === "md" ? "md" : "json"}`;
    const resolvedOutPath = resolveFromInvocationCwd(outPath);
    const body =
      format === "md"
        ? exportTraceMarkdown(trace)
        : `${JSON.stringify({ trace, metrics: computeTraceMetrics(trace) }, null, 2)}\n`;
    fs.writeFileSync(resolvedOutPath, body, "utf8");
    printJson({ runId, format, path: resolvedOutPath });
    return;
  }

  throw new Error("Usage: npm run traces -- list|show <runId>|export <runId>|search");
}

function handleGapsCommand(database: ReturnType<typeof initializeDatabase>, parts: string[]): void {
  const subcommand = parts[0] ?? "list";

  if (subcommand === "list") {
    const requestedStatus = collectFlagValue(parts, "--status");
    const status = parts.includes("--include-resolved") ? "all" : requestedStatus === "resolved" || requestedStatus === "wontfix" || requestedStatus === "open" ? requestedStatus : undefined;
    printJson({
      gaps: database.listAffordanceGaps({
        status,
        limit: collectFlagNumber(parts, "--limit") ?? 100
      })
    });
    return;
  }

  if (subcommand === "show") {
    const gapId = parts[1];
    if (!gapId) {
      throw new Error("Usage: npm run gaps -- show <gapId>");
    }

    const gap = database.getAffordanceGap(gapId);
    if (!gap) {
      throw new Error(`Affordance gap not found: ${gapId}`);
    }

    printJson({
      gap,
      reflection: gap.reflectionId ? database.getReflection(gap.reflectionId) : null
    });
    return;
  }

  if (subcommand === "resolve") {
    const gapId = parts[1];
    if (!gapId) {
      throw new Error("Usage: npm run gaps -- resolve <gapId>");
    }

    const status = collectFlagValue(parts, "--status") === "wontfix" ? "wontfix" : "resolved";
    const gap = database.resolveAffordanceGap(gapId, status);
    const reflection = gap.reflectionId ? database.getReflection(gap.reflectionId) : null;
    database.appendEvent({
      id: createId("evt"),
      timestamp: new Date().toISOString(),
      sessionId: reflection?.sessionId ?? "session_affordance_gaps",
      type: "affordance.resolved",
      data: {
        runId: gap.runId,
        reflectionId: gap.reflectionId,
        gapId: gap.id,
        status: gap.status,
        resolvedAt: gap.resolvedAt
      }
    });
    printJson({ gap });
    return;
  }

  throw new Error("Usage: npm run gaps -- list|show|resolve");
}

async function handleSandboxCommand(database: ReturnType<typeof initializeDatabase>, parts: string[]): Promise<void> {
  const subcommand = parts[0] ?? "list";
  const manager = new SandboxManager();

  if (subcommand === "list") {
    const requestedStatus = collectFlagValue(parts, "--status");
    const status =
      requestedStatus === "active" ||
      requestedStatus === "promoted" ||
      requestedStatus === "rejected" ||
      requestedStatus === "destroyed" ||
      requestedStatus === "failed"
        ? requestedStatus
        : parts.includes("--include-closed")
          ? "all"
          : "active";
    printJson({
      sandboxes: database.listSandboxes({
        status,
        limit: collectFlagNumber(parts, "--limit") ?? 100
      })
    });
    return;
  }

  if (subcommand === "create") {
    const workspace = parts[1];
    if (!workspace) {
      throw new Error("Usage: npm run sandbox -- create <workspace-path>");
    }
    const sandbox = await manager.create(resolveFromInvocationCwd(workspace), readSandboxOptions(database));
    const record = database.insertSandbox({
      id: sandbox.id,
      sessionId: "session_cli_sandbox",
      runId: null,
      workspacePath: sandbox.originalWorkspacePath,
      sandboxPath: sandbox.path,
      backend: sandbox.backend,
      status: "active",
      resourceLimits: sandbox.resourceLimits,
      networkPolicy: sandbox.networkPolicy,
      createdAt: sandbox.createdAt
    });
    appendSandboxEvent(database, record, "sandbox.created", {
      sandboxId: record.id,
      workspacePath: record.workspacePath,
      sandboxPath: record.sandboxPath,
      limits: record.resourceLimits,
      networkPolicy: record.networkPolicy
    });
    printJson({ sandbox: record });
    return;
  }

  if (subcommand === "status") {
    const record = requireSandboxRecord(database, parts[1]);
    printJson({ sandbox: record });
    return;
  }

  if (subcommand === "apply-patch") {
    const record = requireSandboxRecord(database, parts[1]);
    const patchPath = parts[2];
    if (!patchPath) {
      throw new Error("Usage: npm run sandbox -- apply-patch <sandbox-id> <patch-file>");
    }
    const sandbox = sandboxFromRecord({
      id: record.id,
      sandboxPath: record.sandboxPath,
      workspacePath: record.workspacePath,
      createdAt: record.createdAt,
      resourceLimits: normalizeSandboxResourceLimits(record.resourceLimits),
      networkPolicy: record.networkPolicy
    });
    const patch = fs.readFileSync(resolveFromInvocationCwd(patchPath), "utf8");
    const startedAt = Date.now();
    try {
      await manager.applyPatch(sandbox, patch);
      const diff = await manager.diff(sandbox);
      const updated = database.updateSandbox(record.id, {
        diff,
        lastError: null
      });
      appendSandboxEvent(database, record, "sandbox.command", {
        sandboxId: record.id,
        command: "git",
        args: ["apply"],
        exitCode: 0,
        durationMs: Date.now() - startedAt,
        purpose: "applyPatch"
      });
      appendSandboxDiffEvents(database, updated);
      printJson({ sandbox: updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const updated = database.updateSandbox(record.id, {
        status: "failed",
        lastError: message
      });
      appendSandboxEvent(database, updated, "sandbox.command", {
        sandboxId: record.id,
        command: "git",
        args: ["apply"],
        exitCode: 1,
        durationMs: Date.now() - startedAt,
        purpose: "applyPatch",
        error: message
      });
      throw error;
    }
    return;
  }

  if (subcommand === "run") {
    const record = requireSandboxRecord(database, parts[1]);
    const commandLine = parts.slice(2).join(" ");
    if (!commandLine) {
      throw new Error("Usage: npm run sandbox -- run <sandbox-id> <command> [args...]");
    }
    const parsed = parseCommandLine(commandLine);
    const sandbox = sandboxFromRecord({
      id: record.id,
      sandboxPath: record.sandboxPath,
      workspacePath: record.workspacePath,
      createdAt: record.createdAt,
      resourceLimits: normalizeSandboxResourceLimits(record.resourceLimits),
      networkPolicy: record.networkPolicy
    });
    const result = await manager.runCommand(sandbox, parsed.command, parsed.args, {
      timeoutMs: collectFlagNumber(parts, "--timeout-ms") ?? 15_000
    });
    const updated = database.appendSandboxTestResult(record.id, result);
    appendSandboxEvent(database, record, "sandbox.command", {
      sandboxId: record.id,
      command: parsed.command,
      args: parsed.args,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      blockedByPolicy: result.blockedByPolicy === true,
      resourceLimitExceeded: result.resourceLimitExceeded === true
    });
    if (result.resourceLimitExceeded) {
      appendSandboxEvent(database, record, "sandbox.resourceLimitExceeded", {
        sandboxId: record.id,
        command: parsed.command,
        limits: record.resourceLimits
      });
    }
    printJson({ sandbox: updated, result });
    return;
  }

  if (subcommand === "diff") {
    const record = requireSandboxRecord(database, parts[1]);
    const sandbox = sandboxFromRecord({
      id: record.id,
      sandboxPath: record.sandboxPath,
      workspacePath: record.workspacePath,
      createdAt: record.createdAt,
      resourceLimits: normalizeSandboxResourceLimits(record.resourceLimits),
      networkPolicy: record.networkPolicy
    });
    const diff = await manager.diff(sandbox);
    const updated = database.updateSandbox(record.id, { diff });
    appendSandboxDiffEvents(database, updated);
    printJson({ sandbox: updated });
    return;
  }

  if (subcommand === "approve") {
    const record = requireSandboxRecord(database, parts[1]);
    if (record.status !== "active") {
      throw new Error(`Sandbox is not active: ${record.id}`);
    }
    const approvalId = createId("approval");
    const sandbox = sandboxFromRecord({
      id: record.id,
      sandboxPath: record.sandboxPath,
      workspacePath: record.workspacePath,
      createdAt: record.createdAt,
      resourceLimits: normalizeSandboxResourceLimits(record.resourceLimits),
      networkPolicy: record.networkPolicy
    });
    await manager.promote(sandbox, approvalId);
    await manager.destroy(sandbox);
    const now = new Date().toISOString();
    const updated = database.updateSandbox(record.id, {
      status: "promoted",
      approvalId,
      promotedAt: now,
      destroyedAt: now
    });
    appendSandboxEvent(database, updated, "sandbox.promoted", {
      sandboxId: updated.id,
      approvalId,
      promoter: "cli",
      diffLength: updated.diff.length
    });
    appendSandboxEvent(database, updated, "sandbox.destroyed", {
      sandboxId: updated.id,
      reason: "promoted"
    });
    printJson({ sandbox: updated });
    return;
  }

  if (subcommand === "reject") {
    const record = requireSandboxRecord(database, parts[1]);
    const sandbox = sandboxFromRecord({
      id: record.id,
      sandboxPath: record.sandboxPath,
      workspacePath: record.workspacePath,
      createdAt: record.createdAt,
      resourceLimits: normalizeSandboxResourceLimits(record.resourceLimits),
      networkPolicy: record.networkPolicy
    });
    await manager.destroy(sandbox);
    const updated = database.updateSandbox(record.id, {
      status: "rejected",
      destroyedAt: new Date().toISOString()
    });
    appendSandboxEvent(database, updated, "sandbox.destroyed", {
      sandboxId: updated.id,
      reason: "rejected"
    });
    printJson({ sandbox: updated });
    return;
  }

  throw new Error("Usage: npm run sandbox -- list|create|status|apply-patch|run|diff|approve|reject");
}

async function handleSkillCommand(
  database: ReturnType<typeof initializeDatabase>,
  appDataDir: string,
  args: ParsedArgs,
  parts: string[]
): Promise<void> {
  const subcommand = parts[0] ?? "list";
  const service = new SkillService(database, {
    skillsRoot: path.join(appDataDir, "skills"),
    sessionId: "session_cli_skills"
  });
  installDeveloperWorkflowSkills(service);

  if (subcommand === "list") {
    printJson({ skills: service.listSkills(collectFlagNumber(parts, "--limit") ?? 100) });
    return;
  }

  if (subcommand === "create") {
    const runId = collectFlagValue(parts, "--from-run");
    const name = collectFlagValue(parts, "--name");
    const description = collectFlagValue(parts, "--description") ?? "Captured SquidBot run packaged as a reusable skill.";
    if (!runId || !name) {
      throw new Error("Usage: npm run skill -- create --from-run <runId> --name <name> --description <description>");
    }
    printJson(service.createFromRun({ runId, name, description }));
    return;
  }

  if (subcommand === "show") {
    const skillId = resolveSkillReference(service, parts[1]);
    if (!skillId) {
      throw new Error("Usage: npm run skill -- show <skillId> [--version <version>]");
    }
    const skill = service.getSkill(skillId);
    const version = service.getVersion(skillId, collectFlagValue(parts, "--version"));
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }
    if (!version) {
      throw new Error(`Skill version not found: ${skillId}@${collectFlagValue(parts, "--version") ?? skill.currentVersion}`);
    }
    const packageManifest = validatePackageManifest(version.packagePath);
    printJson({
      skill,
      version,
      packageManifest,
      versions: service.listVersions(skillId),
      evaluations: service.listEvaluations(skillId, version.version)
    });
    return;
  }

  if (subcommand === "run") {
    const skillId = resolveSkillReference(service, parts[1]);
    if (!skillId) {
      throw new Error("Usage: npm run skill -- run <skillId> --workspace <path> [--version <version>] [--test]");
    }
    const plan = service.prepareRun(skillId, collectFlagValue(parts, "--version"));
    const workspacePath =
      args.workspace ??
      collectFlagValue(parts, "--workspace") ??
      plan.version.testFixtures[0]?.repoPath ??
      database.getSetting<string>("workspacePath");
    if (!workspacePath) {
      throw new Error("Skill run requires --workspace <path> or a fixture repo.");
    }
    const runtime = createRuntime({
      database,
      workspacePath: resolveFromInvocationCwd(workspacePath)
    });
    const result = await runtime.runTask(plan.task, {
      testCommand: args.testCommand ?? collectFlagValue(parts, "--test-command") ?? plan.testCommand,
      skillCall: {
        skillId,
        version: plan.version.version,
        testMode: parts.includes("--test")
      }
    });
    service.appendSkillRunEvent({
      runId: result.runId,
      skillId,
      version: plan.version.version,
      workspacePath,
      testMode: parts.includes("--test"),
      traceId: result.trace.id
    });
    printJson({
      skill: plan.skill,
      version: plan.version.version,
      runId: result.runId,
      finalSummary: result.finalSummary,
      trace: result.trace
    });
    return;
  }

  if (subcommand === "test" || subcommand === "evaluate") {
    const skillId = resolveSkillReference(service, parts[1]);
    if (!skillId) {
      throw new Error("Usage: npm run skill -- test <skillId> [--version <version>]");
    }
    printJson({ evaluation: await evaluateSkill(database, skillId, { version: collectFlagValue(parts, "--version") }) });
    return;
  }

  if (subcommand === "promote") {
    const skillId = resolveSkillReference(service, parts[1]);
    const version = collectFlagValue(parts, "--version");
    if (!skillId || !version) {
      throw new Error("Usage: npm run skill -- promote <skillId> --version <version> [--override]");
    }
    const evaluation = parts.includes("--override") ? undefined : await evaluateSkill(database, skillId, { version });
    printJson({ version: service.promote(skillId, version, { evaluation, override: parts.includes("--override") }) });
    return;
  }

  if (subcommand === "rollback") {
    const skillId = resolveSkillReference(service, parts[1]);
    const version = collectFlagValue(parts, "--to");
    if (!skillId || !version) {
      throw new Error("Usage: npm run skill -- rollback <skillId> --to <version>");
    }
    printJson({ skill: service.rollback(skillId, version) });
    return;
  }

  if (subcommand === "delete") {
    const skillId = resolveSkillReference(service, parts[1]);
    if (!skillId) {
      throw new Error("Usage: npm run skill -- delete <skillId> [--version <version>]");
    }
    printJson({ archived: service.archive(skillId, collectFlagValue(parts, "--version")) });
    return;
  }

  if (subcommand === "compare") {
    const skillId = resolveSkillReference(service, parts[1]);
    const from = collectFlagValue(parts, "--from");
    const to = collectFlagValue(parts, "--to");
    if (!skillId || !from || !to) {
      throw new Error("Usage: npm run skill -- compare <skillId> --from <version> --to <version>");
    }
    printJson({ diff: service.compare(skillId, from, to) });
    return;
  }

  if (subcommand === "bump") {
    const skillId = resolveSkillReference(service, parts[1]);
    if (!skillId) {
      throw new Error("Usage: npm run skill -- bump <skillId>");
    }
    printJson({ version: service.bumpVersion(skillId) });
    return;
  }

  throw new Error("Usage: npm run skill -- list|create|show|run|test|promote|rollback|delete|compare|bump");
}

async function handleJobCommand(
  database: ReturnType<typeof initializeDatabase>,
  appDataDir: string,
  args: ParsedArgs,
  parts: string[]
): Promise<void> {
  const subcommand = parts[0] ?? "list";
  const scheduler = createScheduler(database, appDataDir);

  if (subcommand === "list") {
    const statusFlag = collectFlagValue(parts, "--status");
    const status =
      statusFlag === "active" || statusFlag === "paused" || statusFlag === "running" || statusFlag === "completed" || statusFlag === "all"
        ? statusFlag
        : parts.includes("--all")
          ? "all"
          : undefined;
    printJson({ jobs: scheduler.listJobs({ status, limit: collectFlagNumber(parts, "--limit") ?? 100 }) });
    return;
  }

  if (subcommand === "show" || subcommand === "status") {
    const jobId = parts[1];
    if (!jobId) {
      throw new Error("Usage: npm run job -- show <job-id>");
    }
    printJson(scheduler.showJob(jobId));
    return;
  }

  if (subcommand === "create") {
    const type = collectFlagValue(parts, "--type");
    const name = collectFlagValue(parts, "--name");
    const schedule = collectFlagValue(parts, "--schedule");
    if (type !== "skill" && type !== "task") {
      throw new Error("Usage: npm run job -- create --type skill|task --schedule <cron-or-phrase> --name <name> ...");
    }
    if (!name || !schedule) {
      throw new Error("Job creation requires --name and --schedule.");
    }

    const refId = type === "skill" ? collectFlagValue(parts, "--skill") : collectFlagValue(parts, "--task");
    if (!refId) {
      throw new Error(type === "skill" ? "Skill jobs require --skill <skill-id>." : "Task jobs require --task <task string>.");
    }

    const workspaceFlag = collectFlagValue(parts, "--workspace") ?? args.workspace;
    const request: CreateJobRequest = {
      name,
      type,
      refId,
      version: type === "skill" ? collectFlagValue(parts, "--version") ?? null : null,
      schedule,
      workspacePath: workspaceFlag ? resolveFromInvocationCwd(workspaceFlag) : database.getSetting<string>("workspacePath") ?? null,
      testCommand: collectFlagValue(parts, "--test-command") ?? args.testCommand ?? null,
      testMode: parts.includes("--test")
    };
    printJson({ job: scheduler.createJob(request) });
    return;
  }

  if (subcommand === "pause") {
    printJson({ job: scheduler.pauseJob(requireJobId(parts[1], "pause")) });
    return;
  }

  if (subcommand === "resume") {
    printJson({ job: scheduler.resumeJob(requireJobId(parts[1], "resume")) });
    return;
  }

  if (subcommand === "remove" || subcommand === "delete") {
    printJson({ removed: scheduler.removeJob(requireJobId(parts[1], "remove")) });
    return;
  }

  if (subcommand === "runnow" || subcommand === "run-now") {
    const result = await scheduler.runNow(requireJobId(parts[1], "runnow"));
    deliverMessagingTrigger(database, "jobComplete", {
      text: `Job ${result.job.id} completed with outcome ${result.run.outcome}.`,
      jobId: result.job.id,
      runId: result.run.runId ?? undefined
    });
    printJson(result);
    return;
  }

  if (subcommand === "tick" || subcommand === "run-due") {
    const results = await scheduler.runDueJobs();
    for (const result of results) {
      deliverMessagingTrigger(database, "jobComplete", {
        text: `Job ${result.job.id} completed with outcome ${result.run.outcome}.`,
        jobId: result.job.id,
        runId: result.run.runId ?? undefined
      });
    }
    printJson({ results });
    return;
  }

  if (subcommand === "worker") {
    const intervalMs = collectFlagNumber(parts, "--interval-ms") ?? 60_000;
    const cycles = collectFlagNumber(parts, "--cycles") ?? 1;
    const results = [];
    for (let index = 0; index < Math.max(1, cycles); index += 1) {
      const cycleResults = await scheduler.runDueJobs();
      for (const result of cycleResults) {
        deliverMessagingTrigger(database, "jobComplete", {
          text: `Job ${result.job.id} completed with outcome ${result.run.outcome}.`,
          jobId: result.job.id,
          runId: result.run.runId ?? undefined
        });
      }
      results.push(...cycleResults);
      if (index < cycles - 1) {
        await sleep(Math.max(1000, intervalMs));
      }
    }
    printJson({ results });
    return;
  }

  throw new Error("Usage: npm run job -- list|show|create|pause|resume|runnow|remove|tick|worker");
}

async function handleTeamCommand(
  database: ReturnType<typeof initializeDatabase>,
  args: ParsedArgs,
  parts: string[]
): Promise<void> {
  const subcommand = parts[0] ?? "list";
  const coordinator = new TeamCoordinator(database);
  const registry = new RoleRegistry(database);
  registry.installDefaults();
  const store = new TeamStore(database);

  if (subcommand === "roles") {
    const roleCommand = parts[1] ?? "list";
    if (roleCommand === "list") {
      printJson({ roles: registry.list({ includeArchived: parts.includes("--include-archived") }) });
      return;
    }
    if (roleCommand === "show") {
      const roleId = parts[2];
      if (!roleId) {
        throw new Error("Usage: npm run team -- roles show <role-id>");
      }
      const role = registry.get(roleId);
      if (!role) {
        throw new Error(`Role not found: ${roleId}`);
      }
      printJson({ role });
      return;
    }
    if (roleCommand === "install") {
      const rolePath = parts[2];
      if (!rolePath) {
        throw new Error("Usage: npm run team -- roles install ./path/to/role.json");
      }
      printJson({ role: registry.installFromFile(resolveFromInvocationCwd(rolePath)) });
      return;
    }
    throw new Error("Usage: npm run team -- roles list|show|install");
  }

  if (subcommand === "create") {
    const name = collectFlagValue(parts, "--name") ?? "Engineering Core Team";
    const roles = (collectFlagValue(parts, "--roles") ?? "coordinator,researcher,implementer,tester,reviewer")
      .split(",")
      .map((role) => role.trim())
      .filter(Boolean);
    const id = normalizeTeamId(collectFlagValue(parts, "--id") ?? name);
    const manifest = validateTeamManifest(
      {
        ...defaultTeamManifest,
        id,
        name,
        description: collectFlagValue(parts, "--description") ?? defaultTeamManifest.description,
        roles,
        coordinatorRoleId: roles.includes("coordinator") ? "coordinator" : roles[0],
        defaultPolicy: {
          ...defaultTeamManifest.defaultPolicy,
          maxConcurrentAgents: collectFlagNumber(parts, "--max-agents") ?? defaultTeamManifest.defaultPolicy.maxConcurrentAgents
        }
      },
      registry.list().map((role) => role.id)
    );
    printJson({ team: coordinator.createTeam(manifest) });
    return;
  }

  if (subcommand === "list") {
    if (coordinator.listTeams().length === 0) {
      coordinator.ensureDefaultSetup();
    }
    printJson({ teams: coordinator.listTeams(), runs: coordinator.listTeamRuns(undefined, 20) });
    return;
  }

  if (subcommand === "show") {
    const teamId = parts[1];
    if (!teamId) {
      throw new Error("Usage: npm run team -- show <team-id>");
    }
    const team = coordinator.getTeam(teamId);
    if (!team) {
      throw new Error(`Team not found: ${teamId}`);
    }
    printJson({ team, runs: coordinator.listTeamRuns(teamId, 20) });
    return;
  }

  if (subcommand === "run") {
    const teamId = parts[1];
    const task = collectTeamRunTask(parts);
    if (!teamId || !task) {
      throw new Error('Usage: npm run team -- run <team-id> --workspace ./path "Task text"');
    }
    const result = await coordinator.runTeamTask({
      teamId,
      workspacePath: args.workspace ? resolveFromInvocationCwd(args.workspace) : database.getSetting<string>("workspacePath") ?? undefined,
      task,
      mode: parts.includes("--dry-run") ? "dry-run" : "sandbox",
      maxAgents: collectFlagNumber(parts, "--max-agents")
    });
    if (result.handoffs.length > 0) {
      deliverMessagingTrigger(database, "teamHandoff", {
        text: `Team run ${result.run.id} has ${result.handoffs.length} open handoff(s).`,
        teamRunId: result.run.id
      });
    }
    printJson(result);
    return;
  }

  if (subcommand === "status" || subcommand === "inspect") {
    const teamRunId = requireTeamRunId(parts[1], subcommand);
    const run = store.getTeamRun(teamRunId);
    if (!run) {
      throw new Error(`Team run not found: ${teamRunId}`);
    }
    printJson({
      run,
      subtasks: store.listSubtasks(teamRunId),
      blackboardEntries: store.listBlackboardEntries({ teamRunId }),
      messages: store.listMessages(teamRunId),
      conflicts: store.listConflicts(teamRunId, "all"),
      handoffs: store.listHandoffs({ teamRunId, status: "all" })
    });
    return;
  }

  if (subcommand === "blackboard") {
    const teamRunId = requireTeamRunId(parts[1], "blackboard");
    printJson({ entries: store.listBlackboardEntries({ teamRunId }) });
    return;
  }

  if (subcommand === "messages") {
    const teamRunId = requireTeamRunId(parts[1], "messages");
    printJson({ messages: store.listMessages(teamRunId) });
    return;
  }

  if (subcommand === "conflicts") {
    const teamRunId = requireTeamRunId(parts[1], "conflicts");
    printJson({ conflicts: store.listConflicts(teamRunId, "all") });
    return;
  }

  if (subcommand === "pause") {
    coordinator.pauseTeamRun(requireTeamRunId(parts[1], "pause"));
    printJson({ ok: true });
    return;
  }

  if (subcommand === "resume") {
    coordinator.resumeTeamRun(requireTeamRunId(parts[1], "resume"));
    printJson({ ok: true });
    return;
  }

  if (subcommand === "cancel") {
    coordinator.cancelTeamRun(requireTeamRunId(parts[1], "cancel"));
    printJson({ ok: true });
    return;
  }

  if (subcommand === "handoffs") {
    printJson({ handoffs: store.listHandoffs({ status: parts.includes("--all") ? "all" : "open" }) });
    return;
  }

  if (subcommand === "handoff") {
    const handoffCommand = parts[1] ?? "show";
    if (handoffCommand === "show") {
      const handoffId = parts[2];
      if (!handoffId) {
        throw new Error("Usage: npm run team -- handoff show <handoff-id>");
      }
      const handoff = store.getHandoff(handoffId);
      if (!handoff) {
        throw new Error(`Handoff not found: ${handoffId}`);
      }
      printJson({ handoff });
      return;
    }
    if (handoffCommand === "answer") {
      const handoffId = parts[2];
      const text = collectFlagValue(parts, "--text") ?? collectFlagValue(parts, "--option");
      if (!handoffId || !text) {
        throw new Error('Usage: npm run team -- handoff answer <handoff-id> --text "..."');
      }
      const handoff = store.answerHandoff(handoffId, text, { source: "cli" });
      database.appendEvent({
        id: createId("evt"),
        timestamp: new Date().toISOString(),
        sessionId: `session_${handoff.teamRunId}`,
        type: "team.handoff.resolved",
        data: {
          runId: handoff.teamRunId,
          teamRunId: handoff.teamRunId,
          handoffId,
          responseText: text
        }
      });
      refreshTraceForSession(database, `session_${handoff.teamRunId}`);
      printJson({ handoff });
      return;
    }
    throw new Error("Usage: npm run team -- handoff show|answer");
  }

  throw new Error("Usage: npm run team -- roles|create|list|show|run|status|inspect|blackboard|messages|conflicts|pause|resume|cancel|handoffs|handoff");
}

async function handleEvalCommand(
  database: ReturnType<typeof initializeDatabase>,
  appDataDir: string,
  parts: string[]
): Promise<void> {
  const subcommand = parts[0] ?? "datasets";
  const store = new EvalResultStore(database);
  const registry = new DatasetRegistry(database);

  if (subcommand === "datasets") {
    const action = parts[1] ?? "list";
    if (action === "list") {
      printJson({ datasets: registry.list() });
      return;
    }
    if (action === "show") {
      const datasetId = parts[2];
      if (!datasetId) {
        throw new Error("Usage: npm run eval -- datasets show <dataset-id>");
      }
      const dataset = registry.get(datasetId);
      if (!dataset) {
        throw new Error(`Dataset not found: ${datasetId}`);
      }
      printJson({ dataset, tasks: store.listTasks(datasetId) });
      return;
    }
    if (action === "validate") {
      const datasetPath = parts[2];
      if (!datasetPath) {
        throw new Error("Usage: npm run eval -- datasets validate <dataset-folder-or-json>");
      }
      const manifest = registry.validate(resolveFromInvocationCwd(datasetPath));
      printJson({ valid: true, manifest });
      return;
    }
    if (action === "install") {
      const datasetPath = parts[2];
      if (!datasetPath) {
        throw new Error("Usage: npm run eval -- datasets install <dataset-folder-or-json>");
      }
      const dataset = registry.install(resolveFromInvocationCwd(datasetPath));
      refreshTraceForSession(database, "session_eval_datasets");
      printJson({ dataset, tasks: store.listTasks(dataset.id) });
      return;
    }
    throw new Error("Usage: npm run eval -- datasets list|show|validate|install");
  }

  if (subcommand === "run") {
    const datasetId = collectFlagValue(parts, "--dataset");
    if (!datasetId) {
      throw new Error("Usage: npm run eval -- run --dataset <datasetId> --skill <skillId> [--version <version>] OR --variant <variantId>");
    }
    if (collectFlagValue(parts, "--team")) {
      throw new Error("Team evaluation targets are not supported yet in Phase 14; use --skill or --variant for offline benchmarks.");
    }
    const runner = new BenchmarkRunner(database, { skillsRoot: path.join(appDataDir, "skills") });
    const result = await runner.run({
      datasetId,
      skillId: collectFlagValue(parts, "--skill"),
      version: collectFlagValue(parts, "--version"),
      variantId: collectFlagValue(parts, "--variant")
    });
    deliverMessagingTrigger(database, "evalComplete", {
      text: `Evaluation ${result.evalRun.id} completed for dataset ${datasetId}. Composite score: ${(result.evalRun.metrics?.compositeScore ?? 0).toFixed(3)}.`,
      runId: result.evalRun.id
    });
    printJson(result);
    return;
  }

  if (subcommand === "show") {
    const evalRunId = parts[1];
    if (!evalRunId) {
      throw new Error("Usage: npm run eval -- show <eval-run-id>");
    }
    const evalRun = store.getEvalRun(evalRunId);
    if (!evalRun) {
      throw new Error(`Eval run not found: ${evalRunId}`);
    }
    printJson({
      evalRun,
      taskResults: store.listTaskResults(evalRunId),
      comparisons: store.listComparisonsForRun(evalRunId)
    });
    return;
  }

  if (subcommand === "compare") {
    const baselineEvalRunId = parts[1];
    const candidateEvalRunId = parts[2];
    if (!baselineEvalRunId || !candidateEvalRunId) {
      throw new Error("Usage: npm run eval -- compare <baselineEvalRunId> <candidateEvalRunId>");
    }
    const comparison = compareEvalRuns(database, baselineEvalRunId, candidateEvalRunId);
    refreshTraceForSession(database, `session_${comparison.id}`);
    printJson({ comparison });
    return;
  }

  if (subcommand === "leaderboard") {
    const datasetId = collectFlagValue(parts, "--dataset");
    const domain = collectFlagValue(parts, "--domain");
    printJson({ leaderboard: listLeaderboard(database, { datasetId, domain, limit: collectFlagNumber(parts, "--limit") ?? 50 }) });
    return;
  }

  throw new Error("Usage: npm run eval -- datasets|run|show|compare|leaderboard");
}

async function handleEvolveCommand(
  database: ReturnType<typeof initializeDatabase>,
  appDataDir: string,
  parts: string[]
): Promise<void> {
  const subcommand = parts[0] ?? "variants";
  const variants = new SkillVariantStore(database);
  const store = new EvalResultStore(database);
  const skills = new SkillService(database, {
    skillsRoot: path.join(appDataDir, "skills"),
    sessionId: "session_cli_evolution_skills"
  });
  installDeveloperWorkflowSkills(skills);

  if (subcommand === "propose") {
    const skillRef = collectFlagValue(parts, "--skill");
    if (!skillRef) {
      throw new Error("Usage: npm run evolve -- propose --skill <skillId> [--from-reflection <id>|--from-gap <id>|--from-eval <id>]");
    }
    const proposer = new MutationProposer(database, { skillsRoot: path.join(appDataDir, "skills") });
    const variant = proposer.propose({
      skillId: resolveSkillReference(skills, skillRef) ?? skillRef,
      fromReflection: collectFlagValue(parts, "--from-reflection"),
      fromGap: collectFlagValue(parts, "--from-gap"),
      fromEval: collectFlagValue(parts, "--from-eval"),
      instruction: collectFlagValue(parts, "--instruction")
    });
    refreshTraceForSession(database, "session_evolution");
    printJson({ variant });
    return;
  }

  if (subcommand === "auto") {
    const skillRef = collectFlagValue(parts, "--skill");
    const datasetId = collectFlagValue(parts, "--dataset");
    if (!skillRef || !datasetId) {
      throw new Error(
        "Usage: npm run evolve -- auto --skill <skillId> --dataset <datasetId> [--from-reflection <id>|--from-gap <id>|--from-eval <id>|--instruction <text>]"
      );
    }
    // The full self-improvement cycle: propose → static-check gate → benchmark
    // baseline vs candidate → open a canary only on a strict win. Never
    // auto-promotes to stable (that stays canary/operator gated).
    const result = await runImprovementCycle(database, {
      skillId: resolveSkillReference(skills, skillRef) ?? skillRef,
      datasetId,
      skillsRoot: path.join(appDataDir, "skills"),
      fromReflection: collectFlagValue(parts, "--from-reflection"),
      fromGap: collectFlagValue(parts, "--from-gap"),
      fromEval: collectFlagValue(parts, "--from-eval"),
      instruction: collectFlagValue(parts, "--instruction")
    });
    refreshTraceForSession(database, "session_evolution");
    printJson({
      outcome: result.outcome,
      variantId: result.variant.id,
      state: result.variant.state,
      baselineScore: result.baselineScore,
      candidateScore: result.candidateScore,
      comparison: result.comparison,
      promotedToStable: result.promotedToStable,
      reason: result.reason
    });
    return;
  }

  if (subcommand === "variants") {
    const action = parts[1] ?? "list";
    if (action === "list") {
      const skillRef = collectFlagValue(parts, "--skill");
      const skillId = skillRef ? (resolveSkillReference(skills, skillRef) ?? skillRef) : undefined;
      printJson({ variants: skillId ? variants.listVariantsForSkill(skillId, parts.includes("--include-archived")) : variants.listVariants(collectFlagNumber(parts, "--limit") ?? 100) });
      return;
    }
    if (action === "show") {
      const variantId = parts[2];
      if (!variantId) {
        throw new Error("Usage: npm run evolve -- variants show <variant-id>");
      }
      const variant = variants.getVariant(variantId);
      if (!variant) {
        throw new Error(`Variant not found: ${variantId}`);
      }
      printJson({
        variant,
        staticCheck: store.latestStaticCheck(variant.id),
        canary: store.getCanaryForVariant(variant.id)
      });
      return;
    }
    throw new Error("Usage: npm run evolve -- variants list|show");
  }

  if (subcommand === "check") {
    const variant = requireVariant(variants, parts[1]);
    const check = store.saveStaticCheck(variant.id, runStaticChecks(variant));
    database.appendEvent({
      id: createId("evt"),
      timestamp: new Date().toISOString(),
      sessionId: "session_evolution",
      type: "evolve.staticCheck.completed",
      data: {
        runId: variant.id,
        variantId: variant.id,
        skillId: variant.skillId,
        status: check.status,
        checks: check.checks
      }
    });
    refreshTraceForSession(database, "session_evolution");
    printJson({ variant, check });
    return;
  }

  if (subcommand === "test") {
    const variant = requireVariant(variants, parts[1]);
    const datasetId = collectFlagValue(parts, "--dataset");
    if (!datasetId) {
      throw new Error("Usage: npm run evolve -- test <variantId> --dataset <datasetId>");
    }
    const runner = new BenchmarkRunner(database, { skillsRoot: path.join(appDataDir, "skills") });
    printJson(await runner.run({ datasetId, variantId: variant.id }));
    return;
  }

  if (subcommand === "canary") {
    const variantId = parts[1];
    const datasetId = collectFlagValue(parts, "--dataset");
    if (!variantId || !datasetId) {
      throw new Error("Usage: npm run evolve -- canary <variantId> --dataset <datasetId>");
    }
    const canary = createCanaryForVariant(database, variantId, datasetId);
    refreshTraceForSession(database, `session_${canary.id}`);
    printJson({ canary });
    return;
  }

  if (subcommand === "promote") {
    const variantId = parts[1];
    if (!variantId) {
      throw new Error("Usage: npm run evolve -- promote <variantId>");
    }
    const result = promoteVariant(database, variantId, { skillsRoot: path.join(appDataDir, "skills") });
    refreshTraceForSession(database, `session_${variantId}`);
    printJson(result);
    return;
  }

  if (subcommand === "rollback") {
    const skillRef = parts[1];
    const target = collectFlagValue(parts, "--to");
    if (!skillRef || !target) {
      throw new Error("Usage: npm run evolve -- rollback <skillId> --to <versionOrVariantId>");
    }
    const skillId = resolveSkillReference(skills, skillRef) ?? skillRef;
    const result = rollbackEvolution(database, skillId, target, { skillsRoot: path.join(appDataDir, "skills") });
    refreshTraceForSession(database, `session_${skillId}`);
    printJson(result);
    return;
  }

  throw new Error("Usage: npm run evolve -- propose|variants|check|test|canary|promote|rollback");
}

function createScheduler(database: ReturnType<typeof initializeDatabase>, appDataDir: string): Scheduler {
  return new Scheduler(database, {
    skillsRoot: path.join(appDataDir, "skills"),
    workspacePath: database.getSetting<string>("workspacePath") ?? null
  });
}

function requireJobId(jobId: string | undefined, command: string): string {
  if (!jobId) {
    throw new Error(`Usage: npm run job -- ${command} <job-id>`);
  }
  return jobId;
}

function requireTeamRunId(teamRunId: string | undefined, command: string): string {
  if (!teamRunId) {
    throw new Error(`Usage: npm run team -- ${command} <team-run-id>`);
  }
  return teamRunId;
}

function normalizeTeamId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^team_/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^/, "team_");
}

function collectTeamRunTask(parts: string[]): string {
  const skipNext = new Set<number>();
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index].startsWith("--")) {
      skipNext.add(index);
      if (parts[index + 1] && !parts[index + 1].startsWith("--")) {
        skipNext.add(index + 1);
      }
    }
  }
  return parts
    .slice(2)
    .filter((_, index) => !skipNext.has(index + 2))
    .join(" ")
    .trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveSkillReference(service: SkillService, value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (service.getSkill(value)) {
    return value;
  }
  const normalized = normalizeSkillId(value);
  if (service.getSkill(normalized)) {
    return normalized;
  }
  const compact = `skill_${value.replace(/^skill_/, "").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  if (service.getSkill(compact)) {
    return compact;
  }
  return value;
}

function requireVariant(store: SkillVariantStore, variantId: string | undefined): ReturnType<SkillVariantStore["getVariant"]> & {} {
  if (!variantId) {
    throw new Error("Variant ID is required.");
  }
  const variant = store.getVariant(variantId);
  if (!variant) {
    throw new Error(`Variant not found: ${variantId}`);
  }
  return variant;
}

function validatePackageManifest(packagePath: string | null): { path: string | null; valid: boolean } {
  if (!packagePath) {
    return { path: null, valid: true };
  }
  const manifestPath = path.join(packagePath, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Skill package manifest not found: ${manifestPath}`);
  }
  validateSkillManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  return { path: manifestPath, valid: true };
}

function requireSandboxRecord(database: ReturnType<typeof initializeDatabase>, sandboxId: string | undefined): SandboxRecord {
  if (!sandboxId) {
    throw new Error("Sandbox ID is required.");
  }
  const record = database.getSandbox(sandboxId);
  if (!record) {
    throw new Error(`Sandbox not found: ${sandboxId}`);
  }
  return record;
}

function appendSandboxDiffEvents(database: ReturnType<typeof initializeDatabase>, record: SandboxRecord): void {
  const changedFiles = [...record.diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]);
  appendSandboxEvent(database, record, "sandbox.diff", {
    sandboxId: record.id,
    diffLength: record.diff.length,
    fileCount: changedFiles.length,
    changedFiles
  });
  appendSandboxEvent(database, record, "sandbox.approvalRequested", {
    sandboxId: record.id,
    diffLength: record.diff.length,
    fileCount: changedFiles.length,
    changedFiles,
    approvalRequired: record.diff.trim().length > 0
  });
}

function appendSandboxEvent(
  database: ReturnType<typeof initializeDatabase>,
  record: Pick<SandboxRecord, "id" | "sessionId" | "runId">,
  type:
    | "sandbox.created"
    | "sandbox.command"
    | "sandbox.diff"
    | "sandbox.approvalRequested"
    | "sandbox.promoted"
    | "sandbox.destroyed"
    | "sandbox.resourceLimitExceeded",
  data: Record<string, unknown>
): void {
  const sessionId = record.sessionId ?? "session_cli_sandbox";
  database.appendEvent({
    id: createId("evt"),
    timestamp: new Date().toISOString(),
    sessionId,
    type,
    data: {
      runId: record.runId ?? `run_${record.id}`,
      ...data
    }
  });
  refreshTraceForSession(database, sessionId);
}

function refreshTraceForSession(database: ReturnType<typeof initializeDatabase>, sessionId: string): void {
  const events = database.listEvents(sessionId).map((event) => {
    const data = JSON.parse(event.data) as JsonObject;
    return {
      id: event.id,
      timestamp: event.timestamp,
      sessionId: event.session_id,
      runId: typeof data.runId === "string" ? data.runId : `run_${sessionId}`,
      type: event.type as AgentEvent["type"],
      data
    } satisfies AgentEvent;
  });
  if (events.length === 0) {
    return;
  }

  const trace = buildTrace(events);
  database.saveTrace({
    id: trace.id,
    sessionId,
    events: trace,
    createdAt: trace.createdAt
  });
}

function readSandboxOptions(database: ReturnType<typeof initializeDatabase>): Parameters<SandboxManager["create"]>[1] {
  return {
    resourceLimits: {
      cpu: normalizePositiveNumber(database.getSetting("sandbox.limits.cpu")) ?? 1,
      memoryMb: normalizePositiveInteger(database.getSetting("sandbox.limits.memory")) ?? 512,
      diskMb: normalizePositiveInteger(database.getSetting("sandbox.limits.disk")) ?? 512
    },
    networkPolicy: normalizeNetworkPolicy(database.getSetting("sandbox.network.policy"))
  };
}

function normalizeSandboxResourceLimits(value: unknown): { cpu: number; memoryMb: number; diskMb: number } {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    cpu: normalizePositiveNumber(record.cpu) ?? 1,
    memoryMb: normalizePositiveInteger(record.memoryMb) ?? 512,
    diskMb: normalizePositiveInteger(record.diskMb) ?? 512
  };
}

function normalizeNetworkPolicy(value: unknown): "allow" | "deny" | "custom" {
  return value === "allow" || value === "custom" || value === "deny" ? value : "deny";
}

function handleMemoryGraphCommand(database: ReturnType<typeof initializeDatabase>, parts: string[]): void {
  const store = new MemoryGraphStore(database);
  const subcommand = parts[0] ?? "list";

  if (subcommand === "list") {
    const type = collectFlagValue(parts, "--type");
    const nodes = store.listNodes({
      type,
      includeDeleted: parts.includes("--include-deleted"),
      includeArchived: parts.includes("--include-archived"),
      limit: collectFlagNumber(parts, "--limit") ?? 100
    });
    printJson({ nodes });
    return;
  }

  if (subcommand === "show") {
    const nodeId = parts[1];
    if (!nodeId) {
      throw new Error("Usage: npm run memory -- graph show <nodeId>");
    }
    const node = store.getNode(nodeId, { includeArchived: true });
    if (!node) {
      throw new Error(`Memory graph node not found: ${nodeId}`);
    }
    printJson({
      node,
      edges: store.listEdgesForNode(nodeId),
      traversal: store.traverse(nodeId, collectFlagNumber(parts, "--depth") ?? 1)
    });
    return;
  }

  if (subcommand === "create") {
    const type = parts[1];
    const title = collectFlagValue(parts, "--title");
    const body = collectFlagValue(parts, "--body");
    if (!type || !title || !body) {
      throw new Error('Usage: npm run memory -- graph create <type> --title "Title" --body "Body"');
    }
    printJson({
      node: store.createNode({
        type,
        title,
        body,
        confidence: collectFlagFloat(parts, "--confidence") ?? 0.5,
        importance: collectFlagFloat(parts, "--importance") ?? 0.5,
        sensitivity: collectFlagValue(parts, "--sensitivity") ?? "public"
      })
    });
    return;
  }

  if (subcommand === "link") {
    const [fromNodeId, toNodeId, edgeType] = parts.slice(1);
    if (!fromNodeId || !toNodeId || !edgeType) {
      throw new Error("Usage: npm run memory -- graph link <fromId> <toId> <edgeType>");
    }
    printJson({ edge: store.createEdge({ fromNodeId, toNodeId, type: edgeType }) });
    return;
  }

  if (subcommand === "search") {
    const topK = collectFlagNumber(parts, "--top") ?? 5;
    const fts = collectFlagValue(parts, "--fts");
    const vector = collectFlagValue(parts, "--vector");
    const hybrid = collectFlagValue(parts, "--hybrid");
    if (fts) {
      printJson({ results: store.searchFTS(fts, topK) });
      return;
    }
    if (vector) {
      printJson({ results: store.searchVector(vector, topK) });
      return;
    }
    if (hybrid) {
      printJson({ results: store.hybridSearch(hybrid, topK) });
      return;
    }
    throw new Error('Usage: npm run memory -- graph search --hybrid "query" --top 5');
  }

  if (subcommand === "merge") {
    const [targetNodeId, sourceNodeId] = parts.slice(1);
    if (!targetNodeId || !sourceNodeId) {
      throw new Error("Usage: npm run memory -- graph merge <targetNodeId> <sourceNodeId>");
    }
    printJson({ node: store.mergeNodes(targetNodeId, sourceNodeId) });
    return;
  }

  if (subcommand === "archive") {
    const nodeId = parts[1];
    if (!nodeId) {
      throw new Error("Usage: npm run memory -- graph archive <nodeId>");
    }
    printJson({ node: store.archiveNode(nodeId) });
    return;
  }

  if (subcommand === "delete") {
    const nodeId = parts[1];
    if (!nodeId) {
      throw new Error("Usage: npm run memory -- graph delete <nodeId>");
    }
    printJson({ node: store.deleteNode(nodeId) });
    return;
  }

  if (subcommand === "contradictions") {
    const nodeId = parts[1];
    if (!nodeId) {
      throw new Error("Usage: npm run memory -- graph contradictions <nodeId> [--pool 25] [--min-score 0.5]");
    }
    // Operator-review surface: list same-subject peers that contradict this
    // node, with the evidence (shared terms + polarity signals). We never
    // auto-create the contradicts edge — the operator confirms via `graph link`.
    printJson({
      candidates: store.detectContradictions(nodeId, {
        candidatePoolSize: collectFlagNumber(parts, "--pool"),
        minScore: collectFlagFloat(parts, "--min-score")
      })
    });
    return;
  }

  throw new Error(
    "Usage: npm run memory -- graph list|show|create|link|search|merge|archive|delete|contradictions"
  );
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(redactValue(value).value, null, 2));
}

function collectFlagValue(parts: string[], flag: string): string | undefined {
  // Support --flag=value form (single token).
  const inline = parts.find((part) => part.startsWith(`${flag}=`));
  if (inline) {
    return inline.slice(flag.length + 1).trim() || undefined;
  }
  // Fall back to --flag value form (allow multi-token values until the next flag).
  const index = parts.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  const values: string[] = [];
  for (let cursor = index + 1; cursor < parts.length; cursor += 1) {
    if (parts[cursor].startsWith("--")) {
      break;
    }
    values.push(parts[cursor]);
  }
  return values.join(" ").trim() || undefined;
}

function collectFlagNumber(parts: string[], flag: string): number | undefined {
  const value = collectFlagValue(parts, flag);
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined;
}

function requireValue(value: string | undefined, message: string): string {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function collectKeyValueFlags(parts: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part.startsWith("--")) {
      continue;
    }
    const key = normalizeFlagKey(part);
    const collected: string[] = [];
    for (let cursor = index + 1; cursor < parts.length; cursor += 1) {
      if (parts[cursor].startsWith("--")) {
        break;
      }
      collected.push(parts[cursor]);
    }
    if (collected.length > 0) {
      values[key] = collected.join(" ");
    }
  }
  return values;
}

function normalizeFlagKey(flag: string): string {
  return flag
    .replace(/^--/, "")
    .replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function normalizeChannelType(value: string | undefined, platform: string): "dm" | "group" | "channel" | "thread" | "email" | "room" | "webchat" {
  if (value === "dm" || value === "group" || value === "channel" || value === "thread" || value === "email" || value === "room" || value === "webchat") {
    return value;
  }
  if (platform === "email") {
    return "email";
  }
  if (platform === "matrix") {
    return "room";
  }
  if (platform === "localWeb") {
    return "webchat";
  }
  return "channel";
}

function normalizeRisk(value: string | undefined): "low" | "medium" | "high" {
  return value === "medium" || value === "high" ? value : "low";
}

function loadFixturePayload(fixturePath: string): unknown {
  const body = fs.readFileSync(fixturePath, "utf8");
  if (fixturePath.endsWith(".eml")) {
    return parseEmailFixture(body, path.basename(fixturePath));
  }
  return JSON.parse(body) as unknown;
}

function parseEmailFixture(body: string, fallbackId: string): Record<string, unknown> {
  const [rawHeaders, ...bodyParts] = body.split(/\r?\n\r?\n/);
  const headers: Record<string, string> = {};
  for (const line of rawHeaders.split(/\r?\n/)) {
    const [key, ...rest] = line.split(":");
    if (key && rest.length > 0) {
      headers[key.trim().toLowerCase()] = rest.join(":").trim();
    }
  }
  return {
    platform: "email",
    messageId: headers["message-id"] ?? fallbackId,
    from: headers.from,
    to: headers.to,
    subject: headers.subject,
    text: bodyParts.join("\n\n").trim() || headers.subject,
    mailbox: "fixture",
    attachments: headers["x-attachment-filename"]
      ? [
          {
            id: headers["x-attachment-id"] ?? headers["x-attachment-filename"],
            filename: headers["x-attachment-filename"],
            mimeType: headers["x-attachment-mime"],
            sizeBytes: headers["x-attachment-size"] ? Number(headers["x-attachment-size"]) : undefined
          }
        ]
      : undefined
  };
}

function inferFixturePlatform(raw: unknown): MessagingPlatform {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const platform = typeof record.platform === "string" ? record.platform : "genericWebhook";
  return platform as MessagingPlatform;
}

function maybeTrustFixture(store: MessagingStore, raw: unknown, normalized: { platform: string; externalUserId?: string; externalChannelId?: string }): void {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (record.fixtureAllow !== true) {
    return;
  }
  if (normalized.externalUserId) {
    store.upsertIdentity({
      platform: normalized.platform,
      externalUserId: normalized.externalUserId,
      trustLevel: "trusted",
      metadata: { fixtureAllow: true }
    });
    store.createAllowlistRule({
      platform: normalized.platform,
      externalUserId: normalized.externalUserId,
      externalChannelId: normalized.externalChannelId ?? null,
      ruleType: "allowUser",
      riskLimit: "medium"
    });
  }
  if (normalized.externalChannelId) {
    store.createAllowlistRule({
      platform: normalized.platform,
      externalChannelId: normalized.externalChannelId,
      ruleType: "allowChannel",
      riskLimit: "medium"
    });
  }
}

function collectFlagFloat(parts: string[], flag: string): number | undefined {
  const value = collectFlagValue(parts, flag);
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function redactSettingValue(key: string, value: unknown): string {
  if (/apikey|token|secret|password/i.test(key)) {
    return typeof value === "string" && value ? "[set]" : "[empty]";
  }

  return JSON.stringify(value);
}

function parseSettingValue(key: string, value: string): unknown {
  if (key === "model.provider") {
    if (!["local", "api", "mock"].includes(value)) {
      throw new Error("model.provider must be one of: local, api, mock");
    }

    return value;
  }

  if (key === "model.budget.api") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error("model.budget.api must be a positive token count.");
    }

    return Math.floor(parsed);
  }

  return value;
}

function withDefaultModelSettings(settings: Record<string, unknown>): Record<string, unknown> {
  return {
    "model.provider": settings["model.provider"] ?? "local",
    "model.apiUrl": settings["model.apiUrl"] ?? "",
    "model.apiKey": settings["model.apiKey"] ?? "",
    "model.apiModel": settings["model.apiModel"] ?? "byok-openai-compatible",
    "model.budget.api": settings["model.budget.api"] ?? "",
    "github.apiKey": settings["github.apiKey"] ?? "",
    "github.baseUrl": settings["github.baseUrl"] ?? "",
    "gitlab.apiKey": settings["gitlab.apiKey"] ?? "",
    "gitlab.baseUrl": settings["gitlab.baseUrl"] ?? "",
    "gitlab.apiUrl": settings["gitlab.apiUrl"] ?? "",
    "jira.apiKey": settings["jira.apiKey"] ?? "",
    "jira.baseUrl": settings["jira.baseUrl"] ?? "",
    "jira.apiUrl": settings["jira.apiUrl"] ?? "",
    "jira.projectKey": settings["jira.projectKey"] ?? "",
    "jenkins.apiKey": settings["jenkins.apiKey"] ?? "",
    "jenkins.baseUrl": settings["jenkins.baseUrl"] ?? "",
    ...settings
  };
}

function readSettingWithDefault(database: ReturnType<typeof initializeDatabase>, key: string): unknown {
  const settings = withDefaultModelSettings(database.getAllSettings());
  return settings[key] ?? null;
}

function normalizeTokenBudget(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
  }

  return null;
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
  }

  return null;
}

function normalizePositiveNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

function formatCost(value: number): string {
  return `$${value.toFixed(6)}`;
}
