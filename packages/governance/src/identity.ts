import type { SquidDatabase } from "@squidbot/db";
import {
  DEFAULT_ADMIN_USER_ID,
  DEFAULT_N8N_SERVICE_ACCOUNT_ID,
  DEFAULT_ORG_ID,
  DEFAULT_TENANT_ID,
  type PrincipalType,
  type RoleAssignmentRecord,
  type RoleRecord,
  type UserRecord
} from "./types.js";
import { createId, nowIso, parseJson } from "./internal.js";

const defaultRoles: Array<{ id: string; name: string; description: string; permissions: string[] }> = [
  { id: "role_owner", name: "owner", description: "Full local owner access.", permissions: ["*"] },
  { id: "role_admin", name: "admin", description: "Administrative access except raw secret reveal by default.", permissions: ["admin.*", "governance.*", "audit.read", "secret.write", "policy.*"] },
  { id: "role_securityAdmin", name: "securityAdmin", description: "Security policy, secrets, and approval governance.", permissions: ["security.*", "secret.*", "policy.*", "audit.read"] },
  { id: "role_complianceOfficer", name: "complianceOfficer", description: "Audit, retention, lineage, and compliance export.", permissions: ["audit.*", "retention.*", "lineage.*", "policy.read"] },
  { id: "role_developer", name: "developer", description: "Draft code changes and run local/sandbox workflows.", permissions: ["tool.workspace.read", "tool.workspace.createPatch", "sandbox.create", "sandbox.run", "skill.run", "eval.run", "trace.read"] },
  { id: "role_operator", name: "operator", description: "Operate scheduler, teams, messaging, and runs.", permissions: ["run.*", "job.*", "team.*", "messaging.*", "trace.read"] },
  { id: "role_reviewer", name: "reviewer", description: "Review traces, patches, evals, and team blackboards.", permissions: ["trace.read", "sandbox.read", "team.read", "eval.read"] },
  { id: "role_viewer", name: "viewer", description: "Read-only access.", permissions: ["*.read", "trace.read", "memory.read"] },
  { id: "role_auditor", name: "auditor", description: "Read audit and lineage evidence.", permissions: ["audit.read", "lineage.read", "trace.read"] },
  { id: "role_serviceAccount", name: "serviceAccount", description: "Base service account role with low-risk automation.", permissions: ["event.write", "policy.simulate"] },
  { id: "role_n8nAutomation", name: "n8nAutomation", description: "n8n fixture bridge role for low-risk automation.", permissions: ["n8n.receive", "n8n.emit", "audit.request", "run.lowRisk"] },
  { id: "role_messagingUser", name: "messagingUser", description: "Messaging channel user role.", permissions: ["messaging.command.lowRisk", "run.lowRisk"] },
  { id: "role_evalRunner", name: "evalRunner", description: "Run evaluations without promotion rights.", permissions: ["eval.run", "eval.read", "trace.read"] },
  { id: "role_readOnlyGuest", name: "readOnlyGuest", description: "Minimal guest read access.", permissions: ["trace.read"] }
];

type UserRow = Omit<UserRecord, "mfaEnabled" | "attributes"> & {
  mfaEnabled: number;
  attributesJson: string;
};

type RoleRow = Omit<RoleRecord, "permissions"> & {
  permissionsJson: string;
};

type AssignmentRow = Omit<RoleAssignmentRecord, "principalType" | "conditions"> & {
  principalType: PrincipalType;
  conditionsJson: string;
};

export class IdentityStore {
  constructor(private readonly database: SquidDatabase) {}

  bootstrap(): { organizationId: string; tenantId: string; adminUserId: string; rolesCreated: number } {
    const now = nowIso();
    this.database.db
      .prepare(
        `INSERT INTO organizations (id, name, slug, status, settingsJson, createdAt, updatedAt)
         VALUES (?, ?, ?, 'active', '{}', ?, ?)
         ON CONFLICT(id) DO UPDATE SET updatedAt = excluded.updatedAt`
      )
      .run(DEFAULT_ORG_ID, "Local Organization", "local-org", now, now);

    this.database.db
      .prepare(
        `INSERT INTO tenants (id, organizationId, name, slug, mode, status, settingsJson, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, 'singleTenant', 'active', '{}', ?, ?)
         ON CONFLICT(id) DO UPDATE SET updatedAt = excluded.updatedAt`
      )
      .run(DEFAULT_TENANT_ID, DEFAULT_ORG_ID, "Local Tenant", "local-tenant", now, now);

    this.createUser({
      id: DEFAULT_ADMIN_USER_ID,
      tenantId: DEFAULT_TENANT_ID,
      username: "local-admin",
      email: "local-admin@example.local",
      displayName: "Local Admin",
      authType: "local",
      attributes: { bootstrap: true }
    });
    this.createUser({
      id: DEFAULT_N8N_SERVICE_ACCOUNT_ID,
      tenantId: DEFAULT_TENANT_ID,
      username: "n8n-local",
      email: null,
      displayName: "n8n Local Service",
      authType: "service",
      attributes: { serviceAccount: true }
    });

    let rolesCreated = 0;
    for (const role of defaultRoles) {
      const existing = this.getRole(role.name, DEFAULT_TENANT_ID);
      this.database.db
        .prepare(
          `INSERT INTO governance_roles (id, tenantId, name, description, scope, permissionsJson, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, 'tenant', ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET description = excluded.description, permissionsJson = excluded.permissionsJson, updatedAt = excluded.updatedAt`
        )
        .run(role.id, DEFAULT_TENANT_ID, role.name, role.description, JSON.stringify(role.permissions), now, now);
      if (!existing) {
        rolesCreated += 1;
      }
    }

    this.assignRole({ principalType: "user", principalId: DEFAULT_ADMIN_USER_ID, roleName: "owner", tenantId: DEFAULT_TENANT_ID, scopeType: "tenant", scopeId: DEFAULT_TENANT_ID });
    this.assignRole({
      principalType: "serviceAccount",
      principalId: DEFAULT_N8N_SERVICE_ACCOUNT_ID,
      roleName: "n8nAutomation",
      tenantId: DEFAULT_TENANT_ID,
      scopeType: "tenant",
      scopeId: DEFAULT_TENANT_ID
    });

    return { organizationId: DEFAULT_ORG_ID, tenantId: DEFAULT_TENANT_ID, adminUserId: DEFAULT_ADMIN_USER_ID, rolesCreated };
  }

  createUser(input: {
    id?: string;
    tenantId?: string;
    username: string;
    email?: string | null;
    displayName?: string | null;
    authType?: string;
    attributes?: Record<string, unknown>;
  }): UserRecord {
    const now = nowIso();
    const id = input.id ?? createId("user");
    this.database.db
      .prepare(
        `INSERT INTO users (id, tenantId, email, username, displayName, status, authType, mfaEnabled, attributesJson, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, 'active', ?, 0, ?, ?, ?)
         ON CONFLICT(tenantId, username) DO UPDATE SET email = excluded.email, displayName = excluded.displayName, updatedAt = excluded.updatedAt`
      )
      .run(id, input.tenantId ?? DEFAULT_TENANT_ID, input.email ?? null, input.username, input.displayName ?? input.username, input.authType ?? "local", JSON.stringify(input.attributes ?? {}), now, now);
    return this.getUser(id) ?? this.getUserByUsername(input.username, input.tenantId ?? DEFAULT_TENANT_ID)!;
  }

  listUsers(tenantId = DEFAULT_TENANT_ID): UserRecord[] {
    const rows = this.database.db.prepare(`SELECT * FROM users WHERE tenantId = ? ORDER BY createdAt ASC`).all(tenantId) as UserRow[];
    return rows.map(mapUser);
  }

  getUser(userId: string): UserRecord | null {
    const row = this.database.db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as UserRow | undefined;
    return row ? mapUser(row) : null;
  }

  getUserByUsername(username: string, tenantId = DEFAULT_TENANT_ID): UserRecord | null {
    const row = this.database.db.prepare(`SELECT * FROM users WHERE tenantId = ? AND username = ?`).get(tenantId, username) as UserRow | undefined;
    return row ? mapUser(row) : null;
  }

  disableUser(userId: string): UserRecord {
    const now = nowIso();
    this.database.db.prepare(`UPDATE users SET status = 'disabled', disabledAt = ?, updatedAt = ? WHERE id = ?`).run(now, now, userId);
    const user = this.getUser(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }
    return user;
  }

  listRoles(tenantId = DEFAULT_TENANT_ID): RoleRecord[] {
    const rows = this.database.db.prepare(`SELECT * FROM governance_roles WHERE tenantId = ? OR tenantId IS NULL ORDER BY name ASC`).all(tenantId) as RoleRow[];
    return rows.map(mapRole);
  }

  getRole(roleNameOrId: string, tenantId = DEFAULT_TENANT_ID): RoleRecord | null {
    const row = this.database.db
      .prepare(`SELECT * FROM governance_roles WHERE (id = ? OR name = ?) AND (tenantId = ? OR tenantId IS NULL) LIMIT 1`)
      .get(roleNameOrId, roleNameOrId, tenantId) as RoleRow | undefined;
    return row ? mapRole(row) : null;
  }

  assignRole(input: {
    tenantId?: string;
    principalType: PrincipalType;
    principalId: string;
    roleName: string;
    scopeType?: string;
    scopeId?: string;
    conditions?: Record<string, unknown>;
    expiresAt?: string | null;
  }): RoleAssignmentRecord {
    const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
    const role = this.getRole(input.roleName, tenantId);
    if (!role) {
      throw new Error(`Role not found: ${input.roleName}`);
    }
    const now = nowIso();
    const existing = this.database.db
      .prepare(`SELECT id FROM role_assignments WHERE tenantId = ? AND principalType = ? AND principalId = ? AND roleId = ? AND scopeType = ? AND scopeId = ?`)
      .get(tenantId, input.principalType, input.principalId, role.id, input.scopeType ?? "tenant", input.scopeId ?? tenantId) as { id: string } | undefined;
    const id = existing?.id ?? createId("role_assignment");
    this.database.db
      .prepare(
        `INSERT INTO role_assignments (id, tenantId, principalType, principalId, roleId, scopeType, scopeId, conditionsJson, createdAt, updatedAt, expiresAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET conditionsJson = excluded.conditionsJson, updatedAt = excluded.updatedAt, expiresAt = excluded.expiresAt`
      )
      .run(id, tenantId, input.principalType, input.principalId, role.id, input.scopeType ?? "tenant", input.scopeId ?? tenantId, JSON.stringify(input.conditions ?? {}), now, now, input.expiresAt ?? null);
    return this.getAssignment(id)!;
  }

  listAssignmentsForPrincipal(principalType: PrincipalType, principalId: string, tenantId = DEFAULT_TENANT_ID): RoleAssignmentRecord[] {
    const rows = this.database.db
      .prepare(`SELECT * FROM role_assignments WHERE tenantId = ? AND principalType = ? AND principalId = ? ORDER BY createdAt ASC`)
      .all(tenantId, principalType, principalId) as AssignmentRow[];
    return rows.map(mapAssignment);
  }

  getActorRoleNames(principalType: PrincipalType, principalId: string, tenantId = DEFAULT_TENANT_ID): string[] {
    return this.listAssignmentsForPrincipal(principalType, principalId, tenantId)
      .map((assignment) => this.getRole(assignment.roleId, tenantId)?.name)
      .filter((role): role is string => Boolean(role));
  }

  private getAssignment(id: string): RoleAssignmentRecord | null {
    const row = this.database.db.prepare(`SELECT * FROM role_assignments WHERE id = ?`).get(id) as AssignmentRow | undefined;
    return row ? mapAssignment(row) : null;
  }
}

function mapUser(row: UserRow): UserRecord {
  return {
    ...row,
    mfaEnabled: Boolean(row.mfaEnabled),
    attributes: parseJson(row.attributesJson, {})
  };
}

function mapRole(row: RoleRow): RoleRecord {
  return {
    ...row,
    permissions: parseJson(row.permissionsJson, [])
  };
}

function mapAssignment(row: AssignmentRow): RoleAssignmentRecord {
  return {
    ...row,
    conditions: parseJson(row.conditionsJson, {})
  };
}

export { defaultRoles };
