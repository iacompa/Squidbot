/**
 * Plugin SDK types. A plugin packages community-contributed capabilities —
 * tools, connectors, and skills — behind a typed, validated, permission-
 * declaring manifest. The host validates and registers plugins; nothing is
 * granted that the manifest does not declare (governance still gates execution).
 */

export type PluginRiskLevel = "low" | "medium" | "high" | "critical";

/** Capabilities a plugin contributes, referenced by id/name (resolved by the host). */
export type PluginContributions = {
  /** Tool ids the plugin registers (e.g. "connector.acme.listOrders"). */
  tools?: string[];
  /** Connector names the plugin ships. */
  connectors?: string[];
  /** Skill ids the plugin bundles. */
  skills?: string[];
};

export type PluginManifest = {
  /** Stable plugin id: lowercase, alphanumerics + `-`/`_`/`.`. */
  id: string;
  name: string;
  /** semver, e.g. 1.0.0 */
  version: string;
  description: string;
  author: string;
  contributes: PluginContributions;
  /** Permission scopes the plugin requires (advisory; the host's policy engine enforces). */
  permissions?: string[];
  /** Highest risk the plugin's contributions carry. Defaults to "low". */
  riskLevel?: PluginRiskLevel;
};

/**
 * A tool a plugin contributes at load time. Structurally mirrors the host's
 * registered-tool shape, but declared locally so the SDK stays decoupled from
 * `@squidbot/core` (no import cycle). The host adapts these into its real
 * ToolRegistry; governance still gates execution at call time.
 */
export type PluginToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  permissionScopes?: string[];
  riskLevel?: PluginRiskLevel;
  handler: (args: Record<string, unknown>, context?: unknown) => unknown | Promise<unknown>;
};

/** The capability surface the host hands a plugin's `register` hook. */
export type PluginHost = {
  registerTool(tool: PluginToolDefinition): void;
};

/** Context passed to a plugin's `register` hook — the manifest plus a guarded host. */
export type PluginRegisterContext = {
  manifest: PluginManifest;
  registerTool(tool: PluginToolDefinition): void;
};

/**
 * A code plugin: a manifest plus a `register` hook the host calls with a typed
 * context. The host enforces that `register` only contributes capabilities the
 * manifest declared (see `loadPlugin`).
 */
export type SquidbotPlugin = {
  manifest: PluginManifest;
  register?: (context: PluginRegisterContext) => void | Promise<void>;
};

/** Type-safe helper for authoring a plugin. */
export function definePlugin(plugin: SquidbotPlugin): SquidbotPlugin {
  return plugin;
}
