import type { JsonObject, ModelCostOwner, ModelMode, ModelProviderRequest, ModelResponse, TaskPlan, TaskPlanRequest, ToolCall, ToolSchema } from "./base.js";
import { createId, estimateRequestTokens, usageFromText } from "./util.js";

function latestUserMessage(messages: ModelProviderRequest["messages"]): string {
  return [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
}

function firstSystemMessage(messages: ModelProviderRequest["messages"]): string | null {
  return messages.find((message) => message.role === "system")?.content ?? null;
}

function isIdentityIntent(message: string): boolean {
  return (
    /\bwho\s+are\s+you\b/i.test(message) ||
    /\bwhat\s+(are|is)\s+you\b/i.test(message) ||
    /\bwhat\s+can\s+you\s+do\b/i.test(message) ||
    /\bintroduce\s+yourself\b/i.test(message) ||
    /\btell\s+me\s+about\s+yourself\b/i.test(message) ||
    /\bwhat\s+is\s+squidbot\b/i.test(message) ||
    /\bwhoami\b/i.test(message) ||
    /\b(squid\s*bot|squidbot)\s*\?/i.test(message)
  );
}

function isCapabilityIntent(message: string): boolean {
  return (
    /\bwhat\s+can\s+you\s+(do|help)\b/i.test(message) ||
    /\bwhat\s+(tools|features|capabilities)\s+do\s+you\s+have\b/i.test(message) ||
    /\bhow\s+can\s+you\s+help\b/i.test(message) ||
    /\bgetting\s+started\b/i.test(message)
  );
}

function buildIdentityResponse(systemPrompt: string | null, message: string): string {
  if (!systemPrompt) {
    return "I'm SquidBot — an open-source, auditable, self-hosted AI agent platform. Run `squidbot whoami` for a structured summary, or run `squidbot onboarding` to pick an enterprise profile so I can adapt to your business.";
  }
  const capabilityRequest = isCapabilityIntent(message);
  // Pull the section anchors from the assembled system prompt so the response stays in sync.
  const lines = systemPrompt.split(/\n/);
  const headerLine = lines.find((line) => line.startsWith("You are ")) ?? "I'm SquidBot.";
  const missionLine = lines.find((line) => line.startsWith("Mission: "));
  const profileLines = collectSection(lines, "Active enterprise profile:");
  const noProfile = lines.find((line) => line.startsWith("No enterprise profile is active"));
  const capabilityLines = collectSection(lines, "Currently registered tools");

  const reply: string[] = [];
  reply.push(headerLine);
  if (missionLine) reply.push(missionLine);
  if (profileLines.length > 0) {
    reply.push("");
    reply.push(...profileLines);
  } else if (noProfile) {
    reply.push("");
    reply.push(noProfile);
  }
  if (capabilityRequest && capabilityLines.length > 0) {
    reply.push("");
    reply.push(...capabilityLines);
  }
  reply.push("");
  reply.push("Use `squidbot whoami` for a structured summary, `squidbot trust` for the live security posture, or `squidbot onboarding` to pick a profile.");
  return reply.join("\n");
}

function collectSection(lines: string[], header: string): string[] {
  const start = lines.findIndex((line) => line.startsWith(header));
  if (start === -1) return [];
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (i > start && line.trim() === "") break;
    out.push(line);
  }
  return out;
}

function extractPath(message: string): string | null {
  const match = message.match(/(?:read|open|show)\s+([^\s]+)$/i);
  return match?.[1] ?? null;
}

export function generateDeterministicResponse(options: {
  request: ModelProviderRequest;
  provider: string;
  modelName: string;
  mode: ModelMode;
  costOwner: ModelCostOwner;
  contentPrefix?: string;
  costPerToken?: number;
}): ModelResponse {
  const rawMessage = latestUserMessage(options.request.messages);
  const message = rawMessage.toLowerCase();
  const systemPrompt = firstSystemMessage(options.request.messages);
  const toolCalls: ToolCall[] = [];
  let content =
    options.contentPrefix ??
    "Deterministic provider is active. I can safely inspect a local workspace and return traceable tool calls.";

  if (isIdentityIntent(rawMessage)) {
    content = buildIdentityResponse(systemPrompt, rawMessage);
    const promptTokens = estimateRequestTokens(options.request.messages, options.request.tools);
    const tokenUsage = usageFromText(promptTokens, content);
    return {
      provider: options.provider,
      modelName: options.modelName,
      mode: options.mode,
      costOwner: options.costOwner,
      content,
      toolCalls,
      tokenUsage,
      costEstimate: options.costPerToken ? tokenUsage.totalTokens * options.costPerToken : 0
    };
  }

  const connectorTool = pickConnectorTool(options.request.tools, message);

  if (connectorTool && isConnectorIntent(message)) {
    toolCalls.push({
      id: "call_connector_fixture",
      name: connectorTool.name,
      args: {}
    });
    content = "I will call the registered connector through the policy-controlled fixture path.";
  } else if (message.includes("list") || message.includes("files")) {
    toolCalls.push({
      id: "call_list_files",
      name: "workspace.listFiles",
      args: {}
    });
    content = "I will list the selected workspace files using the read-only workspace tool.";
  } else if (message.includes("read") || message.includes("open") || message.includes("show")) {
    toolCalls.push({
      id: "call_read_file",
      name: "workspace.readFile",
      args: { path: extractPath(message) ?? "README.md" }
    });
    content = "I will read that file through the workspace read tool.";
  } else if (message.includes("fix") || message.includes("patch") || message.includes("change")) {
    toolCalls.push({
      id: "call_propose_patch",
      name: "workspace.proposePatch",
      args: {
        patch:
          "--- a/calculator.py\n+++ b/calculator.py\n@@\n-    return a - b\n+    return a + b\n"
      } satisfies JsonObject
    });
    content = "I can draft a patch for review. This phase never applies writes automatically.";
  } else if (message.includes("test") || message.includes("run")) {
    toolCalls.push({
      id: "call_dry_run",
      name: "terminal.dryRun",
      args: { command: "python -m pytest" }
    });
    content = "I will record the intended command as a dry run. It will not be executed.";
  }

  const promptTokens = estimateRequestTokens(options.request.messages, options.request.tools);
  const tokenUsage = usageFromText(promptTokens, content);

  return {
    provider: options.provider,
    modelName: options.modelName,
    mode: options.mode,
    costOwner: options.costOwner,
    content,
    toolCalls,
    tokenUsage,
    costEstimate: options.costPerToken ? tokenUsage.totalTokens * options.costPerToken : 0
  };
}

export function generateDeterministicTaskPlan(request: TaskPlanRequest): TaskPlan {
  const missingToolMatch = request.task.match(/(?:use|call)\s+([a-zA-Z][a-zA-Z0-9_.-]*nonexistent[a-zA-Z0-9_.-]*|nonexistent[a-zA-Z0-9_.-]*)/i);
  if (missingToolMatch) {
    const toolName = missingToolMatch[1];
    return {
      id: createId("plan"),
      problem: `The requested task explicitly depends on unavailable tool ${toolName}.`,
      riskLevel: "medium",
      actions: [
        {
          id: createId("action"),
          description: `Attempt requested unavailable tool ${toolName} so the runtime can record the affordance gap.`,
          toolName,
          args: { requestedByTask: request.task } satisfies JsonObject
        }
      ]
    };
  }

  const connectorTool = pickConnectorTool(request.tools ?? [], request.task.toLowerCase());
  if (connectorTool && isConnectorIntent(request.task.toLowerCase())) {
    return {
      id: createId("plan"),
      problem: "The planner selected a registered connector operation and will call it through fixture mode.",
      riskLevel: "low",
      actions: [
        {
          id: createId("action"),
          description: `Call ${connectorTool.name} using the connector policy path.`,
          toolName: connectorTool.name,
          args: {} satisfies JsonObject
        }
      ]
    };
  }

  const files = new Set([
    ...request.workspaceSummary.topLevelEntries,
    ...request.workspaceSummary.keyFiles.map((file) => file.path)
  ]);
  const hasCalculator = files.has("calculator.py");
  const hasCalculatorTest = files.has("test_calculator.py");
  const targetFile = hasCalculator ? "calculator.py" : request.workspaceSummary.keyFiles[0]?.path ?? "README.md";
  const testFile = hasCalculatorTest ? "test_calculator.py" : targetFile;
  const patch = hasCalculator
    ? "--- a/calculator.py\n+++ b/calculator.py\n@@\n def add(a, b):\n-    return a - b\n+    return a + b\n"
    : `--- a/${targetFile}\n+++ b/${targetFile}\n@@\n+# Draft patch placeholder generated by the deterministic provider.\n`;

  const actions: TaskPlan["actions"] = [
    {
      id: createId("action"),
      description: `Read ${testFile} to understand the failing expectation.`,
      toolName: "workspace.readFile",
      args: { path: testFile } satisfies JsonObject
    },
    {
      id: createId("action"),
      description: `Read ${targetFile} to inspect the implementation.`,
      toolName: "workspace.readFile",
      args: { path: targetFile } satisfies JsonObject
    },
    {
      id: createId("action"),
      description: "Search for the function or symbol involved in the task.",
      toolName: "workspace.searchFiles",
      args: { pattern: hasCalculator ? "def add|add\\(" : request.task.split(/\s+/)[0] ?? "", regex: hasCalculator } satisfies JsonObject
    },
    {
      id: createId("action"),
      description: "Create a draft unified diff for review without applying it.",
      toolName: "workspace.createPatch",
      args: { patch } satisfies JsonObject
    }
  ];

  if (request.testCommand) {
    actions.push({
      id: createId("action"),
      description: "Run the requested test command in a copied workspace sandbox.",
      toolName: "test.run",
      args: { command: request.testCommand } satisfies JsonObject
    });
  }

  const pullRequestTool = findPullRequestWriteTool(request.tools ?? [], request.task.toLowerCase());
  if (pullRequestTool) {
    actions.push({
      id: createId("action"),
      description: "Prepare the requested draft PR through the connector approval gate.",
      toolName: pullRequestTool.name,
      args: {
        title: "Fix calculator add function",
        base: "main",
        head: "squidbot/fix-add",
        draft: true
      } satisfies JsonObject
    });
  }

  return {
    id: createId("plan"),
    problem: request.memoryBulletin
      ? "The planner considered the approved memory bulletin and identified a likely implementation mismatch causing the fixture test to fail."
      : "The planner identified a likely implementation mismatch causing the fixture test to fail.",
    riskLevel: "medium",
    actions
  };
}

export function pickConnectorTool(tools: ToolSchema[] = [], message = ""): ToolSchema | null {
  const connectorTools = tools.filter((tool) => tool.name.startsWith("connector."));
  if (connectorTools.length === 0) {
    return null;
  }

  const lowered = message.toLowerCase();
  const matchingTool =
    connectorTools.find((tool) => lowered.includes(tool.name.toLowerCase().split(".").at(-1) ?? "")) ??
    connectorTools.find((tool) => lowered.includes(tool.name.toLowerCase().split(".")[1] ?? "")) ??
    connectorTools.find((tool) => lowered.includes("pull request") && tool.name.toLowerCase().includes("pullrequest")) ??
    connectorTools.find((tool) => lowered.includes("merge request") && tool.name.toLowerCase().includes("mergerequest")) ??
    connectorTools.find((tool) => lowered.includes("pr") && tool.name.toLowerCase().includes("pullrequest")) ??
    connectorTools.find((tool) => lowered.includes("issue") && tool.name.toLowerCase().includes("issue")) ??
    connectorTools.find((tool) => lowered.includes("jira") && tool.name.toLowerCase().includes("jira")) ??
    connectorTools.find((tool) => (lowered.includes("ci") || lowered.includes("workflow") || lowered.includes("pipeline") || lowered.includes("build")) && /workflow|pipeline|build/i.test(tool.name)) ??
    connectorTools.find((tool) => (lowered.includes("github actions") || lowered.includes("actions")) && tool.name.toLowerCase().includes("workflow")) ??
    connectorTools.find((tool) => lowered.includes("github") && tool.name.toLowerCase().includes("github")) ??
    connectorTools.find((tool) => lowered.includes("gitlab") && tool.name.toLowerCase().includes("gitlab")) ??
    connectorTools.find((tool) => lowered.includes("jenkins") && tool.name.toLowerCase().includes("jenkins")) ??
    connectorTools.find((tool) => lowered.includes("pet") && tool.name.toLowerCase().includes("pet")) ??
    connectorTools.find((tool) => lowered.includes("post") && tool.name.toLowerCase().includes("post")) ??
    connectorTools.find((tool) => lowered.includes("sales") && tool.name.toLowerCase().includes("sales")) ??
    connectorTools.find((tool) => tool.permissionScopes?.includes("connector.read"));

  return matchingTool ?? connectorTools[0] ?? null;
}

function findPullRequestWriteTool(tools: ToolSchema[], message: string): ToolSchema | null {
  if (!/\bpr\b|pull request|merge request|draft pr|draft pull/i.test(message)) {
    return null;
  }

  return (
    tools.find((tool) => tool.name === "connector.github.openDraftPullRequest") ??
    tools.find((tool) => tool.name === "connector.gitlab.openMergeRequest") ??
    tools.find((tool) => tool.name.toLowerCase().includes("opendraftpullrequest")) ??
    tools.find((tool) => tool.name.toLowerCase().includes("openmergerequest")) ??
    null
  );
}

function isConnectorIntent(message: string): boolean {
  return (
    message.includes("connector") ||
    message.includes("pet") ||
    message.includes("post") ||
    message.includes("sales") ||
    message.includes("github") ||
    message.includes("gitlab") ||
    message.includes("jira") ||
    message.includes("jenkins") ||
    message.includes("issue") ||
    message.includes("pull request") ||
    message.includes("merge request") ||
    message.includes("workflow") ||
    message.includes("pipeline") ||
    message.includes("ci")
  );
}
