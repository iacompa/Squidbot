import path from "node:path";
import fs from "node:fs";
import { dialog, ipcMain } from "electron";
import { validateModelAccountApiUrl, validateProviderApiUrl } from "./urlGuards.js";
import { replaceMcpManager } from "./mcpPool.js";
import { McpCommandError, redactMcpEnv, validateMcpCommand } from "./mcpAllowlist.js";
import { withApprovalLock } from "./approvalLock.js";
import { BlueprintRegistry } from "@squidbot/blueprints";
import {
  ConnectorRegistry,
  executeRealHttpCall,
  getApproval,
  installDeveloperWorkflowConnectors,
  listOpenApprovals,
  McpClientManager,
  registerConnectorTools,
  resolveApproval
} from "@squidbot/connectors";
import { EvalResultStore, SkillVariantStore } from "@squidbot/evals";
import { DEFAULT_ADMIN_USER_ID, DEFAULT_TENANT_ID, GovernanceEnforcer, GovernanceEngine, GovernancePolicyEngine } from "@squidbot/governance";
import { MemoryGraphStore } from "@squidbot/memory";
import { DeliveryRouter, getPlatformMatrixEntry, listPlatformMatrix, MessagingAdapterRegistry, MessagingGateway, MessagingStore } from "@squidbot/messaging";
import { SandboxManager, sandboxFromRecord } from "@squidbot/sandbox";
import { Scheduler } from "@squidbot/scheduler";
import { evaluateSkill, installDeveloperWorkflowSkills, SkillService } from "@squidbot/skills";
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
  formatOnboardingSummary,
  formatNextActions,
  getActiveModelAccount,
  getActiveProfile,
  getCatalogForProvider,
  getDefaultModelForProvider,
  getProviderPreset,
  getTrace,
  getLatestTrace,
  inferOnboardingProfile,
  installSeedProfiles,
  listModelAccounts,
  listProfiles,
  listRuns,
  loadOrCreateMasterKey,
  mergeWithLiveModels,
  parseStoredTrace,
  PROVIDER_PRESETS,
  redactAccount,
  redactTrace,
  registerModelAccountTools,
  registerTerminalTools,
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
  type ProviderKind,
  type SecretCipher
} from "@squidbot/core";
import { discoverProviderModels } from "@squidbot/models";
import {
  buildCompliancePacket,
  buildTrustReport,
  digestTrustReport,
  formatTrustReportMarkdown,
  summarizeTrustReport
} from "@squidbot/governance";
import type { SquidDatabase } from "@squidbot/db";
import type {
  ChatRequest,
  CommandRunResultDto,
  ConnectorDto,
  EnterpriseProfileCreateRequestDto,
  JobCreateRequestDto,
  McpServerDto,
  McpServerInputDto,
  McpServerTestResultDto,
  MemoryGraphDetailDto,
  MessagingAllowlistRuleDto,
  MessagingChannelDto,
  MessagingDeliveryRuleDto,
  OnboardingAnswerDto,
  PendingApprovalDto,
  SettingsDto,
  SquidbotCommandDescriptorDto,
  SquidbotCommandId,
  TeamRunRequestDto
} from "../shared/api.js";
import type { DesktopAppPaths } from "./appPaths.js";

const allowedSettings = new Set([
  "workspacePath",
  "modelProvider",
  "byokEnabled",
  "model.provider",
  "model.apiKey",
  "model.apiUrl",
  "model.apiModel",
  "model.budget.api",
  "sandbox.limits.cpu",
  "sandbox.limits.memory",
  "sandbox.limits.disk",
  "sandbox.network.policy"
]);

function readSettings(database: SquidDatabase, paths: DesktopAppPaths): SettingsDto {
  const settings = database.getAllSettings();
  const connectors = readConnectors(database);
  const provider = normalizeModelProvider(settings["model.provider"]);
  const apiBudgetTokens = normalizePositiveInteger(settings["model.budget.api"]);
  const today = new Date().toISOString().slice(0, 10);
  const apiUsage = database.getModelUsage("api", today);
  return {
    appDataDir: paths.appDataDir,
    databasePath: paths.databasePath,
    workspacePath: typeof settings.workspacePath === "string" ? settings.workspacePath : undefined,
    modelProvider: provider,
    byokEnabled: provider === "api",
    modelSettings: {
      provider,
      apiKeyConfigured: typeof settings["model.apiKey"] === "string" && Boolean(settings["model.apiKey"]),
      apiUrl: typeof settings["model.apiUrl"] === "string" ? (settings["model.apiUrl"] as string) : undefined,
      apiModel: typeof settings["model.apiModel"] === "string" && settings["model.apiModel"] ? (settings["model.apiModel"] as string) : "byok-openai-compatible",
      apiBudgetTokens: apiBudgetTokens ?? undefined,
      apiUsedTokens: apiUsage?.tokens ?? 0,
      apiRemainingTokens: apiBudgetTokens === null ? undefined : Math.max(0, apiBudgetTokens - (apiUsage?.tokens ?? 0)),
      apiCost: apiUsage?.cost ?? 0,
      costOwner: provider === "api" ? "user-paid" : "local/free"
    },
    connectors,
    connectorSettings: Object.fromEntries(
      connectors.map((connector) => {
        const status = settings[`${connector.name}.lastTest.status`];
        const at = settings[`${connector.name}.lastTest.at`];
        const message = settings[`${connector.name}.lastTest.message`];
        return [
          connector.name,
          {
            baseUrl: typeof settings[`${connector.name}.baseUrl`] === "string"
              ? (settings[`${connector.name}.baseUrl`] as string) : undefined,
            apiKeyConfigured: typeof settings[`${connector.name}.apiKey`] === "string"
              && Boolean(settings[`${connector.name}.apiKey`]),
            lastTest: typeof status === "string" && typeof at === "string"
              ? { status, at, message: typeof message === "string" ? message : undefined }
              : undefined
          }
        ];
      })
    )
  };
}

function readConnectors(database: SquidDatabase): ConnectorDto[] {
  const registry = new ConnectorRegistry(database);
  installDeveloperWorkflowConnectors(registry);
  return registry.listConnectors().map((connector) => ({
    name: connector.name,
    systemType: connector.systemType,
    description: connector.description,
    protocol: connector.protocol,
    fixtureMode: connector.fixtureMode,
    costOwner: connector.costOwner,
    operations: connector.endpoints.map((endpoint) => endpoint.operationId)
  }));
}

// Decrypts BYOK keys read from model_accounts and encrypts them on write. The
// master key lives in a 0600 file under appDataDir — never in the SQLite DB it
// protects. Set once in registerIpcHandlers (where appDataDir is known).
let desktopSecretCipher: SecretCipher | undefined;
// Path to the governance vault's master-key file (outside the DB). Passing this
// to GovernanceEngine migrates any legacy in-DB vault key out on first use.
let desktopVaultKeyFile: string | undefined;

function createRuntime(database: SquidDatabase, workspacePath: string, sessionId?: string): AgentRuntime {
  const toolRegistry = new ToolRegistry();
  registerWorkspaceTools(toolRegistry);
  registerTerminalTools(toolRegistry);
  registerTestTools(toolRegistry);
  // Model-account management tools must be registered here too — passing a
  // toolRegistry into AgentRuntime suppresses its built-in registration.
  registerModelAccountTools(toolRegistry, database);
  const connectorRegistry = new ConnectorRegistry(database);
  installDeveloperWorkflowConnectors(connectorRegistry);
  registerConnectorTools(toolRegistry, connectorRegistry);

  // Spawn enabled MCP servers into the same ToolRegistry via the pool. The
  // pool shuts down the previous generation before the new one — without
  // that, every chat message orphaned a subprocess tree (createRuntime is
  // called per-message). We still don't await: startup shouldn't block on
  // slow servers; tools not yet registered when an agent message arrives
  // simply aren't available until the next runtime construction.
  void replaceMcpManager(
    toolRegistry,
    database.listMcpServers()
      .filter((s) => s.enabled)
      .map((s) => ({
        name: s.name,
        transport: "stdio" as const,
        command: s.command,
        args: s.args,
        env: s.env,
        riskLevel: s.riskLevel
      }))
  );

  const governanceEnforcer = new GovernanceEnforcer(new GovernancePolicyEngine(database));
  return new AgentRuntime({ database, workspacePath, sessionId, toolRegistry, governanceEnforcer, secretCipher: desktopSecretCipher });
}

function createSkillService(database: SquidDatabase, paths: DesktopAppPaths): SkillService {
  const service = new SkillService(database, {
    skillsRoot: path.join(paths.appDataDir, "skills"),
    sessionId: "session_desktop_skills"
  });
  installDeveloperWorkflowSkills(service);
  return service;
}

function createScheduler(database: SquidDatabase, paths: DesktopAppPaths): Scheduler {
  return new Scheduler(database, {
    skillsRoot: path.join(paths.appDataDir, "skills"),
    workspacePath: database.getSetting<string>("workspacePath") ?? null
  });
}

function createTeamCoordinator(database: SquidDatabase): TeamCoordinator {
  const registry = new RoleRegistry(database);
  registry.installDefaults();
  const coordinator = new TeamCoordinator(database);
  if (coordinator.listTeams().length === 0) {
    coordinator.ensureDefaultSetup();
  }
  return coordinator;
}

function createMessagingStore(database: SquidDatabase): MessagingStore {
  const store = new MessagingStore(database);
  new MessagingAdapterRegistry(store).installDefaults();
  return store;
}

function createMessagingGateway(database: SquidDatabase, paths: DesktopAppPaths): MessagingGateway {
  const workspacePath = database.getSetting<string>("workspacePath") ?? paths.appDataDir;
  return new MessagingGateway({
    database,
    workspacePath,
    createRuntime: (resolvedWorkspacePath, sessionId) => createRuntime(database, resolvedWorkspacePath, sessionId)
  });
}

function createGovernance(database: SquidDatabase): GovernanceEngine {
  return new GovernanceEngine(database, undefined, desktopVaultKeyFile);
}

export function registerIpcHandlers(database: SquidDatabase, paths: DesktopAppPaths): void {
  // Build the at-rest secret cipher from a master key stored OUTSIDE the DB
  // (a 0600 key file under appDataDir, or the SQUIDBOT_LOCAL_SECRET_KEY env).
  desktopSecretCipher = createSecretCipher(
    loadOrCreateMasterKey({ keyFilePath: path.join(paths.appDataDir, "secret.key") })
  );
  desktopVaultKeyFile = path.join(paths.appDataDir, "vault.master.key");

  ipcMain.handle("squidbot:chooseWorkspace", async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose SquidBot Workspace",
      properties: ["openDirectory", "createDirectory"]
    });

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    database.setSetting("workspacePath", result.filePaths[0]);
    return result.filePaths[0];
  });

  ipcMain.handle("squidbot:getSettings", () => readSettings(database, paths));

  ipcMain.handle("squidbot:saveSetting", (_event, key: string, value: unknown) => {
    if (!allowedSettings.has(key)) {
      throw new Error(`Unsupported setting: ${key}`);
    }

    if (key === "modelProvider" || key === "model.provider") {
      database.setSetting("model.provider", normalizeModelProvider(value));
    } else if (key === "byokEnabled") {
      database.setSetting("byokEnabled", Boolean(value));
    } else if (key === "model.budget.api") {
      if (typeof value === "string" && value.trim() === "") {
        database.deleteSetting(key);
        return readSettings(database, paths);
      }
      const budget = normalizePositiveInteger(value);
      if (budget === null) {
        throw new Error("model.budget.api must be a positive token count.");
      }
      database.setSetting(key, budget);
    } else if (
      typeof value === "string" &&
      value.trim() === "" &&
      (key === "model.apiKey" || key === "model.apiUrl" || key === "model.apiModel")
    ) {
      database.deleteSetting(key);
    } else if (key === "model.apiUrl") {
      // Strict guard: api key would travel to this URL on the next chat
      // turn, so we require https and reject private/loopback hosts.
      if (typeof value !== "string") {
        throw new Error("model.apiUrl must be a string.");
      }
      const urlError = validateProviderApiUrl(value);
      if (urlError) {
        throw new Error(urlError);
      }
      database.setSetting(key, value.trim());
    } else if (key === "workspacePath") {
      if (typeof value !== "string" || !value.trim()) {
        throw new Error("workspacePath must be a non-empty string.");
      }
      database.setSetting(key, path.resolve(value));
    } else if (key.startsWith("sandbox.limits.")) {
      const numeric = normalizePositiveInteger(value);
      if (numeric === null) {
        throw new Error(`${key} must be a positive integer.`);
      }
      database.setSetting(key, numeric);
    } else if (key === "sandbox.network.policy") {
      if (value !== "allow" && value !== "deny" && value !== "custom") {
        throw new Error("sandbox.network.policy must be allow, deny, or custom.");
      }
      database.setSetting(key, value);
    } else {
      database.setSetting(key, value);
    }

    return readSettings(database, paths);
  });

  ipcMain.handle("squidbot:saveConnectorSetting", (_event, connectorName: string, key: string, value: string) => {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(connectorName)) {
      throw new Error(`Unsupported connector name: ${connectorName}`);
    }

    if (key !== "apiKey" && key !== "baseUrl") {
      throw new Error(`Unsupported connector setting: ${key}`);
    }

    database.setSetting(`${connectorName}.${key}`, value);
    return readSettings(database, paths);
  });

  // ---------- Model accounts (multi-BYOK) ----------
  // The renderer talks to these handlers to: list saved accounts, add a new
  // one with a key, activate / delete one, fetch the static catalog of models
  // for a provider, and call the provider's live /v1/models endpoint to
  // populate the model dropdown after a key is pasted in.

  ipcMain.handle("squidbot:listModelAccounts", () => {
    const accounts = listModelAccounts(database, desktopSecretCipher);
    const active = getActiveModelAccount(database, desktopSecretCipher);
    return {
      activeAccountName: active?.name ?? null,
      accounts: accounts.map((account) => redactAccount(account))
    };
  });

  ipcMain.handle("squidbot:upsertModelAccount", (_event, input: ModelAccountInput) => {
    const saved = upsertModelAccount(database, coerceModelAccountInput(input), desktopSecretCipher);
    return redactAccount(saved);
  });

  ipcMain.handle("squidbot:activateModelAccount", (_event, accountName: string) => {
    const active = activateModelAccount(database, accountName);
    return redactAccount(active);
  });

  ipcMain.handle("squidbot:deleteModelAccount", (_event, accountName: string) => {
    deleteModelAccount(database, accountName);
    return { deleted: true, name: accountName };
  });

  ipcMain.handle("squidbot:getProviderPresets", () => {
    // Reshape the core ProviderPreset (which uses `kind`) into the DTO shape
    // (which uses `providerKind`) so the renderer's discriminator matches the
    // ModelAccountSummaryDto / ProviderKindDto naming convention.
    return PROVIDER_PRESETS.map((preset) => ({
      providerKind: preset.kind,
      label: preset.displayName,
      defaultApiUrl: preset.defaultApiUrl,
      defaultModel: getDefaultModelForProvider(preset.kind),
      notes: preset.description,
      catalog: getCatalogForProvider(preset.kind)
    }));
  });

  ipcMain.handle("squidbot:getProviderCatalog", (_event, providerKind: ProviderKind) => {
    const preset = getProviderPreset(providerKind);
    return {
      providerKind,
      preset: {
        providerKind: preset.kind,
        label: preset.displayName,
        defaultApiUrl: preset.defaultApiUrl,
        defaultModel: getDefaultModelForProvider(preset.kind),
        notes: preset.description,
        catalog: getCatalogForProvider(preset.kind)
      },
      defaultModel: getDefaultModelForProvider(providerKind),
      catalog: getCatalogForProvider(providerKind)
    };
  });

  ipcMain.handle(
    "squidbot:discoverModels",
    async (_event, request: { providerKind: ProviderKind; apiUrl: string; apiKey: string; timeoutMs?: number }) => {
      const urlError = validateProviderApiUrl(request.apiUrl);
      if (urlError) {
        return {
          success: false,
          code: "network" as const,
          message: urlError,
          fallback: {
            providerKind: request.providerKind,
            catalog: getCatalogForProvider(request.providerKind)
          }
        };
      }
      const result = await discoverProviderModels({
        apiUrl: request.apiUrl,
        apiKey: request.apiKey,
        timeoutMs: request.timeoutMs
      });
      if (!result.success) {
        // Mirror the static catalog back so the UI can still show *something*
        // even when the live fetch fails — the failure code/message tells the
        // renderer whether to render a warning banner.
        return {
          ...result,
          fallback: {
            providerKind: request.providerKind,
            catalog: getCatalogForProvider(request.providerKind)
          }
        };
      }
      // Merge the live list with the curated catalog so we have rich labels
      // where the catalog knows the model and bare-id entries where it
      // doesn't.
      const merged = mergeWithLiveModels(request.providerKind, result.models);
      return { ...result, merged };
    }
  );

  ipcMain.handle("squidbot:sendChatMessage", async (_event, request: ChatRequest) => {
    const settings = readSettings(database, paths);
    const workspacePath = request.workspacePath ?? settings.workspacePath;

    if (!workspacePath) {
      throw new Error("Choose a workspace folder before sending a chat message.");
    }

    const runtime = createRuntime(database, workspacePath, request.sessionId);

    const response = await runtime.sendMessage(request.message);
    return {
      ...response,
      trace: redactTrace(response.trace)
    };
  });

  ipcMain.handle("squidbot:getLatestTrace", () => getLatestTrace(database));

  ipcMain.handle("squidbot:listTraces", () =>
    database.listTraces(20).map((storedTrace) => redactTrace(parseStoredTrace(storedTrace)))
  );

  ipcMain.handle("squidbot:listRuns", (_event, options?: { limit?: number; offset?: number; sortBy?: string }) => {
    const sortBy = options?.sortBy === "duration" || options?.sortBy === "cost" || options?.sortBy === "createdAt" ? options.sortBy : "createdAt";
    return listRuns(database, {
      limit: options?.limit,
      offset: options?.offset,
      sortBy
    });
  });

  ipcMain.handle("squidbot:getTrace", (_event, runId: string) => getTrace(database, runId));

  ipcMain.handle("squidbot:getTraceMetrics", (_event, runId: string) => {
    const trace = getTrace(database, runId);
    return trace ? computeTraceMetrics(trace) : null;
  });

  ipcMain.handle("squidbot:searchTraceEvents", (_event, options?: Record<string, unknown>) =>
    searchEvents(database, {
      runId: typeof options?.runId === "string" ? options.runId : undefined,
      type: typeof options?.type === "string" ? options.type : undefined,
      provider: typeof options?.provider === "string" ? options.provider : undefined,
      tool: typeof options?.tool === "string" ? options.tool : undefined,
      jobId: typeof options?.jobId === "string" ? options.jobId : undefined,
      teamRunId: typeof options?.teamRunId === "string" ? options.teamRunId : undefined,
      text: typeof options?.text === "string" ? options.text : undefined,
      limit: coerceOptionalNumber(options?.limit)
    })
  );

  ipcMain.handle("squidbot:listConnectors", () => readConnectors(database));

  ipcMain.handle("squidbot:listReflections", () => database.listReflections(10));

  ipcMain.handle("squidbot:listMemories", () => database.listApprovedMemories(50));

  ipcMain.handle("squidbot:approveMemoryCandidate", (_event, reflectionId: string, candidateIndex: number) =>
    approveMemoryCandidate(database, reflectionId, candidateIndex)
  );

  ipcMain.handle("squidbot:listAffordanceGaps", (_event, options?: { status?: string }) => {
    const status =
      options?.status === "all" || options?.status === "open" || options?.status === "resolved" || options?.status === "wontfix"
        ? options.status
        : undefined;
    return database.listAffordanceGaps({ status });
  });

  ipcMain.handle("squidbot:getAffordanceGap", (_event, gapId: string) => database.getAffordanceGap(gapId));

  ipcMain.handle("squidbot:resolveAffordanceGap", (_event, gapId: string, status?: string) =>
    database.resolveAffordanceGap(gapId, status === "wontfix" ? "wontfix" : "resolved")
  );

  ipcMain.handle("squidbot:listSandboxes", (_event, options?: { status?: string }) => {
    const status =
      options?.status === "all" ||
      options?.status === "active" ||
      options?.status === "promoted" ||
      options?.status === "rejected" ||
      options?.status === "destroyed" ||
      options?.status === "failed"
        ? options.status
        : "active";
    return database.listSandboxes({ status });
  });

  ipcMain.handle("squidbot:getSandbox", (_event, sandboxId: string) => database.getSandbox(sandboxId));

  ipcMain.handle("squidbot:approveSandbox", async (_event, sandboxId: string) => {
    return withSandboxLock(sandboxId, async () => {
      const record = database.getSandbox(sandboxId);
      if (!record) {
        throw new Error(`Sandbox not found: ${sandboxId}`);
      }
      if (record.status !== "active") {
        throw new Error(`Sandbox is not active: ${sandboxId} (status: ${record.status})`);
      }
      const manager = new SandboxManager();
      const approvalId = createId("approval");
      const sandboxArg = sandboxFromRecord({
        id: record.id,
        sandboxPath: record.sandboxPath,
        workspacePath: record.workspacePath,
        createdAt: record.createdAt,
        resourceLimits: normalizeSandboxResourceLimits(record.resourceLimits),
        networkPolicy: record.networkPolicy
      });
      try {
        await manager.promote(sandboxArg, approvalId);
        await manager.destroy(sandboxArg);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        database.updateSandbox(record.id, { status: "failed", lastError: message });
        throw error;
      }
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
        promoter: "desktop",
        diffLength: updated.diff.length
      });
      appendSandboxEvent(database, updated, "sandbox.destroyed", {
        sandboxId: updated.id,
        reason: "promoted"
      });
      return updated;
    });
  });

  ipcMain.handle("squidbot:rejectSandbox", async (_event, sandboxId: string) => {
    return withSandboxLock(sandboxId, async () => {
      const record = database.getSandbox(sandboxId);
      if (!record) {
        throw new Error(`Sandbox not found: ${sandboxId}`);
      }
      if (record.status === "rejected" || record.status === "destroyed" || record.status === "promoted") {
        return record;
      }
      const manager = new SandboxManager();
      await manager.destroy(
        sandboxFromRecord({
          id: record.id,
          sandboxPath: record.sandboxPath,
          workspacePath: record.workspacePath,
          createdAt: record.createdAt,
          resourceLimits: normalizeSandboxResourceLimits(record.resourceLimits),
          networkPolicy: record.networkPolicy
        })
      );
      const updated = database.updateSandbox(record.id, {
        status: "rejected",
        destroyedAt: new Date().toISOString()
      });
      appendSandboxEvent(database, updated, "sandbox.destroyed", {
        sandboxId: updated.id,
        reason: "rejected"
      });
      return updated;
    });
  });

  ipcMain.handle("squidbot:listPendingApprovals", (): PendingApprovalDto[] => {
    // Two sources merged into a single queue for the renderer:
    //   - active sandboxes still pending promotion approval (legacy v1 source)
    //   - rows in the pending_approvals table (Task 1.4) — currently only
    //     connector-call kind, but the DTO `kind` discriminator keeps future
    //     kinds (high-risk-tool, memory-deletion, …) easy to slot in.
    const sandboxRows: PendingApprovalDto[] = database
      .listSandboxes({ status: "active" })
      .map((sandbox) => ({
        id: sandbox.id,
        kind: "sandbox-promotion" as const,
        title: `Promote sandbox ${sandbox.id.slice(0, 12)}…`,
        summary: `Workspace: ${sandbox.workspacePath} · ${sandbox.diff.length} bytes of diff`,
        riskLevel: "medium" as const,
        createdAt: sandbox.createdAt,
        payload: { sandboxId: sandbox.id, workspacePath: sandbox.workspacePath }
      }));

    const tableRows: PendingApprovalDto[] = listOpenApprovals(database).map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      summary: row.summary,
      riskLevel: row.riskLevel,
      createdAt: row.createdAt,
      payload: row.payload as PendingApprovalDto["payload"]
    }));

    // Most-recent first across both sources.
    return [...tableRows, ...sandboxRows].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
    );
  });

  ipcMain.handle("squidbot:testConnector", async (_event, connectorName: string) => {
    const registry = new ConnectorRegistry(database);
    installDeveloperWorkflowConnectors(registry);
    const manifest = registry.getConnector(connectorName);
    if (!manifest) {
      return { ok: false, code: "not_found", message: `Connector ${connectorName} not installed.` };
    }

    // Resolve a test endpoint: explicit manifest.testEndpoint OR auto-fallback
    // to the first low-risk no-arg GET op (no path placeholders, permission's
    // riskLevel === "low").
    let testEp: { method: string; path: string } | null = null;
    if (manifest.testEndpoint) {
      testEp = manifest.testEndpoint;
    } else {
      const auto = manifest.endpoints.find((ep) => {
        const perm = manifest.permissions.find((p) => p.name === ep.permission);
        const hasPlaceholders = /\{[^}]+\}/.test(ep.path);
        return ep.method === "GET" && perm?.riskLevel === "low" && !hasPlaceholders;
      });
      if (auto) testEp = { method: auto.method, path: auto.path };
    }
    if (!testEp) {
      return {
        ok: false,
        code: "no_test_op",
        message: "Connector has no eligible no-arg GET; configure manifest.testEndpoint."
      };
    }

    const baseUrl = database.getSetting<string>(`${manifest.name}.baseUrl`);
    const apiKey = database.getSetting<string>(`${manifest.name}.apiKey`) ?? null;
    if (!baseUrl) {
      return { ok: false, code: "not_configured", message: "Base URL not configured." };
    }

    // Synthesize a minimal ConnectorEndpoint for the test call. We don't need
    // real schemas — executeRealHttpCall only reads method, path, and uses the
    // manifest's auth config for headers.
    const syntheticEp = {
      operationId: "__test__",
      method: testEp.method,
      path: testEp.path,
      description: "Connectivity test",
      permission: "low",
      inputSchema: {},
      outputSchema: {},
      dataClassifications: [] as string[]
    };
    const result = await executeRealHttpCall(manifest, syntheticEp, {}, { baseUrl, apiKey });

    // Persist the result to settings so the UI can display status without
    // having to re-test on every render.
    const status = result.ok ? "ok" : result.code;
    const at = new Date().toISOString();
    database.setSetting(`${manifest.name}.lastTest.status`, status);
    database.setSetting(`${manifest.name}.lastTest.at`, at);
    if (!result.ok) {
      database.setSetting(`${manifest.name}.lastTest.message`, result.message);
    } else {
      // Clear stale error message on a successful test.
      database.deleteSetting(`${manifest.name}.lastTest.message`);
    }
    return result.ok
      ? { ok: true, durationMs: result.durationMs }
      : { ok: false, code: result.code, message: result.message, durationMs: result.durationMs };
  });

  ipcMain.handle("squidbot:approveConnectorCall", async (_event, approvalId: string) => {
    return withApprovalLock(approvalId, async () => {
      const row = getApproval(database, approvalId);
      if (!row) return { ok: false, error: "Approval not found" };
      if (row.kind !== "connector-call") return { ok: false, error: `Wrong kind: ${row.kind}` };
      if (row.resolvedAt) return { ok: false, error: `Already ${row.resolution}` };

      const { connectorName, operationId, args } = row.payload as Record<string, unknown>;
      const registry = new ConnectorRegistry(database);
      installDeveloperWorkflowConnectors(registry);
      const manifest = registry.getConnector(connectorName as string);
      if (!manifest) return { ok: false, error: `Connector not found: ${String(connectorName)}` };
      const endpoint = manifest.endpoints.find((ep) => ep.operationId === operationId);
      if (!endpoint) return { ok: false, error: `Endpoint not found: ${String(operationId)}` };

      const baseUrl = database.getSetting<string>(`${manifest.name}.baseUrl`);
      const apiKey = database.getSetting<string>(`${manifest.name}.apiKey`) ?? null;
      if (!baseUrl) return { ok: false, error: "Base URL not configured." };

      const httpResult = await executeRealHttpCall(
        manifest,
        endpoint,
        (args as Record<string, unknown>) ?? {},
        { baseUrl, apiKey }
      );
      resolveApproval(database, approvalId, {
        resolution: "approved",
        result: httpResult.ok
          ? { status: httpResult.status, body: httpResult.body }
          : { error: httpResult.code, message: httpResult.message }
      });
      return httpResult.ok
        ? { ok: true, result: httpResult.body }
        : { ok: false, error: `${httpResult.code}: ${httpResult.message}` };
    });
  });

  ipcMain.handle("squidbot:rejectConnectorCall", async (_event, approvalId: string, reason?: string) => {
    return withApprovalLock(approvalId, async () => {
      // Without these guards a caller could retroactively flip an already
      // approved sandbox-promotion to rejected — corrupting the audit
      // ledger and triggering the resolved-approvals system note to
      // surface a nonsense resolution.
      const row = getApproval(database, approvalId);
      if (!row) return { ok: false as const, error: "Approval not found" };
      if (row.kind !== "connector-call") return { ok: false as const, error: `Wrong kind: ${row.kind}` };
      if (row.resolvedAt) return { ok: false as const, error: `Already ${row.resolution}` };
      resolveApproval(database, approvalId, { resolution: "rejected", reason });
      return { ok: true as const };
    });
  });

  function mcpRowToDto(row: ReturnType<SquidDatabase["getMcpServer"]>): McpServerDto | null {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      command: row.command,
      args: row.args,
      env: redactMcpEnv(row.env),
      riskLevel: row.riskLevel,
      enabled: row.enabled,
      lastConnectedAt: row.lastConnectedAt,
      lastError: row.lastError,
      toolCount: 0
    };
  }

  ipcMain.handle("squidbot:listMcpServers", (): McpServerDto[] => {
    return database.listMcpServers().map((s) => ({
      id: s.id,
      name: s.name,
      command: s.command,
      args: s.args,
      env: redactMcpEnv(s.env),
      riskLevel: s.riskLevel,
      enabled: s.enabled,
      lastConnectedAt: s.lastConnectedAt,
      lastError: s.lastError,
      toolCount: 0
    }));
  });

  ipcMain.handle("squidbot:addMcpServer", async (_event, input: McpServerInputDto): Promise<McpServerDto> => {
    try {
      validateMcpCommand(input.command, input.args ?? []);
    } catch (err) {
      if (err instanceof McpCommandError) throw new Error(err.message);
      throw err;
    }

    const now = new Date().toISOString();
    const saved = database.saveMcpServer({
      id: createId("mcp"),
      name: input.name,
      transport: "stdio",
      command: input.command,
      args: input.args,
      env: input.env,
      riskLevel: input.riskLevel,
      enabled: input.enabled,
      createdAt: now,
      updatedAt: now
    });

    if (saved.enabled) {
      // Spawn in a throwaway registry to validate the server is healthy.
      // The real registration happens lazily inside createRuntime() on the
      // next chat request — no need to share state with the persistent pool.
      const tempRegistry = new ToolRegistry();
      const tempManager = new McpClientManager(tempRegistry);
      try {
        await tempManager.spawnAll([{
          name: saved.name,
          transport: "stdio",
          command: saved.command,
          args: saved.args,
          env: saved.env,
          riskLevel: saved.riskLevel
        }]);
        database.updateMcpServer(saved.name, {
          lastConnectedAt: new Date().toISOString(),
          lastError: null
        });
      } catch (err) {
        database.updateMcpServer(saved.name, {
          lastError: err instanceof Error ? err.message : String(err)
        });
      } finally {
        // Was previously inside the try block — a spawn failure orphaned
        // the temp manager's subprocess(es). Finally guarantees cleanup
        // even when spawnAll throws or the updateMcpServer call below
        // throws an FK violation.
        await tempManager.shutdown().catch(() => undefined);
      }
    }

    const dto = mcpRowToDto(database.getMcpServer(saved.name));
    if (!dto) throw new Error(`MCP server save failed: ${saved.name}`);
    return dto;
  });

  ipcMain.handle("squidbot:updateMcpServer", async (_event, name: string, input: Partial<McpServerInputDto>): Promise<McpServerDto> => {
    if (input.command !== undefined || input.args !== undefined) {
      const existing = database.getMcpServer(name);
      const command = input.command ?? existing?.command ?? "";
      const args = input.args ?? existing?.args ?? [];
      try {
        validateMcpCommand(command, args);
      } catch (err) {
        if (err instanceof McpCommandError) throw new Error(err.message);
        throw err;
      }
    }
    database.updateMcpServer(name, input);
    const dto = mcpRowToDto(database.getMcpServer(name));
    if (!dto) throw new Error(`MCP server not found: ${name}`);
    return dto;
  });

  ipcMain.handle("squidbot:removeMcpServer", async (_event, name: string): Promise<void> => {
    database.deleteMcpServer(name);
  });

  ipcMain.handle("squidbot:testMcpServer", async (_event, input: McpServerInputDto): Promise<McpServerTestResultDto> => {
    const start = Date.now();
    const tempRegistry = new ToolRegistry();
    const manager = new McpClientManager(tempRegistry);
    try {
      await manager.spawnAll([{
        name: input.name,
        transport: "stdio",
        command: input.command,
        args: input.args,
        env: input.env,
        riskLevel: input.riskLevel
      }]);
      const clients = manager.clients();
      const found = clients.find((c) => c.name === input.name);
      if (!found) {
        return { ok: false, code: "spawn_failed", message: "Server failed to spawn." };
      }
      return { ok: true, toolCount: found.tools().length, durationMs: Date.now() - start };
    } catch (err) {
      return { ok: false, code: "test_error", message: err instanceof Error ? err.message : String(err) };
    } finally {
      await manager.shutdown();
    }
  });

  ipcMain.handle("squidbot:listSkills", () => createSkillService(database, paths).listSkills(100));

  ipcMain.handle("squidbot:getSkill", (_event, skillId: string, version?: string) => {
    const service = createSkillService(database, paths);
    const skill = service.getSkill(skillId);
    if (!skill) {
      return null;
    }
    const selectedVersion = service.getVersion(skillId, version);
    return {
      skill,
      version: selectedVersion,
      versions: service.listVersions(skillId),
      evaluations: service.listEvaluations(skillId, selectedVersion?.version)
    };
  });

  ipcMain.handle("squidbot:evaluateSkill", async (_event, skillId: string, version?: string) => evaluateSkill(database, skillId, { version }));

  ipcMain.handle("squidbot:promoteSkill", async (_event, skillId: string, version: string, override?: boolean) => {
    const service = createSkillService(database, paths);
    const evaluation = override ? undefined : await evaluateSkill(database, skillId, { version });
    return service.promote(skillId, version, { evaluation, override: override === true });
  });

  ipcMain.handle("squidbot:rollbackSkill", (_event, skillId: string, version: string) => createSkillService(database, paths).rollback(skillId, version));

  ipcMain.handle("squidbot:deleteSkill", (_event, skillId: string, version?: string) => createSkillService(database, paths).archive(skillId, version));

  ipcMain.handle("squidbot:runSkill", async (_event, skillId: string, request?: { version?: string; workspacePath?: string; test?: boolean }) => {
    const service = createSkillService(database, paths);
    const plan = service.prepareRun(skillId, request?.version);
    const settings = readSettings(database, paths);
    const workspacePath = request?.workspacePath ?? plan.version.testFixtures[0]?.repoPath ?? settings.workspacePath;
    if (!workspacePath) {
      throw new Error("Skill run requires a workspace or fixture repo.");
    }
    const result = await createRuntime(database, workspacePath).runTask(plan.task, {
      testCommand: plan.testCommand,
      skillCall: {
        skillId,
        version: plan.version.version,
        testMode: request?.test === true
      }
    });
    service.appendSkillRunEvent({
      runId: result.runId,
      skillId,
      version: plan.version.version,
      workspacePath,
      testMode: request?.test === true,
      traceId: result.trace.id
    });
    return {
      runId: result.runId,
      finalSummary: result.finalSummary,
      trace: redactTrace(result.trace)
    };
  });

  ipcMain.handle("squidbot:listJobs", (_event, options?: { status?: string; limit?: number }) => {
    const status =
      options?.status === "active" ||
      options?.status === "paused" ||
      options?.status === "running" ||
      options?.status === "completed" ||
      options?.status === "all"
        ? options.status
        : undefined;
    return createScheduler(database, paths).listJobs({ status, limit: coerceOptionalNumber(options?.limit) ?? 100 });
  });

  ipcMain.handle("squidbot:getJob", (_event, jobId: string) => {
    try {
      return createScheduler(database, paths).showJob(jobId);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Job not found")) {
        return null;
      }
      throw error;
    }
  });

  ipcMain.handle("squidbot:createJob", (_event, request: JobCreateRequestDto) => {
    const workspacePath =
      typeof request.workspacePath === "string" && request.workspacePath.trim()
        ? path.resolve(request.workspacePath)
        : database.getSetting<string>("workspacePath") ?? null;
    return createScheduler(database, paths).createJob({
      name: String(request.name ?? ""),
      type: request.type,
      refId: String(request.refId ?? ""),
      version: request.version ?? null,
      schedule: String(request.schedule ?? ""),
      workspacePath,
      testCommand: request.testCommand ?? null,
      testMode: request.testMode === true
    });
  });

  ipcMain.handle("squidbot:pauseJob", (_event, jobId: string) => createScheduler(database, paths).pauseJob(jobId));
  ipcMain.handle("squidbot:resumeJob", (_event, jobId: string) => createScheduler(database, paths).resumeJob(jobId));
  ipcMain.handle("squidbot:removeJob", (_event, jobId: string) => createScheduler(database, paths).removeJob(jobId));
  ipcMain.handle("squidbot:runJobNow", async (_event, jobId: string) => createScheduler(database, paths).runNow(jobId));

  ipcMain.handle("squidbot:listTeamRoles", () => {
    const registry = new RoleRegistry(database);
    registry.installDefaults();
    return registry.list();
  });

  ipcMain.handle("squidbot:listTeams", () => createTeamCoordinator(database).listTeams());

  ipcMain.handle("squidbot:getTeam", (_event, teamId: string) => {
    const coordinator = createTeamCoordinator(database);
    const team = coordinator.getTeam(teamId);
    return team ? { team, runs: coordinator.listTeamRuns(teamId, 50) } : null;
  });

  ipcMain.handle("squidbot:createTeam", (_event, request: { name: string; roles: string[]; description?: string }) => {
    const registry = new RoleRegistry(database);
    registry.installDefaults();
    const roles = Array.isArray(request.roles) && request.roles.length > 0 ? request.roles : defaultTeamManifest.roles;
    const manifest = validateTeamManifest(
      {
        ...defaultTeamManifest,
        id: normalizeTeamId(request.name || defaultTeamManifest.name),
        name: request.name || defaultTeamManifest.name,
        description: request.description || defaultTeamManifest.description,
        roles,
        coordinatorRoleId: roles.includes("coordinator") ? "coordinator" : roles[0]
      },
      registry.list().map((role) => role.id)
    );
    return createTeamCoordinator(database).createTeam(manifest);
  });

  ipcMain.handle("squidbot:listTeamRuns", (_event, teamId?: string) => createTeamCoordinator(database).listTeamRuns(teamId, 50));

  ipcMain.handle("squidbot:getTeamRun", (_event, teamRunId: string) => {
    const store = new TeamStore(database);
    const run = store.getTeamRun(teamRunId);
    if (!run) {
      return null;
    }
    return {
      run,
      subtasks: store.listSubtasks(teamRunId),
      blackboardEntries: store.listBlackboardEntries({ teamRunId }),
      messages: store.listMessages(teamRunId),
      conflicts: store.listConflicts(teamRunId, "all"),
      handoffs: store.listHandoffs({ teamRunId, status: "all" })
    };
  });

  ipcMain.handle("squidbot:runTeamTask", async (_event, request: TeamRunRequestDto) => {
    if (!request || typeof request !== "object") {
      throw new Error("Team run requires a request object.");
    }
    const teamId = typeof request.teamId === "string" ? request.teamId.trim() : "";
    if (!teamId) {
      throw new Error("Team run requires a teamId.");
    }
    const rawTask = typeof request.task === "string" ? request.task : "";
    const task = rawTask.trim().slice(0, 8000);
    if (!task) {
      throw new Error("Team run requires a non-empty task.");
    }
    const mode =
      request.mode === "dry-run" || request.mode === "sandbox" || request.mode === "approved-write"
        ? request.mode
        : "sandbox";
    const settings = readSettings(database, paths);
    const workspacePath =
      typeof request.workspacePath === "string" && request.workspacePath.trim()
        ? path.resolve(request.workspacePath)
        : settings.workspacePath;
    if (!workspacePath) {
      throw new Error("Team run requires a selected workspace or explicit workspace path.");
    }
    return createTeamCoordinator(database).runTeamTask({
      teamId,
      workspacePath,
      task,
      mode
    });
  });

  ipcMain.handle("squidbot:listTeamHandoffs", (_event, status?: string) => {
    const store = new TeamStore(database);
    const normalized = status === "all" || status === "open" || status === "answered" || status === "canceled" ? status : "open";
    return store.listHandoffs({ status: normalized });
  });

  ipcMain.handle("squidbot:answerTeamHandoff", (_event, handoffId: string, responseText: string) =>
    new TeamStore(database).answerHandoff(handoffId, responseText, { source: "desktop" })
  );

  ipcMain.handle("squidbot:listEvalDatasets", () => new EvalResultStore(database).listDatasets());

  ipcMain.handle("squidbot:getEvalDataset", (_event, datasetId: string) => {
    const store = new EvalResultStore(database);
    const dataset = store.getDataset(datasetId);
    return dataset ? { dataset, tasks: store.listTasks(datasetId) } : null;
  });

  ipcMain.handle("squidbot:listEvalRuns", () => new EvalResultStore(database).listEvalRuns(50));

  ipcMain.handle("squidbot:getEvalRunDetail", (_event, evalRunId: string) => {
    const store = new EvalResultStore(database);
    const evalRun = store.getEvalRun(evalRunId);
    return evalRun
      ? {
          evalRun,
          taskResults: store.listTaskResults(evalRunId),
          comparisons: store.listComparisonsForRun(evalRunId)
        }
      : null;
  });

  ipcMain.handle("squidbot:listSkillVariants", (_event, skillId?: string) => {
    const store = new SkillVariantStore(database);
    return typeof skillId === "string" && skillId.trim() ? store.listVariantsForSkill(skillId) : store.listVariants(100);
  });

  ipcMain.handle("squidbot:getSkillVariant", (_event, variantId: string) => {
    const variants = new SkillVariantStore(database);
    const store = new EvalResultStore(database);
    const variant = variants.getVariant(variantId);
    return variant
      ? {
          variant,
          staticCheck: store.latestStaticCheck(variant.id),
          canary: store.getCanaryForVariant(variant.id)
        }
      : null;
  });

  ipcMain.handle("squidbot:listEvalLeaderboard", (_event, options?: { datasetId?: string; domain?: string }) =>
    new EvalResultStore(database).listLeaderboard({
      datasetId: typeof options?.datasetId === "string" ? options.datasetId : undefined,
      domain: typeof options?.domain === "string" ? options.domain : undefined,
      limit: 50
    })
  );

  ipcMain.handle("squidbot:listMessagingAdapters", () => new MessagingAdapterRegistry(createMessagingStore(database)).list());

  ipcMain.handle("squidbot:listMessagingMatrix", (_event, platform?: string) =>
    typeof platform === "string" && platform.trim() ? getPlatformMatrixEntry(platform) : listPlatformMatrix()
  );

  ipcMain.handle("squidbot:listMessagingChannels", (_event, platform?: string) =>
    createMessagingStore(database).listChannels(typeof platform === "string" && platform.trim() ? platform : undefined)
  );

  ipcMain.handle("squidbot:addMessagingChannel", (_event, request: Partial<MessagingChannelDto>) => {
    const store = createMessagingStore(database);
    const platform = typeof request.platform === "string" && request.platform.trim() ? request.platform : "slack";
    const adapter = store.getAdapterByPlatform(platform);
    if (!adapter) {
      throw new Error(`Messaging adapter not installed for platform: ${platform}`);
    }
    const externalChannelId =
      typeof request.externalChannelId === "string" && request.externalChannelId.trim() ? request.externalChannelId.trim() : "C_FIXTURE";
    return store.createChannel({
      adapterId: adapter.id,
      platform,
      externalChannelId,
      displayName: typeof request.displayName === "string" ? request.displayName : externalChannelId,
      channelType: normalizeMessagingChannelType(request.channelType, platform)
    });
  });

  ipcMain.handle("squidbot:listMessagingAllowlist", (_event, platform?: string) =>
    createMessagingStore(database).listAllowlistRules(typeof platform === "string" && platform.trim() ? platform : undefined)
  );

  ipcMain.handle("squidbot:addMessagingAllowlistRule", (_event, request: Partial<MessagingAllowlistRuleDto>) =>
    createMessagingStore(database).createAllowlistRule({
      platform: typeof request.platform === "string" && request.platform.trim() ? request.platform : "slack",
      externalUserId: typeof request.externalUserId === "string" && request.externalUserId.trim() ? request.externalUserId.trim() : null,
      externalChannelId: typeof request.externalChannelId === "string" && request.externalChannelId.trim() ? request.externalChannelId.trim() : null,
      ruleType:
        request.ruleType === "allowChannel" || request.ruleType === "blockUser" || request.ruleType === "blockChannel" || request.ruleType === "allowDomain"
          ? request.ruleType
          : "allowUser",
      riskLimit: request.riskLimit === "medium" || request.riskLimit === "high" ? request.riskLimit : "low"
    })
  );

  ipcMain.handle("squidbot:removeMessagingAllowlistRule", (_event, ruleId: string) => createMessagingStore(database).removeAllowlistRule(ruleId));

  ipcMain.handle("squidbot:listMessagingDeliveryRules", (_event, triggerType?: MessagingDeliveryRuleDto["triggerType"]) =>
    new DeliveryRouter(createMessagingStore(database)).listRules(triggerType)
  );

  ipcMain.handle("squidbot:addMessagingDeliveryRule", (_event, request: Partial<MessagingDeliveryRuleDto>) =>
    new DeliveryRouter(createMessagingStore(database)).addRule({
      name: typeof request.name === "string" && request.name.trim() ? request.name : "Messaging delivery",
      triggerType: normalizeMessagingTrigger(request.triggerType),
      targetChannelId: requireNonEmptyString(request.targetChannelId, "Delivery target channel is required.")
    })
  );

  ipcMain.handle("squidbot:removeMessagingDeliveryRule", (_event, ruleId: string) => new DeliveryRouter(createMessagingStore(database)).removeRule(ruleId));

  ipcMain.handle("squidbot:listMessagingEvents", (_event, options?: { platform?: string; runId?: string; limit?: number }) =>
    createMessagingStore(database).listEvents({
      platform: typeof options?.platform === "string" && options.platform.trim() ? options.platform : undefined,
      runId: typeof options?.runId === "string" && options.runId.trim() ? options.runId : undefined,
      limit: coerceOptionalNumber(options?.limit) ?? 100
    })
  );

  ipcMain.handle("squidbot:listMessagingSessions", (_event, platform?: string) =>
    createMessagingStore(database).listSessions(typeof platform === "string" && platform.trim() ? platform : undefined)
  );

  ipcMain.handle("squidbot:listMessagingIdentities", (_event, platform?: string) =>
    createMessagingStore(database).listIdentities(typeof platform === "string" && platform.trim() ? platform : undefined)
  );

  ipcMain.handle("squidbot:sendLocalWebMessage", async (_event, text: string) => {
    const gateway = createMessagingGateway(database, paths);
    const store = gateway.store;
    store.upsertIdentity({
      platform: "localWeb",
      externalUserId: "local-web-user",
      displayName: "Local Web User",
      trustLevel: "trusted",
      metadata: { source: "desktop-local-web" }
    });
    store.createAllowlistRule({
      platform: "localWeb",
      externalUserId: "local-web-user",
      externalChannelId: "local-web",
      ruleType: "allowUser",
      riskLimit: "medium"
    });
    const raw = {
      platform: "localWeb",
      fixtureAllow: true,
      channelId: "local-web",
      userId: "local-web-user",
      text
    };
    const event = await gateway.ingest(raw, "adapter_localWeb");
    const route = await gateway.route(event);
    return { event, route };
  });

  ipcMain.handle("squidbot:bootstrapGovernance", () => createGovernance(database).bootstrap());

  ipcMain.handle("squidbot:getGovernanceStatus", () => {
    const governance = createGovernance(database);
    governance.identities.bootstrap();
    return governance.status();
  });

  ipcMain.handle("squidbot:listGovernanceUsers", () => {
    const governance = createGovernance(database);
    governance.identities.bootstrap();
    return governance.identities.listUsers();
  });

  ipcMain.handle("squidbot:listGovernanceRoles", () => {
    const governance = createGovernance(database);
    governance.identities.bootstrap();
    return governance.identities.listRoles();
  });

  ipcMain.handle("squidbot:simulateGovernancePolicy", (_event, request: { userId: string; action: string; resource: string; riskLevel?: string }) => {
    const governance = createGovernance(database);
    governance.identities.bootstrap();
    const [resourceType = "resource", resourceId = request.resource] = request.resource.split(":");
    return governance.decide({
      actor: { type: "user", id: request.userId || DEFAULT_ADMIN_USER_ID },
      action: request.action,
      resource: { type: resourceType, id: resourceId },
      context: { source: "desktop", riskLevel: request.riskLevel ?? "low" }
    });
  });

  ipcMain.handle("squidbot:listGovernancePolicyDecisions", () => createGovernance(database).policies.listDecisions(50));
  ipcMain.handle("squidbot:listGovernanceSecrets", () => createGovernance(database).secrets.listSecrets(DEFAULT_TENANT_ID));
  ipcMain.handle("squidbot:listGovernanceAudit", () => createGovernance(database).audit.latest(50, DEFAULT_TENANT_ID));
  ipcMain.handle("squidbot:listGovernanceRetentionPolicies", () => createGovernance(database).retention.listPolicies(DEFAULT_TENANT_ID));
  ipcMain.handle("squidbot:listGovernanceN8nIntegrations", () => createGovernance(database).n8n.listIntegrations(DEFAULT_TENANT_ID));

  ipcMain.handle("squidbot:listMemoryGraphNodes", () => new MemoryGraphStore(database).listNodes({ limit: 100 }));

  ipcMain.handle("squidbot:searchMemoryGraph", (_event, query: string, mode: string, topK: number | undefined) => {
    const store = new MemoryGraphStore(database);
    const limit = Number.isFinite(topK) && topK ? Math.max(1, Math.min(50, Math.floor(topK))) : 10;
    if (mode === "fts") {
      return store.searchFTS(query, limit);
    }
    if (mode === "vector") {
      return store.searchVector(query, limit);
    }
    return store.hybridSearch(query, limit);
  });

  ipcMain.handle("squidbot:getMemoryGraphNode", (_event, nodeId: string): MemoryGraphDetailDto | null => {
    const store = new MemoryGraphStore(database);
    const node = store.getNode(nodeId, { includeArchived: true });
    if (!node) {
      return null;
    }
    const traversal = store.traverse(nodeId, 1);
    return {
      node,
      edges: store.listEdgesForNode(nodeId),
      relatedNodes: traversal.nodes.filter((item) => item.id !== nodeId)
    };
  });

  ipcMain.handle("squidbot:createMemoryGraphNode", (_event, request: Record<string, unknown>) => {
    return new MemoryGraphStore(database).createNode({
      type: String(request.type ?? "fact"),
      title: String(request.title ?? ""),
      body: String(request.body ?? ""),
      confidence: coerceOptionalNumber(request.confidence),
      importance: coerceOptionalNumber(request.importance),
      sensitivity: typeof request.sensitivity === "string" ? request.sensitivity : "public"
    });
  });

  ipcMain.handle("squidbot:updateMemoryGraphNode", (_event, nodeId: string, request: Record<string, unknown>) => {
    return new MemoryGraphStore(database).updateNode(nodeId, {
      title: typeof request.title === "string" ? request.title : undefined,
      body: typeof request.body === "string" ? request.body : undefined,
      confidence: coerceOptionalNumber(request.confidence),
      importance: coerceOptionalNumber(request.importance),
      sensitivity: typeof request.sensitivity === "string" ? request.sensitivity : undefined
    });
  });

  ipcMain.handle("squidbot:archiveMemoryGraphNode", (_event, nodeId: string) => new MemoryGraphStore(database).archiveNode(nodeId));
  ipcMain.handle("squidbot:deleteMemoryGraphNode", (_event, nodeId: string) => new MemoryGraphStore(database).deleteNode(nodeId));
  ipcMain.handle("squidbot:mergeMemoryGraphNodes", (_event, targetNodeId: string, sourceNodeId: string) =>
    new MemoryGraphStore(database).mergeNodes(targetNodeId, sourceNodeId)
  );

  // ---------------- Blueprints ----------------
  // Phase 2 AI Studio Blueprints: install / get / list / export / delete /
  // listVersions. The registry wraps SquidDatabase via the structural
  // BlueprintStore interface — no nominal coupling — so future stores can
  // implement the same shape (e.g. a remote registry sync) without changing
  // these handlers.
  const blueprintRegistry = new BlueprintRegistry(database);

  ipcMain.handle("squidbot:listBlueprints", () => {
    return { blueprints: blueprintRegistry.list() };
  });

  ipcMain.handle("squidbot:getBlueprint", (_event, slug: string) => {
    const manifest = blueprintRegistry.get(slug);
    if (!manifest) throw new Error(`Blueprint not found: ${slug}`);
    return { manifest };
  });

  ipcMain.handle("squidbot:installBlueprint", (_event, manifest: unknown, actor?: string) => {
    const result = blueprintRegistry.install(
      manifest as Parameters<BlueprintRegistry["install"]>[0],
      actor ?? "user"
    );
    if (!result.ok) {
      throw new Error(`Invalid Blueprint: ${result.errors.join("; ")}`);
    }
    return { id: result.id, slug: result.manifest.slug };
  });

  ipcMain.handle("squidbot:exportBlueprint", (_event, slug: string) => {
    const manifest = blueprintRegistry.get(slug);
    if (!manifest) throw new Error(`Blueprint not found: ${slug}`);
    return { json: JSON.stringify(manifest, null, 2) };
  });

  ipcMain.handle("squidbot:deleteBlueprint", (_event, slug: string, actor?: string) => {
    blueprintRegistry.uninstall(slug, actor ?? "user");
    return { ok: true };
  });

  ipcMain.handle("squidbot:listBlueprintVersions", (_event, slug: string) => {
    return { versions: blueprintRegistry.versions(slug) };
  });

  // ---------------- Identity / Profile / Trust / Onboarding ----------------

  // Capability snapshot needs a tool registry built like the CLI's
  // `createToolRegistryForReporting` so the GUI sees the same surface as the CLI.
  const reportingToolRegistry = (): ToolRegistry => {
    const registry = new ToolRegistry();
    registerWorkspaceTools(registry);
    registerTerminalTools(registry);
    registerTestTools(registry);
    return registry;
  };

  ipcMain.handle("squidbot:getIdentityReport", () => {
    installSeedProfiles(database);
    return buildIdentityReport(database, reportingToolRegistry());
  });

  ipcMain.handle("squidbot:listEnterpriseProfiles", () => {
    installSeedProfiles(database);
    return listProfiles(database);
  });

  ipcMain.handle("squidbot:getActiveEnterpriseProfile", () => {
    installSeedProfiles(database);
    return getActiveProfile(database);
  });

  ipcMain.handle("squidbot:activateEnterpriseProfile", (_event, profileId: string) => {
    installSeedProfiles(database);
    return activateProfile(database, profileId);
  });

  ipcMain.handle(
    "squidbot:createEnterpriseProfile",
    (_event, request: EnterpriseProfileCreateRequestDto) => {
      installSeedProfiles(database);
      const sensitivity = request.sensitivity ?? "standard";
      const profile = createCustomProfile(database, {
        industry: request.industry ?? "general_business",
        displayName: request.displayName,
        businessUnit: null,
        role: request.role ?? null,
        primarySystems: request.primarySystems ?? [],
        primaryChannels: request.primaryChannels ?? [],
        sensitivity,
        vocabulary: request.vocabulary ?? {},
        branding: { productName: `SquidBot for ${request.displayName}` },
        policyPacks: request.policyPacks ?? ["developer-safe-default", "secrets-redaction"],
        defaultSkills: [],
        defaultConnectors: [],
        readOnlyByDefault:
          request.readOnlyByDefault ??
          (sensitivity === "regulated" || sensitivity === "air-gapped"),
        metadata: { customCreated: true, createdVia: "desktop" },
        activate: request.activate === true
      });
      return profile;
    }
  );

  ipcMain.handle("squidbot:getTrustReport", () => {
    installSeedProfiles(database);
    const identityReport = buildIdentityReport(database, reportingToolRegistry());
    return buildTrustReport({ database, identityReport });
  });

  ipcMain.handle("squidbot:getTrustDigest", () => {
    installSeedProfiles(database);
    const identityReport = buildIdentityReport(database, reportingToolRegistry());
    const report = buildTrustReport({ database, identityReport });
    return digestTrustReport(report);
  });

  ipcMain.handle("squidbot:buildCompliancePacket", (_event, framework: "soc2" | "gdpr") => {
    if (framework !== "soc2" && framework !== "gdpr") {
      throw new Error(`Unsupported framework: ${framework}`);
    }
    installSeedProfiles(database);
    const identityReport = buildIdentityReport(database, reportingToolRegistry());
    const trustReport = buildTrustReport({ database, identityReport });
    return buildCompliancePacket({ database, trustReport, framework });
  });

  // Onboarding wizard endpoints — these power the "live preview" UI.
  // The renderer calls `inferOnboarding` after each answer change to refresh
  // the preview panel, then calls `commitOnboarding` once when the user
  // confirms the result.
  ipcMain.handle("squidbot:getOnboardingQuestions", () => {
    return STANDARD_QUESTIONS.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      hint: question.hint,
      kind: question.kind,
      choices: question.choices,
      required: question.required
    }));
  });

  ipcMain.handle("squidbot:inferOnboarding", (_event, answers: OnboardingAnswerDto[]) => {
    return inferOnboardingProfile(coerceOnboardingAnswers(answers));
  });

  ipcMain.handle(
    "squidbot:commitOnboarding",
    (_event, answers: OnboardingAnswerDto[], options?: { activate?: boolean }) => {
      installSeedProfiles(database);
      const inference = inferOnboardingProfile(coerceOnboardingAnswers(answers));
      const committed = commitOnboarding(database, inference, {
        activate: options?.activate ?? true
      });
      return { inference, committed };
    }
  );

  ipcMain.handle(
    "squidbot:submitFeedback",
    (_event, request: { message: string; page?: string; sentiment?: "positive" | "negative" | "neutral" }) => {
      const message = typeof request?.message === "string" ? request.message.trim() : "";
      if (!message) {
        throw new Error("Feedback message is required.");
      }
      if (message.length > 4000) {
        throw new Error("Feedback message exceeds 4000 characters.");
      }
      const sentiment =
        request.sentiment === "positive" || request.sentiment === "negative" ? request.sentiment : "neutral";
      const feedbackId = createId("feedback");
      const submittedAt = new Date().toISOString();
      database.appendEvent({
        id: createId("evt"),
        timestamp: submittedAt,
        sessionId: "session_desktop_feedback",
        type: "user.feedback.submitted",
        data: {
          runId: feedbackId,
          message,
          page: typeof request.page === "string" ? request.page.slice(0, 80) : null,
          sentiment,
          source: "desktop"
        }
      });
      return { ok: true, feedbackId, submittedAt };
    }
  );

  ipcMain.handle("squidbot:listSquidbotCommands", () => SQUIDBOT_COMMAND_REGISTRY);

  ipcMain.handle("squidbot:runSquidbotCommand", async (_event, commandId: SquidbotCommandId): Promise<CommandRunResultDto> => {
    const descriptor = SQUIDBOT_COMMAND_REGISTRY.find((entry) => entry.id === commandId);
    if (!descriptor) {
      throw new Error(`Unknown SquidBot command: ${String(commandId)}`);
    }
    installSeedProfiles(database);
    const startedAt = new Date().toISOString();
    const tools = reportingToolRegistry();
    const identityReport = buildIdentityReport(database, tools);

    let output = "";
    let data: unknown = undefined;
    try {
      switch (descriptor.id) {
        case "whoami":
          output = describeForWhoami(identityReport);
          data = identityReport;
          break;
        case "trust.summary": {
          const report = buildTrustReport({ database, identityReport });
          output = summarizeTrustReport(report);
          data = report;
          break;
        }
        case "trust.digest": {
          const report = buildTrustReport({ database, identityReport });
          const digest = digestTrustReport(report);
          output = [
            `${digest.agentName} v${digest.agentVersion}`,
            `Profile: ${digest.profile ?? "(none)"}`,
            `Health: ${digest.healthLabel} (${digest.healthScore}/100)`,
            `Audit chain valid: ${digest.auditChainValid ? "yes" : "NO"}`,
            `Schema: ${digest.schemaVersion}`,
            `Hash: ${digest.hash}`,
            `Generated: ${digest.generatedAt}`
          ].join("\n");
          data = digest;
          break;
        }
        case "trust.report": {
          const report = buildTrustReport({ database, identityReport });
          output = formatTrustReportMarkdown(report);
          data = report;
          break;
        }
        case "trust.packet.soc2":
        case "trust.packet.gdpr": {
          const framework = descriptor.id.endsWith("soc2") ? "soc2" : "gdpr";
          const report = buildTrustReport({ database, identityReport });
          const packet = buildCompliancePacket({ database, trustReport: report, framework });
          output = packet.markdown;
          data = packet;
          break;
        }
        case "profile.list": {
          const profiles = listProfiles(database);
          const active = getActiveProfile(database);
          const lines = ["Enterprise profiles:"];
          for (const profile of profiles) {
            const marker = profile.isActive ? "*" : " ";
            lines.push(
              `${marker} ${profile.id}  ${profile.displayName}  (${profile.industry}, sensitivity=${profile.sensitivity}${profile.readOnlyByDefault ? ", read-only" : ""})`
            );
          }
          lines.push("");
          lines.push(active ? `Active profile: ${active.displayName} (${active.id})` : "No active profile.");
          output = lines.join("\n");
          data = { profiles, active };
          break;
        }
        case "profile.current": {
          const active = getActiveProfile(database);
          if (!active) {
            output = "No active enterprise profile.";
            data = null;
          } else {
            output = [
              `${active.displayName}  (${active.id})`,
              `Industry: ${active.industry}`,
              `Sensitivity: ${active.sensitivity}`,
              `Read-only by default: ${active.readOnlyByDefault ? "yes" : "no"}`,
              `Policy packs: ${active.policyPacks.join(", ") || "(none)"}`,
              `Default skills: ${active.defaultSkills.join(", ") || "(none)"}`,
              `Default connectors: ${active.defaultConnectors.join(", ") || "(none)"}`
            ].join("\n");
            data = active;
          }
          break;
        }
        case "memory.list": {
          const memories = database.listApprovedMemories(50);
          if (memories.length === 0) {
            output = "No approved memories yet.";
          } else {
            const lines = ["Approved memories"];
            for (const memory of memories) {
              lines.push(`- ${memory.id}`);
              lines.push(`  type: ${memory.type}`);
              lines.push(`  title: ${memory.title}`);
              lines.push(`  approved: ${memory.approvedAt ?? "(pending)"}`);
            }
            output = lines.join("\n");
          }
          data = memories;
          break;
        }
        case "doctor": {
          const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
          const nodeOk = Number(process.version.slice(1).split(".")[0]) >= 20;
          checks.push({ name: "node", ok: nodeOk, detail: process.version });
          try {
            const migrationCount = (database.db.prepare("SELECT COUNT(*) as count FROM schema_migrations").get() as { count: number }).count;
            checks.push({ name: "database", ok: migrationCount >= 16, detail: `${migrationCount} migrations` });
          } catch (error) {
            checks.push({ name: "database", ok: false, detail: error instanceof Error ? error.message : String(error) });
          }
          const fixturePath = resolveDemoWorkspace(database, paths);
          const fixtureOk = fs.existsSync(path.join(fixturePath, "calculator.py")) &&
            fs.readFileSync(path.join(fixturePath, "calculator.py"), "utf8").includes("return a - b");
          checks.push({
            name: "verticalSliceFixture",
            ok: fixtureOk,
            detail: fixtureOk ? "examples/buggy-python ready" : "calculator fixture missing or already fixed"
          });
          const governance = createGovernance(database);
          try {
            governance.bootstrap();
            checks.push({ name: "governance", ok: true, detail: "bootstrap succeeded" });
          } catch (error) {
            checks.push({ name: "governance", ok: false, detail: error instanceof Error ? error.message : String(error) });
          }
          checks.push({ name: "appDataDir", ok: fs.existsSync(paths.appDataDir), detail: paths.appDataDir });
          const allOk = checks.every((check) => check.ok);
          output = checks.map((check) => `${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`).join("\n");
          data = { ok: allOk, checks };
          if (!allOk) {
            return {
              id: descriptor.id,
              displayCommand: descriptor.displayCommand,
              startedAt,
              completedAt: new Date().toISOString(),
              ok: false,
              output,
              data
            };
          }
          break;
        }
        case "demo": {
          const workspace = resolveDemoWorkspace(database, paths);
          const runtime = createRuntime(database, workspace, createId("session"));
          const result = await runtime.runTask("Fix calculator add function", { testCommand: "pytest" });
          const sandboxes = database.listSandboxes({ status: "active" });
          const trace = getLatestTrace(database);
          output = [
            "Vertical slice demo complete.",
            `Run: ${result.runId}`,
            `Summary: ${result.finalSummary}`,
            `Active sandboxes: ${sandboxes.length}`,
            trace ? `Latest trace: ${trace.id}` : "No trace recorded yet."
          ].join("\n");
          data = {
            demo: "vertical-slice",
            workspace,
            runId: result.runId,
            summary: result.finalSummary,
            activeSandboxes: sandboxes.length,
            latestTraceId: trace?.id ?? null
          };
          break;
        }
        default: {
          const _exhaustive: never = descriptor.id;
          throw new Error(`Unhandled command: ${String(_exhaustive)}`);
        }
      }
    } catch (error) {
      return {
        id: descriptor.id,
        displayCommand: descriptor.displayCommand,
        startedAt,
        completedAt: new Date().toISOString(),
        ok: false,
        output: error instanceof Error ? error.message : String(error)
      };
    }

    return {
      id: descriptor.id,
      displayCommand: descriptor.displayCommand,
      startedAt,
      completedAt: new Date().toISOString(),
      ok: true,
      output,
      data
    };
  });
}

const sandboxLocks = new Map<string, Promise<unknown>>();

async function withSandboxLock<T>(sandboxId: string, fn: () => Promise<T>): Promise<T> {
  const prior = sandboxLocks.get(sandboxId) ?? Promise.resolve();
  const next = prior.then(fn, fn);
  sandboxLocks.set(sandboxId, next);
  try {
    return (await next) as T;
  } finally {
    if (sandboxLocks.get(sandboxId) === next) {
      sandboxLocks.delete(sandboxId);
    }
  }
}

function coerceOnboardingAnswers(answers: OnboardingAnswerDto[]): OnboardingAnswer[] {
  if (!Array.isArray(answers)) return [];
  return answers.map((answer) => ({
    questionId: String(answer.questionId ?? ""),
    rawValue: String(answer.rawValue ?? ""),
    skipped: Boolean(answer.skipped)
  }));
}

function coerceModelAccountInput(raw: unknown): ModelAccountInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid model account input.");
  }
  const source = raw as Record<string, unknown>;
  const name = typeof source.name === "string" ? source.name.trim() : "";
  if (!name) {
    throw new Error("Model account name is required.");
  }

  const out: ModelAccountInput = { name };

  if (typeof source.id === "string" && source.id.trim()) {
    out.id = source.id.trim();
  }
  if (typeof source.providerKind === "string" && source.providerKind.trim()) {
    out.providerKind = source.providerKind.trim() as ModelAccountInput["providerKind"];
  }
  if (source.apiUrl !== undefined) {
    if (typeof source.apiUrl !== "string") {
      throw new Error("apiUrl must be a string.");
    }
    const trimmed = source.apiUrl.trim();
    if (trimmed) {
      const err = validateModelAccountApiUrl(trimmed);
      if (err) {
        throw new Error(err);
      }
      out.apiUrl = trimmed;
    }
  }
  if (source.apiKey === null) {
    out.apiKey = null;
  } else if (typeof source.apiKey === "string") {
    out.apiKey = source.apiKey;
  }
  if (typeof source.apiModel === "string") {
    out.apiModel = source.apiModel.trim();
  }
  if (typeof source.costPerToken === "number" && Number.isFinite(source.costPerToken) && source.costPerToken >= 0) {
    out.costPerToken = source.costPerToken;
  }
  if (source.dailyBudgetTokens === null) {
    out.dailyBudgetTokens = null;
  } else if (typeof source.dailyBudgetTokens === "number" && Number.isFinite(source.dailyBudgetTokens) && source.dailyBudgetTokens > 0) {
    out.dailyBudgetTokens = source.dailyBudgetTokens;
  }
  if (source.description === null) {
    out.description = null;
  } else if (typeof source.description === "string") {
    out.description = source.description;
  }
  if (typeof source.activate === "boolean") {
    out.activate = source.activate;
  }

  return out;
}

function resolveDemoWorkspace(database: SquidDatabase, paths: DesktopAppPaths): string {
  const configured = database.getSetting<string>("workspacePath");
  if (configured && fs.existsSync(path.join(configured, "calculator.py"))) {
    return configured;
  }
  const candidates = [
    path.join(process.cwd(), "examples/buggy-python"),
    path.join(process.cwd(), "../../examples/buggy-python"),
    path.join(paths.appDataDir, "examples/buggy-python")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "calculator.py"))) {
      return candidate;
    }
  }
  throw new Error("Demo workspace not found. Set workspacePath to examples/buggy-python.");
}

/**
 * Whitelist of "safe" SquidBot CLI-equivalent commands the renderer can run
 * from the in-app terminal panel. Every entry routes to a deterministic IPC
 * handler (no shell exec, no arbitrary args), keeping the surface auditable.
 */
const SQUIDBOT_COMMAND_REGISTRY: SquidbotCommandDescriptorDto[] = [
  {
    id: "whoami",
    label: "whoami",
    description: "Show the current SquidBot identity + active profile + capabilities.",
    displayCommand: "npm run whoami",
    outputIsMarkdown: false
  },
  {
    id: "trust.summary",
    label: "trust summary",
    description: "One-line live security posture summary.",
    displayCommand: "npm run trust -- summary",
    outputIsMarkdown: false
  },
  {
    id: "trust.report",
    label: "trust report",
    description: "Full markdown Trust & Security report.",
    displayCommand: "npm run trust -- report",
    outputIsMarkdown: true
  },
  {
    id: "trust.digest",
    label: "trust digest",
    description: "Shareable signed digest of current security posture.",
    displayCommand: "npm run trust -- digest",
    outputIsMarkdown: false
  },
  {
    id: "trust.packet.soc2",
    label: "trust packet (SOC2)",
    description: "Generate a SOC2 compliance evidence packet.",
    displayCommand: "npm run trust -- packet --framework=soc2",
    outputIsMarkdown: true
  },
  {
    id: "trust.packet.gdpr",
    label: "trust packet (GDPR)",
    description: "Generate a GDPR compliance evidence packet.",
    displayCommand: "npm run trust -- packet --framework=gdpr",
    outputIsMarkdown: true
  },
  {
    id: "profile.list",
    label: "profile list",
    description: "List all enterprise profiles and which one is active.",
    displayCommand: "npm run profile -- list",
    outputIsMarkdown: false
  },
  {
    id: "profile.current",
    label: "profile current",
    description: "Show the active enterprise profile.",
    displayCommand: "npm run profile -- current",
    outputIsMarkdown: false
  },
  {
    id: "memory.list",
    label: "memory list",
    description: "List approved memories (founder note, guardrails, ...).",
    displayCommand: "npm run memory -- list",
    outputIsMarkdown: false
  },
  {
    id: "doctor",
    label: "doctor",
    description: "Run environment health checks (Node, DB, fixtures, governance).",
    displayCommand: "npm run doctor",
    outputIsMarkdown: false
  },
  {
    id: "demo",
    label: "demo",
    description: "Run the vertical-slice demo on examples/buggy-python.",
    displayCommand: "npm run demo -- --workspace ./examples/buggy-python",
    outputIsMarkdown: false
  }
];

function normalizeModelProvider(value: unknown): "local" | "api" | "mock" {
  return value === "api" || value === "mock" || value === "local" ? value : "local";
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

function normalizeSandboxResourceLimits(value: unknown): { cpu: number; memoryMb: number; diskMb: number } {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    cpu: normalizePositiveNumber(record.cpu) ?? 1,
    memoryMb: normalizePositiveInteger(record.memoryMb) ?? 512,
    diskMb: normalizePositiveInteger(record.diskMb) ?? 512
  };
}

function appendSandboxEvent(
  database: SquidDatabase,
  record: { id: string; sessionId: string | null; runId: string | null },
  type: "sandbox.promoted" | "sandbox.destroyed",
  data: Record<string, unknown>
): void {
  const sessionId = record.sessionId ?? "session_desktop_sandbox";
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

function refreshTraceForSession(database: SquidDatabase, sessionId: string): void {
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

function coerceOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function requireNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(message);
  }
  return value.trim();
}

function normalizeMessagingChannelType(value: unknown, platform: string): MessagingChannelDto["channelType"] {
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

function normalizeMessagingTrigger(value: unknown): MessagingDeliveryRuleDto["triggerType"] {
  if (
    value === "approvalRequest" ||
    value === "jobComplete" ||
    value === "sandboxReady" ||
    value === "evalComplete" ||
    value === "teamHandoff" ||
    value === "gapCreated"
  ) {
    return value;
  }
  return "runSummary";
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
