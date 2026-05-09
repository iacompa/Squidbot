import type { SkillService } from "./service.js";
import type { SkillManifest, SkillStatus } from "./manifest.js";

const now = "2026-05-02T00:00:00.000Z";

const developerWorkflowSkills: SkillManifest[] = [
  {
    id: "skill_issue_triage",
    name: "Issue Triage",
    version: "0.1.0",
    description: "Read repository and tracker issues, prioritize them, and draft label/comment updates through approval-gated connectors.",
    requiredTools: ["connector.github.listIssues", "connector.jira.listIssues", "connector.github.addIssueComment", "connector.github.addLabels"],
    prompts: {
      planningPrompt: "Inspect open issues, classify bug and feature work, then draft a deterministic triage plan.",
      reviewPrompt: "Never mutate the tracker without connector approval. Prefer fixture mode unless configured otherwise."
    },
    testFixtures: [
      {
        id: "fixture_issue_triage",
        name: "Fixture issue triage",
        task: "Call github connector listIssues and prioritize open issues",
        expectedResult: {
          topIssue: "GH-101",
          label: "triaged"
        }
      }
    ],
    permissions: {
      "connector.github.listIssues": { riskLevel: "low", scopes: ["repo:read"] },
      "connector.jira.listIssues": { riskLevel: "low", scopes: ["jira:read"] },
      "connector.github.addIssueComment": { riskLevel: "high", scopes: ["repo:write"] },
      "connector.github.addLabels": { riskLevel: "high", scopes: ["repo:write"] }
    },
    createdAt: now,
    updatedAt: now,
    author: "SquidBot",
    tags: ["developer-workflow", "triage"],
    domains: ["issues", "ticketing"]
  },
  {
    id: "skill_pull_request_reviewer",
    name: "Pull Request Reviewer",
    version: "0.1.0",
    description: "Fetch a pull request diff, run local verification in sandbox mode, and draft review feedback.",
    requiredTools: ["connector.github.readDiff", "workspace.readFile", "workspace.searchFiles", "test.run", "connector.github.commentOnPullRequest"],
    prompts: {
      planningPrompt: "Fetch the PR diff, inspect relevant files, run safe tests, and summarize risks.",
      reviewPrompt: "Write concise review notes with file-level concerns. Do not post comments without approval."
    },
    testFixtures: [
      {
        id: "fixture_pr_review",
        name: "Fixture PR review",
        task: "Call github connector readDiff and review the pull request",
        expectedResult: {
          reviewed: true,
          connector: "github"
        }
      }
    ],
    permissions: {
      "connector.github.readDiff": { riskLevel: "low", scopes: ["repo:read"] },
      "workspace.readFile": { riskLevel: "low" },
      "workspace.searchFiles": { riskLevel: "low" },
      "test.run": { riskLevel: "medium" },
      "connector.github.commentOnPullRequest": { riskLevel: "high", scopes: ["pull_request:write"] }
    },
    createdAt: now,
    updatedAt: now,
    author: "SquidBot",
    tags: ["developer-workflow", "review"],
    domains: ["pull-requests", "code-review"]
  },
  {
    id: "skill_auto_fix_and_pr",
    name: "Auto-Fix and PR",
    version: "0.1.0",
    description: "Draft a bug fix in a sandbox, verify tests, then prepare approval-gated branch, commit, PR, and ticket updates.",
    requiredTools: [
      "workspace.readFile",
      "workspace.searchFiles",
      "workspace.createPatch",
      "test.run",
      "connector.github.createBranch",
      "connector.github.pushCommit",
      "connector.github.openDraftPullRequest",
      "connector.jira.addComment"
    ],
    prompts: {
      planningPrompt: "Inspect the failure, create the smallest patch, run tests in a sandbox, and draft external writes only after approval.",
      codingPrompt: "Prefer minimal diffs and include test output in the PR description.",
      reviewPrompt: "Summarize the sandbox diff, test result, approval requirements, and linked ticket."
    },
    testFixtures: [
      {
        id: "fixture_auto_fix_pr",
        name: "Fixture auto fix and PR",
        task: "Fix calculator add function and open a draft PR",
        testCommand: "pytest",
        expectedDiff: "--- a/calculator.py\n+++ b/calculator.py\n@@\n def add(a, b):\n-    return a - b\n+    return a + b\n"
      }
    ],
    permissions: {
      "workspace.readFile": { riskLevel: "low" },
      "workspace.searchFiles": { riskLevel: "low" },
      "workspace.createPatch": { riskLevel: "medium" },
      "test.run": { riskLevel: "medium" },
      "connector.github.createBranch": { riskLevel: "high", scopes: ["repo:write"] },
      "connector.github.pushCommit": { riskLevel: "high", scopes: ["repo:write"] },
      "connector.github.openDraftPullRequest": { riskLevel: "high", scopes: ["pull_request:write"] },
      "connector.jira.addComment": { riskLevel: "high", scopes: ["jira:write"] }
    },
    createdAt: now,
    updatedAt: now,
    author: "SquidBot",
    tags: ["developer-workflow", "autofix", "pull-request"],
    domains: ["ci", "pull-requests", "issues"]
  }
];

export function installDeveloperWorkflowSkills(service: SkillService, options: { status?: SkillStatus } = {}): SkillManifest[] {
  const installed: SkillManifest[] = [];
  for (const manifest of developerWorkflowSkills) {
    if (!service.getSkill(manifest.id)) {
      service.saveVersion(manifest, { status: options.status ?? "draft", packagePath: null });
      installed.push(manifest);
    }
  }
  return installed;
}

export function listDeveloperWorkflowSkillTemplates(): SkillManifest[] {
  return developerWorkflowSkills.map((manifest) => ({ ...manifest }));
}
