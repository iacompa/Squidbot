export const governanceEventTypes = [
  "governance.bootstrap.completed",
  "governance.policy.decided",
  "governance.policy.denied",
  "governance.secret.created",
  "governance.secret.read",
  "governance.audit.appended",
  "governance.audit.exported",
  "governance.retention.applied",
  "governance.lineage.recorded",
  "governance.n8n.received",
  "governance.n8n.denied"
] as const;
