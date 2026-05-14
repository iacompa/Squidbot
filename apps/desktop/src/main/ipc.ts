import path from "node:path";
import { dialog, ipcMain } from "electron";
import { ConnectorRegistry, installDeveloperWorkflowConnectors, registerConnectorTools } from "@squidbot/connectors";
import { EvalResultStore, SkillVariantStore } from "@squidbot/evals";
import { DEFAULT_ADMIN_USER_ID, DEFAULT_TENANT_ID, GovernanceEngine } from "@squidbot/governance";
import { MemoryGraphStore } from "@squidbot/memory";
import { DeliveryRouter, getPlatformMatrixEntry, listPlatformMatrix, MessagingAdapterRegistry, MessagingGateway, MessagingStore } from "@squidbot/messaging";
import { SandboxManager, sandboxFromRecord } from "@squidbot/sandbox";
import { Scheduler } from "@squidbot/scheduler";
import { evaluateSkill, installDeveloperWorkflowSkills, SkillService } from "@squidbot/skills";
import { defaultTeamManifest, RoleRegistry, TeamCoordinator, TeamStore, validateTeamManifest } from "@squidbot/team";
import {
  activateProfile,
  AgentRuntime,
  approveMemoryCandidate,
  buildIdentityReport,
  buildTrace,
  commitOnboarding,
  computeTraceMetrics,
  createCustomProfile,
  createId,
  describeForWhoami,
  formatOnboardingSummary,
  formatNextActions,
  getActiveProfile,
  getTrace,
  getLatestTrace,
  inferOnboardingProfile,
  installSeedProfiles,
  listProfiles,
  listRuns,
  parseStoredTrace,
  redactTrace,
  registerTerminalTools,
  registerTestTools,
  registerWorkspaceTools,
  searchEvents,
  STANDARD_QUESTIONS,
  ToolRegistry,
  type AgentEvent,
  type JsonObject,
  type OnboardingAnswer
} from "@squidbot/core";
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
  MemoryGraphDetailDto,
  MessagingAllowlistRuleDto,
  MessagingChannelDto,
  MessagingDeliveryRuleDto,
  OnboardingAnswerDto,
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
      connectors.map((connector) => [
        connector.name,
        {
          baseUrl: typeof settings[`${connector.name}.baseUrl`] === "string" ? (settings[`${connector.name}.baseUrl`] as string) : undefined,
          apiKeyConfigured: typeof settings[`${connector.name}.apiKey`] === "string" && Boolean(settings[`${connector.name}.apiKey`])
        }
      ])
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

function createRuntime(database: SquidDatabase, workspacePath: string, sessionId?: string): AgentRuntime {
  const toolRegistry = new ToolRegistry();
  registerWorkspaceTools(toolRegistry);
  registerTerminalTools(toolRegistry);
  registerTestTools(toolRegistry);
  const connectorRegistry = new ConnectorRegistry(database);
  installDeveloperWorkflowConnectors(connectorRegistry);
  registerConnectorTools(toolRegistry, connectorRegistry);
  return new AgentRuntime({ database, workspacePath, sessionId, toolRegistry });
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
  return new GovernanceEngine(database);
}

export function registerIpcHandlers(database: SquidDatabase, paths: DesktopAppPaths): void {
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
    const record = database.getSandbox(sandboxId);
    if (!record) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }
    if (record.status !== "active") {
      throw new Error(`Sandbox is not active: ${sandboxId}`);
    }
    const manager = new SandboxManager();
    const approvalId = createId("approval");
    await manager.promote(
      sandboxFromRecord({
        id: record.id,
        sandboxPath: record.sandboxPath,
        workspacePath: record.workspacePath,
        createdAt: record.createdAt,
        resourceLimits: normalizeSandboxResourceLimits(record.resourceLimits),
        networkPolicy: record.networkPolicy
      }),
      approvalId
    );
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

  ipcMain.handle("squidbot:rejectSandbox", async (_event, sandboxId: string) => {
    const record = database.getSandbox(sandboxId);
    if (!record) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
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
    const settings = readSettings(database, paths);
    const workspacePath =
      typeof request.workspacePath === "string" && request.workspacePath.trim()
        ? path.resolve(request.workspacePath)
        : settings.workspacePath;
    if (!workspacePath) {
      throw new Error("Team run requires a selected workspace or explicit workspace path.");
    }
    return createTeamCoordinator(database).runTeamTask({
      teamId: request.teamId,
      workspacePath,
      task: request.task,
      mode: request.mode ?? "sandbox"
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

  ipcMain.handle("squidbot:listSquidbotCommands", () => SQUIDBOT_COMMAND_REGISTRY);

  ipcMain.handle("squidbot:runSquidbotCommand", (_event, commandId: SquidbotCommandId): CommandRunResultDto => {
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

function coerceOnboardingAnswers(answers: OnboardingAnswerDto[]): OnboardingAnswer[] {
  if (!Array.isArray(answers)) return [];
  return answers.map((answer) => ({
    questionId: String(answer.questionId ?? ""),
    rawValue: String(answer.rawValue ?? ""),
    skipped: Boolean(answer.skipped)
  }));
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
