import { describe, expect, it } from "vitest";
import { parseCiLog } from "../src/ciLogParser.js";

describe("parseCiLog — vitest format", () => {
  it("extracts failing test + file + line + assertion message", () => {
    const log = [
      " RUN  v3.2.4 /repo",
      "",
      " FAIL  src/foo.test.ts",
      " × describe block > my test 12ms",
      "   src/foo.test.ts:42:5",
      "   AssertionError: expected 'a' to be 'b'",
      "",
      " Test Files  1 failed | 0 passed (1)",
      "      Tests  1 failed | 0 passed (1)"
    ].join("\n");
    const result = parseCiLog(log);
    expect(result.kind).toBe("vitest");
    expect(result.status).toBe("fail");
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      test: "describe block > my test",
      file: "src/foo.test.ts",
      line: 42,
      message: "AssertionError: expected 'a' to be 'b'"
    });
    expect(result.totals).toEqual({ passed: 0, failed: 1, skipped: 0 });
  });

  it("reports pass when totals show 0 failed", () => {
    const log = [
      " RUN  v3.2.4",
      " ✓ test/a.test.ts (3 tests) 12ms",
      " Test Files  1 passed (1)",
      "      Tests  3 passed (3)"
    ].join("\n");
    const result = parseCiLog(log);
    expect(result.kind).toBe("vitest");
    expect(result.status).toBe("pass");
    expect(result.totals).toEqual({ passed: 3, failed: 0, skipped: 0 });
  });
});

describe("parseCiLog — pytest format", () => {
  it("extracts test::function and totals from a typical pytest run", () => {
    const log = [
      "============================= test session starts =============================",
      "collected 3 items",
      "",
      "tests/test_calc.py ..F                                                    [100%]",
      "",
      "================================== FAILURES ===================================",
      "_______________________________ test_add_negative _______________________________",
      "",
      "    def test_add_negative():",
      ">       assert add(-1, 2) == 1",
      "E       assert 0 == 1",
      "",
      "tests/test_calc.py:14: AssertionError",
      "=========================== short test summary info ============================",
      "FAILED tests/test_calc.py::test_add_negative - assert 0 == 1",
      "===================== 1 failed, 2 passed in 0.04s ====================="
    ].join("\n");
    const result = parseCiLog(log);
    expect(result.kind).toBe("pytest");
    expect(result.status).toBe("fail");
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      test: "test_add_negative",
      file: "tests/test_calc.py",
      message: "assert 0 == 1"
    });
    expect(result.totals).toEqual({ passed: 2, failed: 1, skipped: 0 });
  });

  it("handles pytest pass-only output", () => {
    const log = [
      "============================= test session starts =============================",
      "collected 2 items",
      "tests/test_ok.py ..                                                       [100%]",
      "============================== 2 passed in 0.01s =============================="
    ].join("\n");
    const result = parseCiLog(log);
    expect(result.kind).toBe("pytest");
    expect(result.status).toBe("pass");
    expect(result.failures).toEqual([]);
    expect(result.totals).toEqual({ passed: 2, failed: 0, skipped: 0 });
  });
});

describe("parseCiLog — github-actions format", () => {
  it("extracts ##[error] directives with file/line annotations", () => {
    const log = [
      "##[group]Run npm test",
      "Running tests...",
      "##[error]file=src/foo.ts,line=10,col=5::TS2304: Cannot find name 'bar'.",
      "##[error]Build failed with exit code 1",
      "##[endgroup]"
    ].join("\n");
    const result = parseCiLog(log);
    expect(result.kind).toBe("github-actions");
    expect(result.status).toBe("fail");
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]).toMatchObject({
      file: "src/foo.ts",
      line: 10,
      message: "TS2304: Cannot find name 'bar'."
    });
    expect(result.failures[1]).toMatchObject({
      file: null,
      line: null,
      message: "Build failed with exit code 1"
    });
  });

  it("reports pass when no ##[error] is present", () => {
    const log = ["##[group]Run npm test", "All tests passed", "##[endgroup]"].join("\n");
    const result = parseCiLog(log);
    expect(result.kind).toBe("github-actions");
    expect(result.status).toBe("pass");
    expect(result.failures).toEqual([]);
  });
});

describe("parseCiLog — generic fallback", () => {
  it("picks up loose Error/FAIL lines when no recognizable format", () => {
    const log = [
      "Building project...",
      "Error: ENOENT: no such file or directory",
      "Build complete with 1 error"
    ].join("\n");
    const result = parseCiLog(log);
    expect(result.kind).toBe("generic");
    expect(result.status).toBe("fail");
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].message).toContain("ENOENT");
  });

  it("returns unknown status for ambiguous input with no fail cues", () => {
    const result = parseCiLog("just some neutral log lines\nnothing notable here");
    expect(result.kind).toBe("generic");
    expect(result.status).toBe("unknown");
    expect(result.failures).toEqual([]);
  });

  it("returns unknown for an empty log", () => {
    const result = parseCiLog("");
    expect(result.status).toBe("unknown");
    expect(result.failures).toEqual([]);
  });
});

describe("parseCiLog — hint override", () => {
  it("respects an explicit kind hint even if heuristics would pick another", () => {
    // GitHub-Actions-style line embedded in what's otherwise generic text;
    // pinning the hint to "generic" prevents the GH detector from kicking in.
    const log = "Some output\n##[error]oops\nmore output";
    const auto = parseCiLog(log);
    expect(auto.kind).toBe("github-actions");
    const hinted = parseCiLog(log, "generic");
    expect(hinted.kind).toBe("generic");
  });
});

describe("parseCiLog — long message clamping", () => {
  it("clamps very long failure messages with an ellipsis", () => {
    const longMessage = "Error: " + "x".repeat(800);
    const log = [longMessage].join("\n");
    const result = parseCiLog(log);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].message.endsWith("…")).toBe(true);
    expect(result.failures[0].message.length).toBeLessThan(longMessage.length);
  });
});
