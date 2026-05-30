import { describe, it, expect } from "vitest";
import { assessContradiction } from "../src/contradictions.js";

describe("assessContradiction — flags same-subject polarity flips", () => {
  it("detects an antonym flip on the same subject (always vs never)", () => {
    const verdict = assessContradiction(
      { title: "Deploy policy", body: "We always deploy on Fridays." },
      { title: "Deploy policy", body: "We never deploy on Fridays." }
    );
    expect(verdict.isContradiction).toBe(true);
    expect(verdict.score).toBeGreaterThanOrEqual(0.45);
    expect(verdict.evidence.sharedTerms).toContain("deploy");
    expect(verdict.evidence.polaritySignals.length).toBeGreaterThan(0);
  });

  it("detects a negation flip on the same subject (use vs do not use PostgreSQL)", () => {
    const verdict = assessContradiction(
      { title: "Database choice", body: "Use PostgreSQL for the primary database." },
      { title: "Database choice", body: "Do not use PostgreSQL; use MySQL instead." }
    );
    expect(verdict.isContradiction).toBe(true);
    expect(verdict.evidence.sharedTerms).toContain("postgresql");
  });

  it("detects an enable/disable antonym flip on the same feature", () => {
    const verdict = assessContradiction(
      { title: "Beta flag", body: "Enable the beta dashboard for all users." },
      { title: "Beta flag", body: "Disable the beta dashboard." }
    );
    expect(verdict.isContradiction).toBe(true);
  });
});

describe("assessContradiction — guards against false positives", () => {
  it("does NOT flag a paraphrase with no polarity flip", () => {
    const verdict = assessContradiction(
      { title: "Deploy policy", body: "We deploy on Fridays." },
      { title: "Deploy policy", body: "Deployments happen on Fridays." }
    );
    expect(verdict.isContradiction).toBe(false);
  });

  it("does NOT flag opposite polarity on different subjects", () => {
    const verdict = assessContradiction(
      { title: "Beta flag", body: "Enable the beta dashboard." },
      { title: "Export flag", body: "Disable the analytics export." }
    );
    expect(verdict.isContradiction).toBe(false);
  });

  it("does NOT flag unrelated statements", () => {
    const verdict = assessContradiction(
      { title: "Database", body: "Use PostgreSQL for storage." },
      { title: "Testing", body: "Write unit tests for the API layer." }
    );
    expect(verdict.isContradiction).toBe(false);
  });

  it("does NOT flag two statements that both negate the same thing (they agree)", () => {
    const verdict = assessContradiction(
      { title: "Deploy policy", body: "Never deploy on Fridays." },
      { title: "Deploy policy", body: "Do not deploy on Fridays." }
    );
    expect(verdict.isContradiction).toBe(false);
  });
});
