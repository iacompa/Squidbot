/**
 * Parse CI/test runner logs into structured failure records.
 *
 * Supports vitest/jest, pytest, and GitHub Actions log formats, plus a
 * generic fallback that looks for "Error" / "FAIL" / "❌" cues.
 *
 * Pure function — never throws, never does I/O. Output is safe to log,
 * emit as a trace event, or persist as a connector response.
 */

export type CiLogKind = "vitest" | "jest" | "pytest" | "github-actions" | "generic";

export type CiLogFailure = {
  test: string;
  file: string | null;
  line: number | null;
  message: string;
};

export type CiLogTotals = {
  passed: number;
  failed: number;
  skipped: number;
};

export type ParsedCiLog = {
  kind: CiLogKind;
  status: "pass" | "fail" | "unknown";
  failures: CiLogFailure[];
  totals: CiLogTotals | null;
  rawLines: number;
};

const FAILURE_MESSAGE_MAX_LEN = 400;

export function parseCiLog(text: string, hint?: CiLogKind): ParsedCiLog {
  const rawLines = text.split(/\r?\n/);
  const kind = hint ?? detectKind(text);
  switch (kind) {
    case "vitest":
    case "jest":
      return parseVitestStyle(rawLines, kind);
    case "pytest":
      return parsePytest(rawLines);
    case "github-actions":
      return parseGithubActions(rawLines);
    case "generic":
    default:
      return parseGeneric(rawLines);
  }
}

function detectKind(text: string): CiLogKind {
  if (/##\[(error|warning|notice|group|endgroup)\]/.test(text)) {
    return "github-actions";
  }
  if (/FAILED\s+\S+::\w+|=+ FAILURES =+|=+ test session starts =+/.test(text)) {
    return "pytest";
  }
  if (/RUN\s+v\d/.test(text) || /Test Files\s+\d+ (?:passed|failed)/i.test(text)) {
    return "vitest";
  }
  if (/Test Suites:\s+\d+/.test(text) && /Tests:\s+\d+/.test(text)) {
    return "jest";
  }
  return "generic";
}

function clampMessage(message: string): string {
  const trimmed = message.trim();
  return trimmed.length > FAILURE_MESSAGE_MAX_LEN
    ? `${trimmed.slice(0, FAILURE_MESSAGE_MAX_LEN - 1)}…`
    : trimmed;
}

/**
 * Vitest and Jest both emit `FAIL <file>` lines followed by failing test
 * names and an error message. The shapes overlap enough that one parser
 * works for both; we keep the `kind` distinct so downstream consumers
 * can tell them apart for routing or telemetry.
 */
function parseVitestStyle(lines: string[], kind: "vitest" | "jest"): ParsedCiLog {
  const failures: CiLogFailure[] = [];
  let currentFile: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const failFileMatch = line.match(/^\s*FAIL\s+(.+\.(?:test|spec)\.[jt]sx?)/);
    if (failFileMatch) {
      currentFile = failFileMatch[1];
      continue;
    }
    const failTestMatch = line.match(/^\s*[×✗❯]\s+(.+?)(?:\s+\d+ms)?$/);
    if (failTestMatch && currentFile) {
      const test = failTestMatch[1].trim();
      const message = findNextErrorMessage(lines, i);
      failures.push({
        test,
        file: currentFile,
        line: findLineNumberAfter(lines, i, currentFile),
        message: clampMessage(message)
      });
    }
  }
  const totals = parseVitestTotals(lines);
  const status = decideStatus(totals, failures);
  return { kind, status, failures, totals, rawLines: lines.length };
}

function parseVitestTotals(lines: string[]): CiLogTotals | null {
  for (const line of lines) {
    const testsLine = line.match(/^\s*Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed(?:\s*\|\s*(\d+)\s+skipped)?/i);
    if (testsLine) {
      return {
        failed: testsLine[1] ? Number(testsLine[1]) : 0,
        passed: Number(testsLine[2]),
        skipped: testsLine[3] ? Number(testsLine[3]) : 0
      };
    }
  }
  return null;
}

function findNextErrorMessage(lines: string[], start: number): string {
  for (let j = start + 1; j < Math.min(start + 20, lines.length); j++) {
    const trimmed = lines[j].trim();
    if (!trimmed) continue;
    if (/^(AssertionError|Error|TypeError|RangeError|SyntaxError|ReferenceError):/.test(trimmed)) {
      return trimmed;
    }
    if (trimmed.startsWith("Expected:") || trimmed.startsWith("expected ")) {
      return trimmed;
    }
  }
  return "(no extracted message)";
}

function findLineNumberAfter(lines: string[], start: number, file: string): number | null {
  const fileBasename = file.split("/").pop() ?? file;
  for (let j = start; j < Math.min(start + 30, lines.length); j++) {
    const match = lines[j].match(new RegExp(`${escapeRegex(fileBasename)}:(\\d+):\\d+`));
    if (match) return Number(match[1]);
  }
  return null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parsePytest(lines: string[]): ParsedCiLog {
  const failures: CiLogFailure[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^FAILED\s+([^:\s]+)::([^\s-]+)(?:\s+-\s+(.+))?$/);
    if (match) {
      const [, file, test, inlineMessage] = match;
      failures.push({
        test,
        file,
        line: null,
        message: clampMessage(inlineMessage ?? findPytestTraceback(lines, i, file) ?? "(no extracted message)")
      });
    }
  }
  const totals = parsePytestTotals(lines);
  const status = decideStatus(totals, failures);
  return { kind: "pytest", status, failures, totals, rawLines: lines.length };
}

function parsePytestTotals(lines: string[]): CiLogTotals | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!/=+/.test(line)) continue;
    const passed = matchNumeric(line, /(\d+)\s+passed/);
    const failed = matchNumeric(line, /(\d+)\s+failed/);
    const skipped = matchNumeric(line, /(\d+)\s+skipped/);
    if (passed !== null || failed !== null || skipped !== null) {
      return {
        passed: passed ?? 0,
        failed: failed ?? 0,
        skipped: skipped ?? 0
      };
    }
  }
  return null;
}

function matchNumeric(line: string, pattern: RegExp): number | null {
  const match = line.match(pattern);
  return match ? Number(match[1]) : null;
}

function findPytestTraceback(lines: string[], start: number, file: string): string | null {
  for (let j = start + 1; j < Math.min(start + 40, lines.length); j++) {
    const trimmed = lines[j].trim();
    if (trimmed.startsWith("E ")) {
      return trimmed.slice(2).trim();
    }
    if (trimmed.startsWith(`${file}:`)) {
      const nextLine = lines[j + 1]?.trim();
      if (nextLine) return nextLine;
    }
  }
  return null;
}

function parseGithubActions(lines: string[]): ParsedCiLog {
  const failures: CiLogFailure[] = [];
  for (const line of lines) {
    const match = line.match(/^##\[error\](?:file=([^,]+),line=(\d+)(?:,col=\d+)?::)?(.+)$/);
    if (match) {
      const [, file, lineNum, message] = match;
      failures.push({
        test: "(github-actions step)",
        file: file ?? null,
        line: lineNum ? Number(lineNum) : null,
        message: clampMessage(message)
      });
    }
  }
  const status: ParsedCiLog["status"] = failures.length > 0 ? "fail" : "pass";
  return { kind: "github-actions", status, failures, totals: null, rawLines: lines.length };
}

function parseGeneric(lines: string[]): ParsedCiLog {
  const failures: CiLogFailure[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^(?:Error|FAIL|FAILED|❌)\b/i.test(line.trim())) {
      failures.push({
        test: "(generic)",
        file: null,
        line: null,
        message: clampMessage(line)
      });
    }
  }
  const status: ParsedCiLog["status"] = failures.length > 0 ? "fail" : "unknown";
  return { kind: "generic", status, failures, totals: null, rawLines: lines.length };
}

function decideStatus(totals: CiLogTotals | null, failures: CiLogFailure[]): ParsedCiLog["status"] {
  if (totals) {
    return totals.failed > 0 ? "fail" : "pass";
  }
  return failures.length > 0 ? "fail" : "unknown";
}
