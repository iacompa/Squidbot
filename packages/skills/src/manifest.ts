export type SkillStatus = "draft" | "approved" | "archived";

export type SkillPermission = {
  riskLevel: "low" | "medium" | "high" | "critical";
  scopes?: string[];
};

export type SkillTestFixture = {
  id: string;
  name: string;
  task: string;
  testCommand?: string;
  repoPath?: string;
  expectedResult?: Record<string, unknown>;
  expectedDiff?: string;
};

export type SkillManifest = {
  id: string;
  name: string;
  version: string;
  description: string;
  requiredTools: string[];
  prompts: Record<string, string>;
  testFixtures: SkillTestFixture[];
  permissions: Record<string, SkillPermission>;
  createdAt: string;
  updatedAt: string;
  author: string;
  tags?: string[];
  domains?: string[];
};

export const skillManifestJsonSchema = {
  type: "object",
  required: [
    "id",
    "name",
    "version",
    "description",
    "requiredTools",
    "prompts",
    "testFixtures",
    "permissions",
    "createdAt",
    "updatedAt",
    "author"
  ],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    version: { type: "string" },
    description: { type: "string" },
    requiredTools: { type: "array", items: { type: "string" } },
    prompts: { type: "object" },
    testFixtures: { type: "array" },
    permissions: { type: "object" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
    author: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    domains: { type: "array", items: { type: "string" } }
  },
  additionalProperties: false
} as const;

export function validateSkillManifest(value: unknown): SkillManifest {
  const record = requireRecord(value, "Skill manifest must be an object.");
  const manifest: SkillManifest = {
    id: requireNonEmptyString(record.id, "manifest.id"),
    name: requireNonEmptyString(record.name, "manifest.name"),
    version: requireSemver(record.version, "manifest.version"),
    description: requireNonEmptyString(record.description, "manifest.description"),
    requiredTools: requireStringArray(record.requiredTools, "manifest.requiredTools"),
    prompts: requirePromptMap(record.prompts),
    testFixtures: requireFixtures(record.testFixtures),
    permissions: requirePermissions(record.permissions),
    createdAt: requireNonEmptyString(record.createdAt, "manifest.createdAt"),
    updatedAt: requireNonEmptyString(record.updatedAt, "manifest.updatedAt"),
    author: requireNonEmptyString(record.author, "manifest.author"),
    tags: record.tags === undefined ? undefined : requireStringArray(record.tags, "manifest.tags"),
    domains: record.domains === undefined ? undefined : requireStringArray(record.domains, "manifest.domains")
  };

  if (!/^skill_[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(manifest.id)) {
    throw new Error("manifest.id must start with skill_ and contain only letters, numbers, underscores, or dashes.");
  }

  return manifest;
}

export function normalizeSkillId(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return `skill_${normalized || "untitled"}`;
}

export function nextMinorVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    return "0.1.0";
  }
  return `${match[1]}.${Number(match[2]) + 1}.0`;
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

function requireSemver(value: unknown, field: string): string {
  const version = requireNonEmptyString(value, field);
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`${field} must be a semantic version like 0.1.0.`);
  }
  return version;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array.`);
  }
  return [...new Set(value.map((item) => requireNonEmptyString(item, field)))];
}

function requirePromptMap(value: unknown): Record<string, string> {
  const record = requireRecord(value, "manifest.prompts must be an object.");
  const prompts = Object.fromEntries(
    Object.entries(record).map(([key, prompt]) => [key, requireNonEmptyString(prompt, `manifest.prompts.${key}`)])
  );
  if (Object.keys(prompts).length === 0) {
    throw new Error("manifest.prompts must contain at least one prompt.");
  }
  return prompts;
}

function requireFixtures(value: unknown): SkillTestFixture[] {
  if (!Array.isArray(value)) {
    throw new Error("manifest.testFixtures must be an array.");
  }
  return value.map((fixture, index) => {
    const record = requireRecord(fixture, `manifest.testFixtures[${index}] must be an object.`);
    return {
      id: requireNonEmptyString(record.id, `manifest.testFixtures[${index}].id`),
      name: requireNonEmptyString(record.name, `manifest.testFixtures[${index}].name`),
      task: requireNonEmptyString(record.task, `manifest.testFixtures[${index}].task`),
      testCommand: typeof record.testCommand === "string" && record.testCommand.trim() ? record.testCommand.trim() : undefined,
      repoPath: typeof record.repoPath === "string" && record.repoPath.trim() ? record.repoPath.trim() : undefined,
      expectedResult: record.expectedResult && typeof record.expectedResult === "object" && !Array.isArray(record.expectedResult) ? (record.expectedResult as Record<string, unknown>) : undefined,
      expectedDiff: typeof record.expectedDiff === "string" ? record.expectedDiff : undefined
    };
  });
}

function requirePermissions(value: unknown): Record<string, SkillPermission> {
  const record = requireRecord(value, "manifest.permissions must be an object.");
  return Object.fromEntries(
    Object.entries(record).map(([tool, permission]) => {
      const item = requireRecord(permission, `manifest.permissions.${tool} must be an object.`);
      const riskLevel = requireNonEmptyString(item.riskLevel, `manifest.permissions.${tool}.riskLevel`);
      if (riskLevel !== "low" && riskLevel !== "medium" && riskLevel !== "high" && riskLevel !== "critical") {
        throw new Error(`manifest.permissions.${tool}.riskLevel is invalid.`);
      }
      return [
        tool,
        {
          riskLevel,
          scopes: item.scopes === undefined ? undefined : requireStringArray(item.scopes, `manifest.permissions.${tool}.scopes`)
        }
      ];
    })
  );
}
