import fs from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SquidDatabase } from "@squidbot/db";
import {
  DEFAULT_N8N_SERVICE_ACCOUNT_ID,
  DEFAULT_TENANT_ID,
  type N8nIntegrationRecord
} from "./types.js";
import { createId, nowIso, parseJson, redactForStorage } from "./internal.js";
import { GovernancePolicyEngine } from "./policyEngine.js";

type IntegrationRow = Omit<N8nIntegrationRecord, "direction" | "authMode" | "allowedEventTypes" | "allowedActions" | "enabled"> & {
  direction: "inbound" | "outbound";
  authMode: "hmac" | "jwt" | "header" | "basic" | "none";
  allowedEventTypesJson: string;
  allowedActionsJson: string;
  enabled: number;
};

export class N8nGovernanceBridge {
  private readonly policy: GovernancePolicyEngine;
  private readonly fixtureSecret = "squidbot-n8n-fixture-secret";

  constructor(private readonly database: SquidDatabase) {
    this.policy = new GovernancePolicyEngine(database);
  }

  createIntegration(input: { id?: string; tenantId?: string; name: string; direction: "inbound" | "outbound"; events?: string[]; actions?: string[]; enabled?: boolean; authMode?: N8nIntegrationRecord["authMode"] }): N8nIntegrationRecord {
    const now = nowIso();
    const id = input.id ?? createId("n8n_integration");
    this.database.db
      .prepare(
        `INSERT INTO n8n_webhook_integrations (
          id, tenantId, name, direction, authMode, allowedEventTypesJson, allowedActionsJson, enabled, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.tenantId ?? DEFAULT_TENANT_ID, input.name, input.direction, input.authMode ?? "hmac", JSON.stringify(input.events ?? []), JSON.stringify(input.actions ?? []), input.enabled ? 1 : 0, now, now);
    return this.getIntegration(id)!;
  }

  listIntegrations(tenantId = DEFAULT_TENANT_ID): N8nIntegrationRecord[] {
    const rows = this.database.db.prepare(`SELECT * FROM n8n_webhook_integrations WHERE tenantId = ? ORDER BY createdAt DESC`).all(tenantId) as IntegrationRow[];
    return rows.map(mapIntegration);
  }

  enableIntegration(id: string, enabled = true): N8nIntegrationRecord {
    this.database.db.prepare(`UPDATE n8n_webhook_integrations SET enabled = ?, updatedAt = ? WHERE id = ?`).run(enabled ? 1 : 0, nowIso(), id);
    const integration = this.getIntegration(id);
    if (!integration) {
      throw new Error(`n8n integration not found: ${id}`);
    }
    return integration;
  }

  testIntegration(id: string): { ok: boolean; integration: N8nIntegrationRecord; signature: string; payload: unknown } {
    const integration = this.requireIntegration(id);
    const payload = { eventType: integration.allowedEventTypes[0] ?? "policy.violation", source: "fixture", integrationId: id };
    return { ok: integration.enabled, integration, signature: this.signPayload(payload), payload: redactForStorage(payload) };
  }

  receiveFixture(filePath: string): { accepted: boolean; status: string; eventId: string; reason?: string } {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    const integrationId = String(payload.integrationId ?? "");
    const integration = this.getIntegration(integrationId);
    const eventType = String(payload.eventType ?? "unknown");
    const idempotencyKey = typeof payload.idempotencyKey === "string" ? payload.idempotencyKey : null;
    const signature = typeof payload.signature === "string" ? payload.signature : "";
    const signatureValid = this.verifyPayloadSignature(payload, signature);
    const existing =
      idempotencyKey && integration
        ? (this.database.db
            .prepare(`SELECT id FROM governance_webhook_events WHERE tenantId = ? AND integrationId = ? AND idempotencyKey = ? LIMIT 1`)
            .get(integration.tenantId, integration.id, idempotencyKey) as { id: string } | undefined)
        : undefined;

    let accepted = false;
    let status = "denied";
    let reason: string | undefined;
    if (!integration) {
      reason = "integration not found";
    } else if (!integration.enabled) {
      reason = "integration disabled";
    } else if (!signatureValid && integration.authMode !== "none") {
      reason = "invalid signature";
    } else if (existing) {
      reason = "duplicate idempotency key";
      status = "duplicate";
    } else if (integration.allowedEventTypes.length && !integration.allowedEventTypes.includes(eventType)) {
      reason = "event type not allowed";
    } else {
      const action = String(payload.action ?? "n8n.receive");
      const decision = this.policy.decide({
        tenantId: integration.tenantId,
        actor: { type: "serviceAccount", id: DEFAULT_N8N_SERVICE_ACCOUNT_ID },
        action,
        resource: { type: "n8n", id: integration.id },
        context: { source: "n8n", riskLevel: payload.riskLevel === "high" ? "high" : "low" }
      });
      accepted = decision.decision === "allow";
      status = accepted ? "accepted" : "denied";
      reason = accepted ? undefined : decision.reason;
    }

    const eventId = createId("n8n_event");
    this.database.db
      .prepare(
        `INSERT INTO governance_webhook_events (
          id, tenantId, integrationId, direction, eventType, status, payloadJson, redactedPayloadJson,
          signatureValid, idempotencyKey, createdAt, processedAt
        ) VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        eventId,
        integration?.tenantId ?? DEFAULT_TENANT_ID,
        integration?.id ?? null,
        eventType,
        status,
        JSON.stringify(redactForStorage(payload)),
        JSON.stringify(redactForStorage(payload)),
        signatureValid ? 1 : 0,
        idempotencyKey,
        nowIso(),
        nowIso()
      );
    return { accepted, status, eventId, reason };
  }

  listEvents(limit = 20): unknown[] {
    return this.database.db.prepare(`SELECT * FROM governance_webhook_events ORDER BY createdAt DESC LIMIT ?`).all(limit);
  }

  templates(): string[] {
    return [
      "compliance-alert-routing",
      "approval-request-routing",
      "audit-export-notification",
      "budget-alert-routing",
      "secret-rotation-reminder",
      "highstakes-domain-signoff",
      "retention-report-request"
    ];
  }

  signPayload(payload: unknown): string {
    return createHmac("sha256", this.fixtureSecret).update(JSON.stringify(redactForStorage(payload))).digest("hex");
  }

  private verifyPayloadSignature(payload: Record<string, unknown>, signature: string): boolean {
    const { signature: _signature, ...unsigned } = payload;
    const expected = this.signPayload(unsigned);
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private getIntegration(id: string): N8nIntegrationRecord | null {
    const row = this.database.db.prepare(`SELECT * FROM n8n_webhook_integrations WHERE id = ?`).get(id) as IntegrationRow | undefined;
    return row ? mapIntegration(row) : null;
  }

  private requireIntegration(id: string): N8nIntegrationRecord {
    const integration = this.getIntegration(id);
    if (!integration) {
      throw new Error(`n8n integration not found: ${id}`);
    }
    return integration;
  }
}

function mapIntegration(row: IntegrationRow): N8nIntegrationRecord {
  return {
    ...row,
    allowedEventTypes: parseJson(row.allowedEventTypesJson, []),
    allowedActions: parseJson(row.allowedActionsJson, []),
    enabled: Boolean(row.enabled)
  };
}
