import type { SquidDatabase } from "@squidbot/db";
import { affordanceGapId, createAffordanceGap, detectAffordanceGaps } from "@squidbot/reflection";
import { parseCommandLine, SandboxManager, type Sandbox, type SandboxCreateOptions, type SandboxRunResult } from "@squidbot/sandbox";
import { getActiveProfile, installSeedProfiles, type ProfileSensitivity } from "./enterpriseProfile.js";
import { EventLog } from "./eventLog.js";
import { buildIdentityReport, buildSystemPrompt } from "./identity.js";
import { ensureLegacyAccountMigrated, getActiveModelAccount } from "./modelAccounts.js";
import type { SecretCipher } from "./secretCrypto.js";
import { registerModelAccountTools } from "./modelAccountTools.js";
import {
  buildMemoryBulletin,
  combineMemorySources,
  externalModelSensitivityCeiling,
  generateReflection,
  getRecentApprovedMemories,
  getRelevantGraphMemories,
  persistAffordanceGapMemoryGraph,
  persistReflectionMemoryGraph,
  persistSandboxDiffMemoryGraph,
  saveReflection
} from "./memory.js";
import { ModelRouter, type ModelRouterSettings } from "./modelRouter.js";
import { PolicyEngine } from "./policyEngine.js";
import type { GovernanceEnforcer } from "@squidbot/governance";
import { summarizeWorkspace } from "./repoTask.js";
import { createSession } from "./session.js";
import { registerTerminalTools } from "./terminalTools.js";
import { registerTestTools } from "./testTools.js";
import { ToolRegistry } from "./toolRegistry.js";
import { validateToolArgs } from "./argValidation.js";
import { buildTrace, parseStoredTrace, redactTrace } from "./trace.js";
import {
  createId,
  type AgentEvent,
  type AgentResponse,
  type ChatMessage,
  type JsonObject,
  type RepoTaskResult,
  type ToolCall,
  type ToolResult,
  type Trace
} from "./types.js";
import { registerWorkspaceTools } from "./workspaceTools.js";

export type AgentRuntimeOptions = {
  database: SquidDatabase;
  workspacePath: string;
  sessionId?: string;
  modelRouter?: ModelRouter;
  toolRegistry?: ToolRegistry;
  policyEngine?: PolicyEngine;
  governanceEnforcer?: GovernanceEnforcer;
  /**
   * Decrypts BYOK API keys stored encrypted-at-rest in `model_accounts`. When
   * omitted (tests, legacy installs), keys are read as plaintext. Production
   * surfaces (desktop, CLI) inject one built from an out-of-DB master key.
   */
  secretCipher?: SecretCipher;
};

export type RunTaskOptions = {
  testCommand?: string;
  skillCall?: {
    skillId: string;
    version: string;
    testMode?: boolean;
  };
  job?: {
    jobId: string;
    name?: string;
    type: string;
    refId: string;
    version?: string | null;
    schedule: string;
    scheduledTime?: string;
  };
};

export class AgentRuntime {
  readonly sessionId: string;
  readonly workspacePath: string;
  private readonly database: SquidDatabase;
  private readonly eventLog: EventLog;
  // Not `readonly` — `refreshModelRouterIfAccountChanged` rebuilds it when
  // the active model account changes between turns.
  private modelRouter: ModelRouter;
  private readonly toolRegistry: ToolRegistry;
  private readonly policyEngine: PolicyEngine;
  private readonly governanceEnforcer: GovernanceEnforcer | null;
  private readonly secretCipher?: SecretCipher;
  private messages: ChatMessage[] = [];
  /**
   * The id of the active model_account the current `modelRouter` was built
   * against. When the agent (or the operator) switches accounts mid-session
   * via `model.useAccount`, the next chat turn rebuilds the router so it
   * picks up the new credentials + URL + model id. `null` means there is
   * no active account and the router was built from legacy flat settings.
   */
  private modelRouterAccountId: string | null;
  /**
   * Whether the router was injected by the caller (typically a test). Injected
   * routers are not auto-refreshed on account changes.
   */
  private readonly modelRouterIsInjected: boolean;
  /**
   * High-water mark of the last `resolvedAt` timestamp we surfaced to the
   * agent as a resolved-approvals system note. Persisted in the settings
   * table per session — without DB-backed storage, every fresh runtime
   * (the desktop builds one per IPC message) reset the watermark to
   * `Date.now() - 60s`, re-surfacing the same approvals each turn.
   */
  private getLastResolvedAt(): string {
    const stored = this.database.getSetting<string>(`chat.lastResolvedAt.${this.sessionId}`);
    return stored ?? new Date(Date.now() - 60_000).toISOString();
  }

  private setLastResolvedAt(value: string): void {
    this.database.setSetting(`chat.lastResolvedAt.${this.sessionId}`, value);
  }

  constructor(options: AgentRuntimeOptions) {
    this.database = options.database;
    this.workspacePath = options.workspacePath;
    this.sessionId = options.sessionId ?? createSession(options.workspacePath).id;
    this.eventLog = new EventLog(options.database);
    this.secretCipher = options.secretCipher;
    this.modelRouter = options.modelRouter ?? createModelRouterFromSettings(options.database, this.secretCipher);
    this.modelRouterIsInjected = options.modelRouter !== undefined;
    this.modelRouterAccountId = getActiveModelAccount(options.database)?.id ?? null;
    this.toolRegistry = options.toolRegistry ?? new ToolRegistry();
    this.policyEngine = options.policyEngine ?? new PolicyEngine();
    this.governanceEnforcer = options.governanceEnforcer ?? null;

    if (!options.toolRegistry) {
      registerWorkspaceTools(this.toolRegistry);
      registerTerminalTools(this.toolRegistry);
      registerTestTools(this.toolRegistry);
      // Model-account management tools: list saved accounts + switch the
      // active one. The agent can invoke these in response to "switch to
      // my GPT-4o-mini account" / "what models are available?" prompts.
      registerModelAccountTools(this.toolRegistry, this.database);
    }

    // Lazy-install the seed profiles on first runtime construction. This makes
    // the generic "any business" profile active out of the box without forcing
    // the operator to run an explicit setup step. Idempotent — existing profiles
    // are not overwritten and an already-active profile is not changed.
    installSeedProfiles(this.database);

    // Hydrate prior conversation history for this session. The DB is the
    // source of truth — a fresh runtime built for the same sessionId (which
    // happens on every IPC sendChatMessage) sees everything sent on prior
    // turns. Without this, multi-turn chat was silently broken: the UI looked
    // like a conversation, but the model only ever saw the latest turn.
    const persisted = this.database.listChatMessages(this.sessionId);
    if (persisted.length > 0) {
      this.messages = persisted.map((m) => ({ role: m.role, content: m.content }));
    }
  }

  /**
   * Rebuild `this.modelRouter` if the operator (or the agent via
   * `model.useAccount`) has switched the active account since the last
   * call. No-op for caller-injected routers (test fixtures).
   */
  private refreshModelRouterIfAccountChanged(): void {
    if (this.modelRouterIsInjected) return;
    const activeId = getActiveModelAccount(this.database)?.id ?? null;
    if (activeId !== this.modelRouterAccountId) {
      this.modelRouter = createModelRouterFromSettings(this.database, this.secretCipher);
      this.modelRouterAccountId = activeId;
    }
  }

  /**
   * Memory-sensitivity ceiling for the run (M4): if the active model account
   * talks to an off-machine endpoint, cap retrieved memories to "restricted"
   * so "secret" memories never enter an external model's prompt. Local / no
   * account → undefined (full access on the operator's own machine).
   */
  private memorySensitivityCeiling(): ReturnType<typeof externalModelSensitivityCeiling> {
    const account = getActiveModelAccount(this.database, this.secretCipher);
    return externalModelSensitivityCeiling(account?.apiUrl ?? null);
  }

  private buildMessagesForModel(memoryBulletin?: string, resolvedApprovalsNote?: string): ChatMessage[] {
    const report = buildIdentityReport(this.database, this.toolRegistry);
    const systemPrompt = buildSystemPrompt(report, { memoryBulletin });
    const withoutSystem = this.messages.filter((message) => message.role !== "system");
    const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];
    if (resolvedApprovalsNote) {
      // Sits between the main system prompt and the conversation history so
      // the agent sees the operator's resolutions BEFORE re-reading the
      // pending tool-result that triggered the approval in the first place.
      messages.push({ role: "system", content: resolvedApprovalsNote });
    }
    messages.push(...withoutSystem);
    return messages;
  }

  /**
   * Read approvals resolved for this session since the last `sendMessage`,
   * and return them rendered as a single system note ready for injection
   * into the next model call. Returns `null` when there's nothing new.
   *
   * The query is inlined here rather than imported from `@squidbot/connectors`
   * because that package depends on `@squidbot/core` — a direct import would
   * create a cycle. The `pending_approvals` schema lives in `@squidbot/db`,
   * so this is just a read against that table.
   */
  private buildResolvedApprovalsNote(): string | null {
    const lastSeen = this.getLastResolvedAt();
    const rows = this.database.db
      .prepare(
        `SELECT id, payloadJson, resolution, resolvedAt, resultJson
           FROM pending_approvals
          WHERE callerSessionId = ?
            AND resolvedAt IS NOT NULL
            AND resolvedAt >= ?
          ORDER BY resolvedAt ASC`
      )
      .all(this.sessionId, lastSeen) as Array<{
        id: string;
        payloadJson: string;
        resolution: "approved" | "rejected" | null;
        resolvedAt: string;
        resultJson: string | null;
      }>;
    if (rows.length === 0) {
      return null;
    }
    const lines = rows.map((row) => {
      const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
      const connectorName = (payload.connectorName as string | undefined) ?? "?";
      const operationId = (payload.operationId as string | undefined) ?? "?";
      const result = row.resultJson ? (JSON.parse(row.resultJson) as Record<string, unknown> | null) : null;
      const resolutionLabel = row.resolution ? row.resolution.toUpperCase() : "RESOLVED";
      let detail = "";
      if (row.resolution === "approved" && result && typeof result.status !== "undefined") {
        detail = ` (HTTP ${String(result.status)})`;
      } else if (row.resolution === "rejected" && result && typeof result.reason === "string" && result.reason) {
        detail = ` — reason: ${result.reason}`;
      }
      return `- ${connectorName}.${operationId} (${row.id}) — ${resolutionLabel}${detail}`;
    });
    // Update the high-water mark so we don't re-surface the same rows on
    // the next sendMessage. We bump 1ms past the latest resolvedAt we just
    // surfaced — using "now" can collide with the row's own timestamp when
    // the test (or a real fast operator) resolves within the same
    // millisecond as the runtime's read, which would replay the row
    // forever. Using max(resolvedAt) + 1ms is collision-proof and still
    // lets a concurrent resolve at "now + epsilon" be picked up on the
    // next turn.
    const latestSurfaced = rows[rows.length - 1].resolvedAt;
    const bumped = new Date(new Date(latestSurfaced).getTime() + 1).toISOString();
    this.setLastResolvedAt(bumped);
    return [
      "SYSTEM: Since your last message, the following connector approvals were resolved:",
      ...lines,
      "Acknowledge any resolved approvals naturally in your response if relevant."
    ].join("\n");
  }

  async sendMessage(
    content: string,
    options?: { onToken?: (delta: string) => void; signal?: AbortSignal }
  ): Promise<AgentResponse> {
    // If the operator or a tool call has switched the active model account
    // between turns, swap the router before we make the next call.
    this.refreshModelRouterIfAccountChanged();

    const runId = createId("run");
    const { runEvents, append } = this.createRunRecorder(runId);

    append("session.started", { workspacePath: this.workspacePath });
    append("user.message", { content });
    this.messages.push({ role: "user", content });
    this.database.appendChatMessage(this.sessionId, { role: "user", content });

    // Retrieve approved memories so the chat path can cite operator guardrails,
    // founder notes from onboarding, and other importance-ranked context the
    // task path was already pulling. `combineMemorySources` sorts by
    // importance DESC, so guardrails (0.95) + founder notes (0.9) naturally
    // float above lower-importance entries even as the user generates more
    // memories over time.
    const retrievedMemories = combineMemorySources(
      getRelevantGraphMemories(this.database, content, 6, this.memorySensitivityCeiling()),
      getRecentApprovedMemories(this.database, 12)
    );
    const memoryBulletin = buildMemoryBulletin(retrievedMemories);
    append("memory.retrieved", {
      count: retrievedMemories.length,
      memories: retrievedMemories,
      bulletin: memoryBulletin
    });

    // Surface any connector approvals the operator has approved or rejected
    // since this session's last turn. The agent can then naturally reason
    // about the resolutions in its next response (e.g. "your GitHub issue
    // is now created — number 42") instead of getting stuck waiting on a
    // pending tool result from a prior turn.
    const resolvedApprovalsNote = this.buildResolvedApprovalsNote();

    // Agentic tool loop: call the model, run any tools it requests, feed the
    // results back into the conversation, and call the model again — repeating
    // until it returns a final answer with no tool calls. Before this loop
    // existed the model was called exactly once and never saw its own tool
    // output, so every multi-step task ("read the file, then fix the bug")
    // silently half-completed. Bounded by MAX_TOOL_ITERATIONS plus an
    // identical-call dedup guard so a misbehaving model cannot spin forever.
    const MAX_TOOL_ITERATIONS = 8;
    const toolResults: ToolResult[] = [];
    const aggregatedToolCalls: ToolCall[] = [];
    const executedSignatures = new Set<string>();
    let finalContent = "";
    // Declared outside the try so the `finally` can persist a trace whether the
    // run succeeded or threw. A failed run must never silently vanish from the
    // History page or the audit ledger.
    let trace: Trace | undefined;

    try {
      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
        // Cooperative cancellation: if the caller aborted, stop before the
        // next (potentially expensive) model call and return what we have.
        if (options?.signal?.aborted) {
          finalContent = finalContent.trim().length > 0 ? finalContent : "[Generation cancelled.]";
          break;
        }
        const modelResponse = await this.modelRouter.generate({
          sessionId: this.sessionId,
          runId,
          messages: this.buildMessagesForModel(
            retrievedMemories.length > 0 ? memoryBulletin : undefined,
            // The resolved-approvals note is a one-time context nudge — inject
            // it only on the first model call, not on every loop iteration.
            iteration === 0 ? (resolvedApprovalsNote ?? undefined) : undefined
          ),
          tools: this.toolRegistry.list(),
          emitEvent: append
        });

        append("model.response", {
          content: modelResponse.content,
          provider: modelResponse.provider,
          costOwner: modelResponse.costOwner,
          toolCalls: modelResponse.toolCalls
        });

        finalContent = modelResponse.content;

        if (modelResponse.toolCalls.length === 0) {
          // The model produced its final answer with no further tool calls.
          break;
        }

        // Record the assistant's tool-call turn in the working history so the
        // next model call sees it paired with the tool results pushed below.
        // Only the final answer is persisted to chat_messages — intermediate
        // turns live in-memory for this turn and in the trace for audit, which
        // keeps cross-session hydration a clean user/assistant transcript.
        this.messages.push({
          role: "assistant",
          content: modelResponse.content,
          toolCalls: modelResponse.toolCalls
        });

        // Stop if every requested call was already executed this turn — the
        // model is repeating itself with no new information (no progress).
        const progressing = modelResponse.toolCalls.some(
          (call) => !executedSignatures.has(toolCallSignature(call))
        );
        if (!progressing) {
          break;
        }

        for (const toolCall of modelResponse.toolCalls) {
          executedSignatures.add(toolCallSignature(toolCall));
          const result = await this.executeToolCall(toolCall, append, undefined, runId);
          aggregatedToolCalls.push(toolCall);
          toolResults.push(result);
          this.messages.push({
            role: "tool",
            content: stringifyToolResult(result),
            toolCallId: toolCall.id,
            name: toolCall.name
          });
        }
      }

      // The model's final text is the answer. If it returned only tool calls
      // and no closing text (some models do), fall back to a formatted summary
      // of what ran so the user still gets a coherent response.
      let responseContent =
        finalContent.trim().length > 0 ? finalContent : formatAssistantResponse("", toolResults);

      // If a configured PAID provider failed mid-turn and a free/local one
      // answered instead, say so. The user must never silently believe their
      // paid model produced the reply (trust + cost transparency). A free→free
      // fallback (the default local→mock zero-spend path) is not surfaced.
      const fellBackFromPaid = runEvents.some(
        (event) =>
          event.type === "model.fallback" &&
          (event.data as { fromProvider?: string }).fromProvider === "api"
      );
      if (fellBackFromPaid) {
        responseContent +=
          "\n\n_Note: your configured paid model was unavailable, so this reply fell back to a local/free provider._";
      }

      // Stream the final answer to the caller in chunks. The local/zero-spend
      // providers complete synchronously, so this is incremental delivery of
      // the assembled answer (a real streaming UX in the renderer); a BYOK SSE
      // provider can later emit true token deltas through the same callback.
      if (options?.onToken) {
        for (const chunk of chunkForStreaming(responseContent)) {
          options.onToken(chunk);
        }
      }

      this.messages.push({ role: "assistant", content: responseContent });
      this.database.appendChatMessage(this.sessionId, { role: "assistant", content: responseContent });

      trace = buildTrace(runEvents);
      return {
        sessionId: this.sessionId,
        runId,
        content: responseContent,
        toolCalls: aggregatedToolCalls,
        toolResults,
        trace
      };
    } catch (error) {
      // Record the failure as an event so the persisted trace explains why the
      // run aborted, then rethrow so the caller can surface it.
      append("error", {
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      // Persist whatever trace we have. On success `trace` is already built; on
      // failure we build from the events captured up to (and including) the
      // error appended above.
      const toPersist = trace ?? buildTrace(runEvents);
      this.database.saveTrace({
        id: toPersist.id,
        sessionId: toPersist.sessionId,
        events: toPersist,
        createdAt: toPersist.createdAt
      });
    }
  }

  async runTask(task: string, options: RunTaskOptions = {}): Promise<RepoTaskResult> {
    this.refreshModelRouterIfAccountChanged();
    const runId = createId("run");
    const { runEvents, append } = this.createRunRecorder(runId);

    append("session.started", { workspacePath: this.workspacePath });
    append("user.task", { task, testCommand: options.testCommand ?? null });
    if (options.job) {
      append("job.run", {
        jobId: options.job.jobId,
        name: options.job.name,
        type: options.job.type,
        refId: options.job.refId,
        version: options.job.version ?? null,
        schedule: options.job.schedule,
        scheduledTime: options.job.scheduledTime ?? null,
        workspacePath: this.workspacePath,
        testCommand: options.testCommand ?? null
      });
    }
    if (options.skillCall) {
      append("skill.call", {
        skillId: options.skillCall.skillId,
        version: options.skillCall.version,
        workspacePath: this.workspacePath,
        testMode: options.skillCall.testMode === true
      });
    }

    const retrievedMemories = combineMemorySources(
      getRelevantGraphMemories(this.database, task, 5, this.memorySensitivityCeiling()),
      getRecentApprovedMemories(this.database, 5)
    );
    const memoryBulletin = buildMemoryBulletin(retrievedMemories);
    append("memory.retrieved", {
      count: retrievedMemories.length,
      memories: retrievedMemories,
      bulletin: memoryBulletin
    });

    const workspaceSummary = summarizeWorkspace(this.workspacePath);
    append("workspace.summary", workspaceSummary);

    const plan = await this.modelRouter.generateTaskPlan({
      sessionId: this.sessionId,
      runId,
      task,
      workspaceSummary,
      testCommand: options.testCommand,
      memoryBulletin: retrievedMemories.length > 0 ? memoryBulletin : undefined,
      tools: this.toolRegistry.list(),
      emitEvent: append
    });
    const provider = this.modelRouter.getProvider();

    append("plan.generated", {
      provider: provider.name,
      costOwner: provider.costOwner,
      plan
    });

    const toolResults: ToolResult[] = [];
    const sandboxManager = new SandboxManager();
    let stagedSandbox: StagedSandbox | null = null;
    for (const action of plan.actions) {
      if (action.toolName === "test.run" && stagedSandbox) {
        const stagedTest = await this.executeSandboxedTest(action, stagedSandbox, sandboxManager, append);
        toolResults.push(stagedTest);
        continue;
      }

      const result = await this.executeToolCall(
        {
          id: action.id,
          name: action.toolName,
          args: action.args
        },
        append,
        action.description,
        runId
      );
      toolResults.push(result);

      if (result.ok && (result.toolName === "workspace.createPatch" || result.toolName === "workspace.proposePatch") && !stagedSandbox) {
        stagedSandbox = await this.stagePatchInSandbox(result, sandboxManager, runId, task, append);
      }
    }

    if (stagedSandbox) {
      await this.finalizeSandboxStaging(stagedSandbox, sandboxManager, runId, task, append);
    }

    const finalSummary = formatTaskSummary(task, plan.riskLevel, toolResults);
    const stagedDiff = stagedSandbox
      ? String(this.database.getSandbox(stagedSandbox.sandbox.id)?.diff ?? "").trim()
      : "";
    append("task.complete", {
      task,
      finalSummary,
      draftOnly: !stagedSandbox,
      modifiedFiles: false,
      sandboxId: stagedSandbox?.sandbox.id ?? null,
      approvalRequired: stagedDiff.length > 0,
      skillCall: options.skillCall ?? null,
      job: options.job ?? null
    });

    const reflection = generateReflection({
      sessionId: this.sessionId,
      runId,
      task,
      plan,
      workspaceSummary,
      toolResults,
      events: runEvents
    });
    saveReflection(this.database, reflection);
    const graph = persistReflectionMemoryGraph(this.database, reflection);
    const gapDrafts = detectAffordanceGaps({
      sessionId: this.sessionId,
      runId,
      reflectionId: reflection.id,
      task,
      events: runEvents,
      toolResults,
      reflection
    });
    const gaps = gapDrafts.map((gap) =>
      createAffordanceGap(this.database, {
        ...gap,
        id: affordanceGapId(runId, gap.type, gap.name),
        createdAt: reflection.createdAt
      })
    );
    reflection.failureTaxonomy = [...new Set(gaps.map((gap) => gap.type))];
    reflection.affordanceIds = gaps.map((gap) => gap.id);
    this.database.updateReflectionAffordances(reflection.id, reflection.failureTaxonomy, reflection.affordanceIds);
    const gapGraph = persistAffordanceGapMemoryGraph(this.database, reflection, gaps);
    append("memory.graph", {
      action: "reflection-indexed",
      reflectionId: reflection.id,
      taskNodeId: graph.taskNodeId,
      reflectionNodeId: graph.reflectionNodeId,
      candidateNodeIds: graph.candidateNodeIds,
      edgeIds: graph.edgeIds
    });
    if (gaps.length > 0) {
      append("memory.graph", {
        action: "affordance-indexed",
        reflectionId: reflection.id,
        gapNodeIds: gapGraph.gapNodeIds,
        edgeIds: gapGraph.edgeIds
      });
      for (const gap of gaps) {
        append("affordance.gap", {
          reflectionId: reflection.id,
          gapId: gap.id,
          gapType: gap.type,
          gap
        });
      }
    }
    append("reflection.created", {
      reflectionId: reflection.id,
      task: reflection.task,
      summary: reflection.summary,
      outcome: reflection.outcome,
      successFactors: reflection.successFactors,
      failureModes: reflection.failureModes,
      missingTools: reflection.missingTools,
      missingPermissions: reflection.missingPermissions,
      missingContext: reflection.missingContext,
      reusablePatterns: reflection.reusablePatterns,
      failureTaxonomy: reflection.failureTaxonomy,
      affordanceIds: reflection.affordanceIds,
      memoryCandidates: reflection.memoryCandidates
    });

    for (const [index, candidate] of reflection.memoryCandidates.entries()) {
      append("memory.candidate", {
        reflectionId: reflection.id,
        candidateIndex: index,
        candidate
      });
    }

    const trace = buildTrace(runEvents);
    this.database.saveTrace({
      id: trace.id,
      sessionId: trace.sessionId,
      events: trace,
      createdAt: trace.createdAt
    });

    return {
      sessionId: this.sessionId,
      runId,
      task,
      plan,
      workspaceSummary,
      toolResults,
      finalSummary,
      retrievedMemories,
      reflection,
      trace
    };
  }

  private createRunRecorder(runId: string): {
    runEvents: AgentEvent[];
    append: (type: AgentEvent["type"], data: JsonObject) => void;
  } {
    const runEvents: AgentEvent[] = [];
    const append = (type: AgentEvent["type"], data: JsonObject): void => {
      const event: AgentEvent = {
        id: createId("evt"),
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId,
        runId,
        type,
        data
      };
      runEvents.push(event);
      this.eventLog.append(event);
    };

    return { runEvents, append };
  }

  private async executeToolCall(
    toolCall: ToolCall,
    append: (type: AgentEvent["type"], data: JsonObject) => void,
    actionDescription?: string,
    runId?: string
  ): Promise<ToolResult> {
    const tool = this.toolRegistry.get(toolCall.name);
    if (!tool) {
      append("tool.denied", {
        toolName: toolCall.name,
        callId: toolCall.id,
        actionDescription,
        reason: "Tool is not registered."
      });
      return {
        callId: toolCall.id,
        toolName: toolCall.name,
        ok: false,
        output: { error: "Tool is not registered." }
      };
    }

    // Validate the call's shape against the tool's declared inputSchema BEFORE
    // any gate or execution (request well-formedness is a precondition — the
    // HTTP 400-before-403 convention). A malformed call becomes a structured
    // tool-result the model can self-correct from rather than a handler that
    // silently coerces bad input or throws an opaque error. Validation is
    // permissive (see argValidation.ts): it fails only on a missing required
    // property or a known property of the wrong type.
    const argCheck = validateToolArgs(tool.inputSchema, toolCall.args);
    if (!argCheck.ok) {
      const reason = `Invalid arguments for ${toolCall.name}: ${argCheck.errors.join("; ")}`;
      append("tool.denied", {
        toolName: toolCall.name,
        callId: toolCall.id,
        actionDescription,
        reason
      });
      return {
        callId: toolCall.id,
        toolName: toolCall.name,
        ok: false,
        output: { error: reason }
      };
    }

    // Governance ABAC gate runs BEFORE the legacy PolicyEngine risk check.
    // A deny converts to a structured tool-result so the model can react
    // (e.g. switch tools, ask the operator) rather than the runtime throwing
    // mid-turn. Without this, GovernanceEnforcer.assertAllowed existed but
    // was never called from anywhere — the simulated policy in the UI had
    // no relationship to actual runtime behavior.
    if (this.governanceEnforcer) {
      try {
        this.governanceEnforcer.assertAllowed({
          actor: { type: "system", id: `runtime:${this.sessionId}` },
          action: "tool.invoke",
          resource: { type: "tool", id: toolCall.name }
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        append("tool.denied", {
          toolName: toolCall.name,
          callId: toolCall.id,
          actionDescription,
          reason: `Blocked by governance: ${reason}`
        });
        return {
          callId: toolCall.id,
          toolName: toolCall.name,
          ok: false,
          output: { error: `Blocked by governance policy: ${reason}` }
        };
      }
    }

    const decision = this.policyEngine.evaluateTool(tool, toolCall.args);
    if (!decision.allowed) {
      if (tool.permissionScopes.some((scope) => scope.startsWith("connector."))) {
        append("connector.denied", {
          connectorName: tool.metadata?.connectorName ?? "unknown",
          operationName: tool.metadata?.operationName ?? toolCall.name,
          toolName: toolCall.name,
          callId: toolCall.id,
          args: toolCall.args,
          reason: decision.reason,
          riskLevel: decision.riskLevel
        });
      }

      append("tool.denied", {
        toolName: toolCall.name,
        callId: toolCall.id,
        actionDescription,
        reason: decision.reason,
        riskLevel: decision.riskLevel
      });
      return {
        callId: toolCall.id,
        toolName: toolCall.name,
        ok: false,
        output: { error: decision.reason }
      };
    }

    append("tool.call", {
      toolName: toolCall.name,
      callId: toolCall.id,
      actionDescription,
      args: toolCall.args,
      policy: decision
    });

    try {
      const output = await this.toolRegistry.execute(toolCall.name, toolCall.args, {
        workspacePath: this.workspacePath,
        emitEvent: append,
        getSetting: <T = unknown>(key: string) => this.database.getSetting<T>(key),
        // The active enterprise profile's sensitivity drives the connector
        // sensitivity policy (execute / queue / deny). We read it per-call so
        // operator changes to the profile during a session take effect on the
        // next tool call without needing to rebuild the runtime.
        getActiveProfileSensitivity: (): ProfileSensitivity =>
          getActiveProfile(this.database)?.sensitivity ?? "standard",
        database: this.database,
        sessionId: this.sessionId,
        runId
      });
      append("tool.result", {
        toolName: toolCall.name,
        callId: toolCall.id,
        output
      });

      if (toolCall.name === "test.run") {
        append("test.run", {
          toolName: toolCall.name,
          callId: toolCall.id,
          result: output as JsonObject
        });
      }

      return { callId: toolCall.id, toolName: toolCall.name, ok: true, output };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown tool failure.";
      append("error", {
        toolName: toolCall.name,
        callId: toolCall.id,
        message
      });
      return {
        callId: toolCall.id,
        toolName: toolCall.name,
        ok: false,
        output: { error: message }
      };
    }
  }

  private async stagePatchInSandbox(
    patchResult: ToolResult,
    sandboxManager: SandboxManager,
    runId: string,
    task: string,
    append: (type: AgentEvent["type"], data: JsonObject) => void
  ): Promise<StagedSandbox | null> {
    const output = patchResult.output as { patch?: string; sandboxId?: string; staged?: boolean; sandboxMode?: string };
    const patch = typeof output.patch === "string" ? output.patch : "";
    if (!patch.trim()) {
      return null;
    }

    const options = readSandboxSettings(this.database);
    const sandbox = await sandboxManager.create(this.workspacePath, options);
    this.database.insertSandbox({
      id: sandbox.id,
      sessionId: this.sessionId,
      runId,
      workspacePath: sandbox.originalWorkspacePath,
      sandboxPath: sandbox.path,
      backend: sandbox.backend,
      status: "active",
      resourceLimits: sandbox.resourceLimits,
      networkPolicy: sandbox.networkPolicy,
      createdAt: sandbox.createdAt
    });
    append("sandbox.created", {
      sandboxId: sandbox.id,
      workspacePath: sandbox.originalWorkspacePath,
      sandboxPath: sandbox.path,
      backend: sandbox.backend,
      limits: sandbox.resourceLimits,
      networkPolicy: sandbox.networkPolicy
    });

    try {
      const startedAt = Date.now();
      await sandboxManager.applyPatch(sandbox, patch);
      append("sandbox.command", {
        sandboxId: sandbox.id,
        command: "git",
        args: ["apply"],
        exitCode: 0,
        durationMs: Date.now() - startedAt,
        purpose: "applyPatch"
      });
      output.sandboxId = sandbox.id;
      output.staged = true;
      output.sandboxMode = "staged-workspace";
      return {
        sandbox,
        patch,
        testResults: []
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sandbox patch application failed.";
      this.database.updateSandbox(sandbox.id, {
        status: "failed",
        lastError: message
      });
      append("error", {
        sandboxId: sandbox.id,
        message
      });
      return null;
    }
  }

  private async executeSandboxedTest(
    action: { id: string; description: string; args: JsonObject },
    stagedSandbox: StagedSandbox,
    sandboxManager: SandboxManager,
    append: (type: AgentEvent["type"], data: JsonObject) => void
  ): Promise<ToolResult> {
    const commandLine = typeof action.args.command === "string" ? action.args.command : "";
    const parsed = parseCommandLine(commandLine);
    const timeoutMs = typeof action.args.timeoutMs === "number" ? Math.min(Math.max(action.args.timeoutMs, 1000), 60_000) : 15_000;

    append("tool.call", {
      toolName: "test.run",
      callId: action.id,
      actionDescription: action.description,
      args: action.args,
      policy: {
        allowed: true,
        reason: "Test command is running inside the staged sandbox workspace.",
        riskLevel: "medium"
      }
    });

    const result = parsed.command
      ? await sandboxManager.runCommand(stagedSandbox.sandbox, parsed.command, parsed.args, { timeoutMs })
      : ({
          stdout: "",
          stderr: "Test command is required.",
          exitCode: 127,
          durationMs: 0,
          timedOut: false,
          sandboxId: stagedSandbox.sandbox.id,
          command: "",
          args: []
        } satisfies SandboxRunResult);

    const output = {
      command: commandLine,
      executed: true,
      dryRun: false,
      sandboxMode: "staged-workspace",
      sandboxId: stagedSandbox.sandbox.id,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      blockedByPolicy: result.blockedByPolicy === true,
      resourceLimitExceeded: result.resourceLimitExceeded === true
    };
    stagedSandbox.testResults.push(output);

    append("sandbox.command", {
      sandboxId: stagedSandbox.sandbox.id,
      command: parsed.command || commandLine,
      args: parsed.args,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      blockedByPolicy: result.blockedByPolicy === true,
      resourceLimitExceeded: result.resourceLimitExceeded === true
    });
    if (result.resourceLimitExceeded) {
      append("sandbox.resourceLimitExceeded", {
        sandboxId: stagedSandbox.sandbox.id,
        command: parsed.command,
        limits: stagedSandbox.sandbox.resourceLimits
      });
    }
    append("tool.result", {
      toolName: "test.run",
      callId: action.id,
      output
    });
    append("test.run", {
      toolName: "test.run",
      callId: action.id,
      result: output
    });

    const ok =
      result.exitCode === 0 &&
      !result.timedOut &&
      result.blockedByPolicy !== true &&
      result.resourceLimitExceeded !== true;

    return {
      callId: action.id,
      toolName: "test.run",
      ok,
      output
    };
  }

  private async finalizeSandboxStaging(
    stagedSandbox: StagedSandbox,
    sandboxManager: SandboxManager,
    runId: string,
    task: string,
    append: (type: AgentEvent["type"], data: JsonObject) => void
  ): Promise<void> {
    const diff = await sandboxManager.diff(stagedSandbox.sandbox);
    const changedFiles = [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]);
    this.database.updateSandbox(stagedSandbox.sandbox.id, {
      diff,
      testResults: stagedSandbox.testResults,
      lastError: null
    });
    append("sandbox.diff", {
      sandboxId: stagedSandbox.sandbox.id,
      diffLength: diff.length,
      fileCount: changedFiles.length,
      changedFiles
    });
    append("sandbox.approvalRequested", {
      sandboxId: stagedSandbox.sandbox.id,
      diffLength: diff.length,
      fileCount: changedFiles.length,
      changedFiles,
      approvalRequired: diff.trim().length > 0
    });
    if (diff.trim()) {
      const graph = persistSandboxDiffMemoryGraph(this.database, {
        runId,
        task,
        sandboxId: stagedSandbox.sandbox.id,
        diff,
        createdAt: new Date().toISOString()
      });
      append("memory.graph", {
        action: "sandbox-diff-indexed",
        sandboxId: stagedSandbox.sandbox.id,
        nodeIds: [graph.diffNodeId],
        edgeIds: graph.edgeIds
      });
    }
  }
}

type StagedSandbox = {
  sandbox: Sandbox;
  patch: string;
  testResults: JsonObject[];
};

export function getLatestTrace(database: SquidDatabase): Trace | null {
  return redactTrace(parseStoredTrace(database.getLatestTrace()));
}

function createModelRouterFromSettings(database: SquidDatabase, cipher?: SecretCipher): ModelRouter {
  // The model_accounts table is the new source of truth for BYOK config.
  // We hydrate any legacy flat model.* settings into a "Legacy BYOK" account
  // on first read (idempotent), then use the active account if one exists.
  // Operators who never touched model.* still get the existing fallback
  // (provider = "local" or "mock" via the legacy settings).
  ensureLegacyAccountMigrated(database, cipher);
  const activeAccount = getActiveModelAccount(database, cipher);

  const settings: ModelRouterSettings = activeAccount
    ? {
        // Force the API provider whenever an account is active. The legacy
        // model.provider setting is ignored — the account itself is the
        // routing decision.
        provider: "api",
        apiKey: activeAccount.apiKey,
        apiUrl: activeAccount.apiUrl,
        apiModel: activeAccount.apiModel,
        apiBudgetTokens: activeAccount.dailyBudgetTokens ?? readPositiveIntegerSetting(database, "model.budget.api"),
        // Track this account's daily spend under its own id, not a shared bucket.
        apiBudgetKey: activeAccount.id,
        localModel: database.getSetting<string>("model.localModel")
      }
    : {
        provider: database.getSetting<string>("model.provider") ?? undefined,
        apiKey: database.getSetting<string>("model.apiKey"),
        apiUrl: database.getSetting<string>("model.apiUrl"),
        apiModel: database.getSetting<string>("model.apiModel"),
        apiBudgetTokens: readPositiveIntegerSetting(database, "model.budget.api"),
        localModel: database.getSetting<string>("model.localModel")
      };

  return new ModelRouter({ settings, budgetStore: database });
}

function readPositiveIntegerSetting(database: SquidDatabase, key: string): number | null {
  const value = database.getSetting<string | number>(key);
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
  }

  return null;
}

function readSandboxSettings(database: SquidDatabase): SandboxCreateOptions {
  const cpu = readPositiveNumberSetting(database, "sandbox.limits.cpu") ?? 1;
  const memoryMb = readPositiveIntegerSetting(database, "sandbox.limits.memory") ?? 512;
  const diskMb = readPositiveIntegerSetting(database, "sandbox.limits.disk") ?? 512;
  const networkSetting = database.getSetting<string>("sandbox.network.policy");
  const networkPolicy = networkSetting === "allow" || networkSetting === "custom" || networkSetting === "deny" ? networkSetting : "deny";

  return {
    resourceLimits: {
      cpu,
      memoryMb,
      diskMb
    },
    networkPolicy
  };
}

function readPositiveNumberSetting(database: SquidDatabase, key: string): number | null {
  const value = database.getSetting<string | number>(key);
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

/**
 * Split assembled text into streaming chunks (whitespace-delimited words,
 * keeping trailing spaces) so the concatenation of all chunks is exactly the
 * original text. Used to deliver the final answer incrementally to onToken.
 */
function chunkForStreaming(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  return text.match(/\S+\s*|\s+/g) ?? [text];
}

/**
 * Stable identity for a tool call (name + args), used by the agentic loop to
 * detect a model that requests the exact same call again without progress.
 */
function toolCallSignature(call: ToolCall): string {
  let args: string;
  try {
    args = JSON.stringify(call.args ?? {});
  } catch {
    args = String(call.args);
  }
  return `${call.name}:${args}`;
}

/**
 * Render a tool result as the message content fed back to the model on the
 * next loop iteration. Bounded so a huge tool output cannot blow the context.
 */
function stringifyToolResult(result: ToolResult): string {
  const status = result.ok ? "ok" : "error";
  let body: string;
  try {
    body = typeof result.output === "string" ? result.output : JSON.stringify(result.output);
  } catch {
    body = String(result.output);
  }
  const MAX = 8_000;
  if (body.length > MAX) {
    body = `${body.slice(0, MAX)}… [truncated ${body.length - MAX} chars]`;
  }
  return `[${result.toolName} ${status}] ${body}`;
}

function formatAssistantResponse(content: string, toolResults: ToolResult[]): string {
  if (toolResults.length === 0) {
    return content;
  }

  const summaries = toolResults.map((result) => {
    if (!result.ok) {
      return `${result.toolName}: failed`;
    }

    if (result.toolName === "workspace.listFiles") {
      const output = result.output as { files?: string[] };
      return `${result.toolName}: ${output.files?.length ?? 0} files`;
    }

    if (result.toolName === "workspace.readFile") {
      const output = result.output as { path?: string; content?: string };
      return `${result.toolName}: read ${output.path ?? "file"} (${output.content?.length ?? 0} chars)`;
    }

    if (result.toolName === "workspace.proposePatch") {
      return `${result.toolName}: draft patch returned`;
    }

    if (result.toolName === "workspace.createPatch") {
      return `${result.toolName}: draft patch returned`;
    }

    if (result.toolName === "workspace.searchFiles") {
      const output = result.output as { paths?: string[] };
      return `${result.toolName}: ${output.paths?.length ?? 0} matching files`;
    }

    if (result.toolName === "test.run") {
      const output = result.output as { exitCode?: number | null; dryRun?: boolean };
      return output.dryRun ? `${result.toolName}: dry run` : `${result.toolName}: exit ${output.exitCode ?? "unknown"}`;
    }

    if (result.toolName.startsWith("connector.")) {
      const output = result.output as { operationName?: string; fixture?: boolean };
      return `${result.toolName}: ${output.fixture ? "fixture" : "ok"} ${output.operationName ?? "operation"}`;
    }

    if (result.toolName === "terminal.dryRun") {
      return `${result.toolName}: command recorded only`;
    }

    return `${result.toolName}: ok`;
  });

  return `${content}\n\nTool results:\n${summaries.map((summary) => `- ${summary}`).join("\n")}`;
}

function formatTaskSummary(task: string, riskLevel: string, toolResults: ToolResult[]): string {
  const failed = toolResults.filter((result) => !result.ok);
  const patch = toolResults.find((result) => result.toolName === "workspace.createPatch" || result.toolName === "workspace.proposePatch");
  const connectorCalls = toolResults.filter((result) => result.toolName.startsWith("connector."));
  const testRun = toolResults.find((result) => result.toolName === "test.run")?.output as
    | { exitCode?: number | null; dryRun?: boolean; timedOut?: boolean }
    | undefined;

  const lines = [
    `Task: ${task}`,
    `Plan risk: ${riskLevel}`,
    `Tool calls completed: ${toolResults.length}`,
    `Draft patch created: ${patch ? "yes" : "no"}`,
    "Workspace files modified: no",
    `Connector calls completed: ${connectorCalls.length}`
  ];

  if (testRun) {
    const status = testRun.dryRun ? "dry run" : testRun.timedOut ? "timed out" : `exit ${testRun.exitCode ?? "unknown"}`;
    lines.push(`Test command: ${status}`);
  }

  const stagedPatch = patch?.output as { sandboxId?: string; staged?: boolean } | undefined;
  if (stagedPatch?.staged && stagedPatch.sandboxId) {
    lines.push(`Sandbox staged: ${stagedPatch.sandboxId}`);
  }

  if (failed.length > 0) {
    lines.push(`Failed tool calls: ${failed.map((result) => result.toolName).join(", ")}`);
  }

  return lines.join("\n");
}
