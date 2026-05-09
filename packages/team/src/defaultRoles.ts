import type { AgentRoleManifest, TeamManifest } from "./types.js";

export const defaultRoleManifests: AgentRoleManifest[] = [
  {
    id: "coordinator",
    name: "Coordinator",
    description: "Decomposes tasks, assigns subtasks, monitors progress, requests handoffs, and synthesizes the final result.",
    defaultModelProvider: "mock",
    capabilities: ["decompose", "route", "synthesize", "handoff"],
    responsibilities: ["Create task graphs", "Assign roles", "Keep work auditable", "Produce final synthesis"],
    allowedTools: ["team.blackboard.read", "team.blackboard.write", "team.message", "team.handoff.request"],
    deniedTools: ["workspace.writeFile", "workspace.createPatch", "sandbox.promote"],
    requiredApprovals: {
      riskLevels: ["medium", "high"]
    },
    memoryDomains: {
      read: ["public", "project", "team"],
      write: ["team", "reflection"]
    },
    sandboxPolicy: {
      requiredForWrites: true,
      networkPolicy: "deny"
    },
    promptTemplates: {
      system: "Coordinate role-scoped work. Do not directly modify files. Use evidence from the blackboard.",
      task: "Break the parent task into auditable subtasks and synthesize verified outcomes.",
      handoff: "Ask concise human questions when risk or ambiguity blocks progress."
    },
    riskLimits: {
      maxToolRisk: "medium",
      canRequestHumanApproval: true,
      canModifyWorkspace: false,
      canCallConnectors: false,
      canWriteMemory: true
    }
  },
  {
    id: "researcher",
    name: "Researcher",
    description: "Reads repository files, documentation, connector fixtures, and memory to post sourced evidence.",
    defaultModelProvider: "mock",
    capabilities: ["research", "readFiles", "summarize", "cite"],
    responsibilities: ["Inspect tests and implementation", "Summarize evidence", "Declare assumptions"],
    allowedTools: ["workspace.listFiles", "workspace.readFile", "workspace.searchFiles", "memory.read", "connector.fixture.read"],
    deniedTools: ["workspace.createPatch", "workspace.writeFile", "sandbox.promote", "connector.write"],
    memoryDomains: {
      read: ["public", "project", "docs"],
      write: ["team"]
    },
    sandboxPolicy: {
      requiredForWrites: true,
      networkPolicy: "deny"
    },
    promptTemplates: {
      system: "You are a read-only researcher. Post evidence, not edits."
    },
    riskLimits: {
      maxToolRisk: "low",
      canRequestHumanApproval: false,
      canModifyWorkspace: false,
      canCallConnectors: true,
      canWriteMemory: false
    }
  },
  {
    id: "implementer",
    name: "Implementer",
    description: "Proposes patches and implementation plans, with all writes staged through sandbox or approval gates.",
    defaultModelProvider: "mock",
    capabilities: ["patch", "code", "analyzeFailure"],
    responsibilities: ["Use researcher evidence", "Produce minimal patches", "Avoid promotion without approval"],
    allowedTools: ["workspace.readFile", "workspace.searchFiles", "workspace.createPatch", "sandbox.applyPatch", "sandbox.diff"],
    deniedTools: ["sandbox.promote", "connector.write"],
    requiredApprovals: {
      toolPatterns: ["sandbox.promote", "workspace.writeFile"],
      riskLevels: ["medium", "high"]
    },
    memoryDomains: {
      read: ["public", "project", "code", "team"],
      write: ["team"]
    },
    sandboxPolicy: {
      requiredForWrites: true,
      networkPolicy: "deny",
      maxRuntimeMs: 120000
    },
    promptTemplates: {
      system: "You propose minimal code changes. Never promote changes to the real workspace."
    },
    riskLimits: {
      maxToolRisk: "medium",
      canRequestHumanApproval: true,
      canModifyWorkspace: true,
      canCallConnectors: false,
      canWriteMemory: false
    }
  },
  {
    id: "tester",
    name: "Tester",
    description: "Runs verification in sandboxed workspaces and reports test outcomes.",
    defaultModelProvider: "mock",
    capabilities: ["test", "verify", "sandbox"],
    responsibilities: ["Run sandbox tests", "Record outputs", "Report failures without modifying the real workspace"],
    allowedTools: ["sandbox.create", "sandbox.applyPatch", "sandbox.runCommand", "sandbox.diff", "sandbox.destroy", "test.run"],
    deniedTools: ["workspace.writeFile", "sandbox.promote", "connector.write"],
    memoryDomains: {
      read: ["public", "project", "team"],
      write: ["team"]
    },
    sandboxPolicy: {
      requiredForWrites: true,
      networkPolicy: "deny",
      maxRuntimeMs: 120000
    },
    promptTemplates: {
      system: "You verify proposed changes in sandbox mode and report exact outcomes."
    },
    riskLimits: {
      maxToolRisk: "medium",
      canRequestHumanApproval: false,
      canModifyWorkspace: false,
      canCallConnectors: false,
      canWriteMemory: false
    }
  },
  {
    id: "reviewer",
    name: "Reviewer",
    description: "Reviews evidence, patches, test results, and risks before final synthesis.",
    defaultModelProvider: "mock",
    capabilities: ["review", "risk", "decision"],
    responsibilities: ["Validate patch/test alignment", "Flag blockers", "Separate verified facts from proposals"],
    allowedTools: ["team.blackboard.read", "workspace.readFile", "sandbox.diff"],
    deniedTools: ["workspace.createPatch", "workspace.writeFile", "sandbox.promote", "connector.write"],
    memoryDomains: {
      read: ["public", "project", "team"],
      write: ["team"]
    },
    sandboxPolicy: {
      requiredForWrites: true,
      networkPolicy: "deny"
    },
    promptTemplates: {
      system: "You review proposed work and flag risks. You do not edit files."
    },
    riskLimits: {
      maxToolRisk: "low",
      canRequestHumanApproval: true,
      canModifyWorkspace: false,
      canCallConnectors: false,
      canWriteMemory: false
    }
  },
  {
    id: "securityReviewer",
    name: "Security Reviewer",
    description: "Reviews risky operations, secrets, sensitive memory, and connector writes.",
    defaultModelProvider: "mock",
    capabilities: ["security", "policy", "redaction", "risk"],
    responsibilities: ["Create risk entries", "Require handoff for sensitive actions", "Check secrets and connector writes"],
    allowedTools: ["team.blackboard.read", "team.blackboard.write", "memory.read", "team.handoff.request"],
    deniedTools: ["workspace.writeFile", "workspace.createPatch", "sandbox.promote", "connector.write"],
    memoryDomains: {
      read: ["public", "project", "team", "risk"],
      write: ["team", "risk"]
    },
    sandboxPolicy: {
      requiredForWrites: true,
      networkPolicy: "deny"
    },
    promptTemplates: {
      system: "You identify security and privacy risk. Escalate high-risk actions."
    },
    riskLimits: {
      maxToolRisk: "medium",
      canRequestHumanApproval: true,
      canModifyWorkspace: false,
      canCallConnectors: false,
      canWriteMemory: true
    }
  },
  {
    id: "releaseCoordinator",
    name: "Release Coordinator",
    description: "Drafts PR, ticket, and CI workflow actions through fixture-first connectors and approval gates.",
    defaultModelProvider: "mock",
    capabilities: ["release", "developerConnectors", "draftPr", "ticketUpdate"],
    responsibilities: ["Prepare draft PR/ticket updates", "Use fixture mode by default", "Require approval for real connector writes"],
    allowedTools: [
      "connector.github.listIssues",
      "connector.github.openDraftPullRequest",
      "connector.github.addIssueComment",
      "connector.gitlab.openMergeRequest",
      "connector.jira.updateIssue",
      "connector.jenkins.triggerBuild"
    ],
    deniedTools: ["sandbox.promote"],
    requiredApprovals: {
      connectorPatterns: ["connector.github.*", "connector.gitlab.*", "connector.jira.*", "connector.jenkins.*"],
      riskLevels: ["medium", "high"]
    },
    memoryDomains: {
      read: ["public", "project", "team", "release"],
      write: ["team", "release"]
    },
    sandboxPolicy: {
      requiredForWrites: true,
      networkPolicy: "deny"
    },
    promptTemplates: {
      system: "You prepare developer workflow actions. Connector writes require explicit approval."
    },
    riskLimits: {
      maxToolRisk: "high",
      canRequestHumanApproval: true,
      canModifyWorkspace: false,
      canCallConnectors: true,
      canWriteMemory: true
    }
  }
];

export const defaultTeamManifest: TeamManifest = {
  id: "engineering-core-team",
  name: "Engineering Core Team",
  description: "Default local-first engineering team with scoped research, implementation, testing, review, security, and release roles.",
  roles: ["coordinator", "researcher", "implementer", "tester", "reviewer", "securityReviewer", "releaseCoordinator"],
  coordinatorRoleId: "coordinator",
  defaultPolicy: {
    maxConcurrentAgents: 3,
    requireHumanForHighRisk: true,
    requireSandboxForWrites: true,
    allowPaidModels: false,
    allowRealConnectorWrites: false
  },
  taskRoutingRules: [
    { match: "test|pytest|verify", preferredRoleId: "tester", requiredCapabilities: ["test"] },
    { match: "patch|fix|code|bug", preferredRoleId: "implementer", requiredCapabilities: ["patch"] },
    { match: "\\b(github|gitlab|jira|pr|pull request|ticket)\\b", preferredRoleId: "releaseCoordinator", requiredCapabilities: ["developerConnectors"] },
    { match: "risk|security|secret|permission", preferredRoleId: "securityReviewer", requiredCapabilities: ["security"] }
  ]
};
