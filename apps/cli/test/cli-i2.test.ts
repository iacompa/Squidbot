import { describe, expect, it } from "vitest";
import { buildHelpText, getCliVersion, CLI_COMMAND_CATEGORIES } from "../src/cliHelpers.js";

describe("CLI discoverability + scriptability (I2)", () => {
  it("getCliVersion returns semver-shaped version string", () => {
    const v = getCliVersion();
    expect(v).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("buildHelpText includes all major command categories", () => {
    const help = buildHelpText();
    expect(help).toContain("CORE");
    expect(help).toContain("MEMORY");
    expect(help).toContain("GOVERNANCE");
    expect(help).toContain("INTEGRATIONS");
    expect(help).toContain("OBSERVABILITY");
  });

  it("CLI_COMMAND_CATEGORIES covers the key commands without duplicates", () => {
    const allCommands = CLI_COMMAND_CATEGORIES.flatMap((cat) => cat.commands.map((cmd) => cmd.name));
    // No duplicates
    expect(new Set(allCommands).size).toBe(allCommands.length);
    // Core commands present
    expect(allCommands).toContain("chat");
    expect(allCommands).toContain("run");
    expect(allCommands).toContain("memory");
    expect(allCommands).toContain("trust");
    expect(allCommands).toContain("metrics");
    expect(allCommands).toContain("doctor");
    expect(allCommands).toContain("version");
  });

  it("buildHelpText --json outputs valid parseable JSON with commands array", () => {
    const json = buildHelpText("json");
    const parsed = JSON.parse(json) as { version: string; categories: unknown[] };
    expect(parsed.version).toMatch(/^\d+\.\d+/);
    expect(Array.isArray(parsed.categories)).toBe(true);
    expect(parsed.categories.length).toBeGreaterThan(3);
  });
});
