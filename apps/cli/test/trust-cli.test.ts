import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function runRootNpm(args: string[], home: string): string {
  return execFileSync(npmCommand, args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOME: home,
      INIT_CWD: projectRoot
    },
    encoding: "utf8"
  });
}

describe("CLI trust command", () => {
  it("whoami prints the SquidBot identity even with no active profile", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-trust-cli-"));
    const output = runRootNpm(["run", "--silent", "whoami"], home);
    expect(output).toContain("SquidBot");
    expect(output).toContain("Mission:");
  });

  it("profile list seeds and shows the law firm profile", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-trust-cli-"));
    const output = runRootNpm(["run", "--silent", "profile", "--", "list"], home);
    expect(output).toContain("profile_seed_law_firm");
    expect(output).toContain("Law Firm");
  });

  it("trust summary works end-to-end", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-trust-cli-"));
    const output = runRootNpm(["run", "--silent", "trust", "--", "summary"], home);
    expect(output).toContain("SquidBot");
    expect(output).toMatch(/health (excellent|strong|fair|needs_attention)/);
  });

  it("--framework=gdpr (equals form) generates a GDPR packet, not SOC2", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-trust-cli-"));
    const outPath = path.join(home, "gdpr.md");
    runRootNpm(
      ["run", "--silent", "trust", "--", "packet", "--framework=gdpr", "--out", outPath],
      home
    );
    const content = fs.readFileSync(outPath, "utf8");
    expect(content).toContain("GDPR Article-Level Evidence");
    expect(content).not.toContain("SOC 2 Type II");
  });

  it("--framework gdpr (space form) also generates a GDPR packet", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-trust-cli-"));
    const outPath = path.join(home, "gdpr2.md");
    runRootNpm(
      ["run", "--silent", "trust", "--", "packet", "--framework", "gdpr", "--out", outPath],
      home
    );
    const content = fs.readFileSync(outPath, "utf8");
    expect(content).toContain("GDPR Article-Level Evidence");
  });

  it("default framework is SOC2 when no flag is passed", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-trust-cli-"));
    const outPath = path.join(home, "default.md");
    runRootNpm(
      ["run", "--silent", "trust", "--", "packet", "--out", outPath],
      home
    );
    const content = fs.readFileSync(outPath, "utf8");
    expect(content).toContain("SOC 2 Type II");
  });

  it("rejects invalid framework names", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-trust-cli-"));
    expect(() =>
      runRootNpm(
        ["run", "--silent", "trust", "--", "packet", "--framework=bogus"],
        home
      )
    ).toThrow();
  });
});
