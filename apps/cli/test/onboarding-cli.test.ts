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

function writeAnswers(home: string, answers: Array<{ questionId: string; rawValue: string; skipped?: boolean }>): string {
  const filePath = path.join(home, "onboarding-answers.json");
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        answers: answers.map((entry) => ({
          questionId: entry.questionId,
          rawValue: entry.rawValue,
          skipped: Boolean(entry.skipped)
        }))
      },
      null,
      2
    )
  );
  return filePath;
}

describe("CLI onboarding command", () => {
  it("--dry-run shows the inferred profile without committing", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-onboarding-cli-"));
    const answersPath = writeAnswers(home, [
      { questionId: "business_summary", rawValue: "We run a small law firm." },
      { questionId: "role", rawValue: "Managing partner" },
      { questionId: "founder_note", rawValue: "Reviewing contracts manually." },
      { questionId: "systems", rawValue: "Clio, Outlook, Slack" },
      { questionId: "sensitivity", rawValue: "regulated" },
      { questionId: "guardrail", rawValue: "Never share matter info externally." }
    ]);

    const output = runRootNpm(
      ["run", "--silent", "onboarding", "--", "--answers", answersPath, "--dry-run"],
      home
    );

    expect(output).toContain("Here's what I learned");
    expect(output).toContain("legal");
    expect(output).toContain("regulated");
    expect(output).toContain("(dry-run)");

    // Confirm whoami still shows the *default* Generic Business — nothing committed.
    const whoami = runRootNpm(["run", "--silent", "whoami"], home);
    expect(whoami).toContain("Generic Business");
  });

  it("non-interactive run creates + activates a custom profile and writes memories", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-onboarding-cli-"));
    const answersPath = writeAnswers(home, [
      { questionId: "business_summary", rawValue: "Family-owned auto dealership servicing Hondas." },
      { questionId: "role", rawValue: "General Manager" },
      { questionId: "founder_note", rawValue: "Chasing service appointment confirmations eats my morning." },
      { questionId: "systems", rawValue: "DealerSocket, Outlook, Slack" },
      { questionId: "sensitivity", rawValue: "sensitive" },
      { questionId: "guardrail", rawValue: "Never quote pricing without GM approval." }
    ]);

    const output = runRootNpm(
      ["run", "--silent", "onboarding", "--", "--answers", answersPath, "--yes"],
      home
    );

    expect(output).toContain("Created profile");
    expect(output).toContain("Status: ACTIVE");
    expect(output).toMatch(/Memory entries written: [3-9]/);
    expect(output).toContain("run_onboarding_");
    // "Try this next" hints
    expect(output).toContain("npm run whoami");

    // whoami now reflects the dealership profile, not the default.
    // Display name falls back to the industry name ("Auto Dealership") because
    // "Family-owned" is a generic descriptor, not a brand — that's the correct
    // behaviour from inferOnboardingProfile.
    const whoami = runRootNpm(["run", "--silent", "whoami"], home);
    expect(whoami).toContain("Auto Dealership");
    expect(whoami).toContain("(automotive_retail)");
    expect(whoami).not.toContain("Active profile: Generic Business");
  });

  it("--no-activate persists profile + memories but leaves Generic Business active", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-onboarding-cli-"));
    const answersPath = writeAnswers(home, [
      { questionId: "business_summary", rawValue: "Boutique consulting firm." },
      { questionId: "role", rawValue: "Founder" },
      { questionId: "founder_note", rawValue: "", skipped: true },
      { questionId: "systems", rawValue: "", skipped: true },
      { questionId: "sensitivity", rawValue: "standard" },
      { questionId: "guardrail", rawValue: "", skipped: true }
    ]);

    const output = runRootNpm(
      [
        "run",
        "--silent",
        "onboarding",
        "--",
        "--answers",
        answersPath,
        "--yes",
        "--no-activate"
      ],
      home
    );

    expect(output).toContain("Created profile");
    expect(output).toContain("Status: saved (not active)");

    const whoami = runRootNpm(["run", "--silent", "whoami"], home);
    expect(whoami).toContain("Active profile: Generic Business");
  });

  it("--json emits machine-readable inference and committed result", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-onboarding-cli-"));
    const answersPath = writeAnswers(home, [
      { questionId: "business_summary", rawValue: "We're an engineering team building a developer tools platform." },
      { questionId: "role", rawValue: "Founder" },
      { questionId: "founder_note", rawValue: "Triaging CI failures." },
      { questionId: "systems", rawValue: "GitHub, Slack, Linear" },
      { questionId: "sensitivity", rawValue: "standard" },
      { questionId: "guardrail", rawValue: "", skipped: true }
    ]);

    const output = runRootNpm(
      ["run", "--silent", "onboarding", "--", "--answers", answersPath, "--yes", "--json"],
      home
    );

    const parsed = JSON.parse(output) as {
      inference: { profile: { industry: string; sensitivity: string } };
      committed: {
        profile: { isActive: boolean; displayName: string };
        memories: Array<{ type: string; sourceRunId: string }>;
        syntheticRunId: string;
      };
    };

    expect(parsed.inference.profile.industry).toBe("software_engineering");
    expect(parsed.committed.profile.isActive).toBe(true);
    expect(parsed.committed.syntheticRunId.startsWith("run_onboarding_")).toBe(true);
    expect(parsed.committed.memories.length).toBeGreaterThan(0);
    expect(parsed.committed.memories.every((memory) => memory.sourceRunId === parsed.committed.syntheticRunId)).toBe(
      true
    );
  });

  it("rejects --answers pointing at a missing file", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-onboarding-cli-"));
    expect(() =>
      runRootNpm(
        ["run", "--silent", "onboarding", "--", "--answers", "/tmp/does-not-exist-12345.json"],
        home
      )
    ).toThrow();
  });

  it("works with the shipped examples/onboarding-acme.json fixture", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-onboarding-cli-"));
    const output = runRootNpm(
      ["run", "--silent", "onboarding", "--", "--answers", "./examples/onboarding-acme.json", "--yes"],
      home
    );
    expect(output).toContain("Created profile");
    expect(output).toContain("Status: ACTIVE");
    // The Acme fixture is "SaaS that helps online retailers" → ecommerce wins over saas keyword.
    const whoami = runRootNpm(["run", "--silent", "whoami"], home);
    expect(whoami).toContain("Acme");
  });
});
