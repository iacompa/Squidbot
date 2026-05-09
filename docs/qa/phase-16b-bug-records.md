# Phase 16-B QA Bug Records

## Bug: QA harness parsed truncated JSON output

- Area: QA harness / CLI JSON verification
- Command / UI action: `npm run verify:cli-json`
- Expected: The harness should parse the raw stdout from JSON-mode CLI commands while writing only redacted/truncated output into reports.
- Actual: The harness parsed its own truncated stdout copy, causing `traces list` to fail with `Bad control character in string literal` when the trace list was large.
- Root cause: `runJson()` called `JSON.parse(step.stdout)`, but `step.stdout` was already truncated for report storage.
- Fix: Store raw stdout/stderr as non-enumerable properties on the step object and parse `rawStdout`; report output remains redacted and truncated.
- Files changed: `scripts/qa-harness.mjs`
- Test added: `npm run verify:cli-json` now exercises the behavior.
- Retest result: Passed.

## Finding: Concurrent DB-heavy QA commands can still contend if launched externally

- Area: Operator usage / SQLite concurrency
- Command / UI action: Running multiple separate QA commands in parallel from the shell.
- Expected: The full release gate runs serially. Independent QA commands should preferably tolerate short overlap.
- Actual: A previous parallel manual run could contend for SQLite locks; the shared DB already has a busy timeout, and the serial QA gate passes.
- Root cause: External parallel execution can still overlap write-heavy app-data operations.
- Fix: `verify:all` runs gates serially. Keep DB-heavy manual QA commands serial unless explicitly running `verify:race`.
- Files changed: none in this Phase 16-B pass.
- Test added: `npm run verify:race` runs concurrent governance status checks.
- Retest result: Passed.
