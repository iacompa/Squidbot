import type { BlackboardEntry, TeamConflict, TeamSynthesis } from "./types.js";

export function createTeamSynthesis(input: {
  teamRunId: string;
  entries: BlackboardEntry[];
  conflicts: TeamConflict[];
  traceIds?: string[];
  memoryNodeIds?: string[];
}): TeamSynthesis {
  const entries = input.entries.filter((entry) => !entry.deletedAt);
  const blockers = entries.filter((entry) => entry.type === "blocker").map((entry) => entry.body);
  const risks = [
    ...entries.filter((entry) => entry.type === "risk").map((entry) => entry.body),
    ...input.conflicts.filter((conflict) => conflict.status === "open").map((conflict) => conflict.description)
  ];
  const decisions = entries.filter((entry) => entry.type === "decision").map((entry) => entry.body);
  const patch = entries.find((entry) => entry.type === "patch");
  const testResult = [...entries].reverse().find((entry) => entry.type === "testResult");
  const handoffs = entries.filter((entry) => entry.type === "handoff").map((entry) => entry.body);
  const status =
    blockers.length > 0 || handoffs.length > 0 || input.conflicts.some((conflict) => conflict.status === "open" && conflict.severity === "high")
      ? "blocked"
      : "completed";
  const roleIds = [...new Set(entries.map((entry) => entry.authorRoleId).filter((role): role is string => Boolean(role)))];
  const roleSummaries = roleIds.map((roleId) => {
    const roleEntries = entries.filter((entry) => entry.authorRoleId === roleId);
    return {
      roleId,
      summary: roleEntries.map((entry) => `${entry.type}: ${entry.title}`).join("; ") || "No public blackboard output.",
      evidenceEntryIds: roleEntries.filter((entry) => entry.type === "evidence" || entry.type === "observation").map((entry) => entry.id)
    };
  });

  const finalAnswer = [
    status === "completed" ? "Team run completed with sandboxed, inspectable outputs." : "Team run is blocked and needs human review.",
    patch ? `Patch proposed: ${patch.title}.` : "No patch was proposed.",
    testResult ? `Verification: ${testResult.body}` : "Verification was not completed.",
    risks.length ? `Risks: ${risks.join(" ")}` : "No unresolved high-severity risks were recorded.",
    blockers.length ? `Blockers: ${blockers.join(" ")}` : ""
  ]
    .filter(Boolean)
    .join(" ");

  return {
    teamRunId: input.teamRunId,
    status,
    finalAnswer,
    roleSummaries,
    decisions,
    risks,
    blockers,
    patchSummary: patch?.body,
    testSummary: testResult?.body,
    approvalRequests: handoffs,
    traceIds: input.traceIds ?? [],
    memoryNodeIds: input.memoryNodeIds ?? []
  };
}
