export type PolicyPackSummary = {
  id: string;
  name: string;
  description: string;
  rules: string[];
};

export const policyPacks: PolicyPackSummary[] = [
  {
    id: "developer-safe-default",
    name: "Developer Safe Default",
    description: "Sandbox writes, require approval for real promotion, block paid providers by default.",
    rules: ["sandboxForWrites", "approvalForPromotion", "zeroSpendDefault"]
  },
  {
    id: "air-gapped-default",
    name: "Air-Gapped Default",
    description: "Block external models, real network connectors, and outbound messaging by default.",
    rules: ["networkDeny", "localModelsOnly", "fixtureConnectorsOnly"]
  },
  {
    id: "high-stakes-healthcare",
    name: "High-Stakes Healthcare",
    description: "Treat PHI-like or restricted data as high stakes with stronger audit and approval obligations.",
    rules: ["restrictedDataNoExternalModel", "criticalActionsRequireDomainSignoff", "strongRetention"]
  },
  {
    id: "regulated-finance",
    name: "Regulated Finance",
    description: "Read-only regulated connectors and strict audit retention for financial workflows.",
    rules: ["regulatedConnectorsReadOnly", "auditRetentionRequired"]
  },
  {
    id: "legal-review",
    name: "Legal Review",
    description: "Require review before external sharing, deletion, or final legal-facing outputs.",
    rules: ["externalShareApproval", "legalHoldAwareRetention"]
  },
  {
    id: "public-sector",
    name: "Public Sector",
    description: "Conservative public-sector defaults for audit, retention, and external service use.",
    rules: ["localFirst", "auditExportRequired", "externalServiceApproval"]
  },
  {
    id: "critical-infrastructure",
    name: "Critical Infrastructure",
    description: "Block destructive or operational connector actions without explicit high-trust signoff.",
    rules: ["criticalConnectorSignoff", "networkDenyByDefault"]
  },
  {
    id: "n8n-automation-safe-default",
    name: "n8n Automation Safe Default",
    description: "Allow low-risk n8n notifications and requests while blocking secret reveal and high-risk approvals.",
    rules: ["n8nNoSecretReveal", "n8nLowRiskOnly", "n8nSignedPayloads"]
  }
];
