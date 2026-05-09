import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "@squidbot/core";
import type { EvalDatasetManifest, EvalTaskManifest } from "./types.js";

const domains = new Set(["coding", "developerWorkflow", "support", "sales", "operations", "research", "custom"]);

export function loadDatasetManifest(targetPath: string): EvalDatasetManifest {
  const manifestPath = fs.statSync(targetPath).isDirectory() ? path.join(targetPath, "dataset.json") : targetPath;
  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
  return validateDatasetManifest(parsed, path.dirname(manifestPath));
}

export function validateDatasetManifest(input: unknown, datasetRoot = process.cwd()): EvalDatasetManifest {
  const manifest = expectObject(input, "dataset manifest") as Partial<EvalDatasetManifest>;
  requireString(manifest.id, "id");
  requireString(manifest.name, "name");
  requireString(manifest.domain, "domain");
  if (!domains.has(String(manifest.domain))) {
    throw new Error(`Unsupported dataset domain: ${String(manifest.domain)}`);
  }
  requireString(manifest.version, "version");
  requireString(manifest.description, "description");
  if (manifest.zeroSpend !== true) {
    throw new Error("Dataset zeroSpend must be true.");
  }
  if (!Array.isArray(manifest.tasks) || manifest.tasks.length === 0) {
    throw new Error("Dataset must include at least one task.");
  }
  const scoring = expectObject(manifest.scoring, "scoring") as EvalDatasetManifest["scoring"];
  requireString(scoring.primaryMetric, "scoring.primaryMetric");
  if (!Array.isArray(scoring.metrics) || scoring.metrics.length === 0) {
    throw new Error("Dataset scoring.metrics must include at least one metric.");
  }
  const weights = normalizeWeights(scoring.weights ?? {});
  if (!Object.keys(weights).length) {
    throw new Error("Dataset scoring.weights must include at least one metric weight.");
  }
  const constraints = expectObject(manifest.constraints, "constraints") as EvalDatasetManifest["constraints"];
  if (constraints.requiredProvider !== "mock" && constraints.requiredProvider !== "local") {
    throw new Error("Dataset constraints.requiredProvider must be mock or local.");
  }
  if (constraints.allowByok !== false) {
    throw new Error("Built-in/local datasets must set allowByok to false.");
  }
  if (constraints.networkPolicy !== "deny" && constraints.networkPolicy !== "fixtureOnly") {
    throw new Error("Dataset networkPolicy must be deny or fixtureOnly.");
  }
  if (Number(constraints.maxCostEstimate ?? 0) > 0) {
    throw new Error("Zero-spend datasets must have maxCostEstimate of 0.");
  }
  const provenance = expectObject(manifest.provenance, "provenance") as EvalDatasetManifest["provenance"];
  requireString(provenance.author, "provenance.author");
  requireString(provenance.createdAt, "provenance.createdAt");
  assertNoSecrets(manifest);
  for (const task of manifest.tasks) {
    validateEvalTaskManifest(task, datasetRoot);
  }
  return {
    ...(manifest as EvalDatasetManifest),
    scoring: {
      ...scoring,
      weights
    }
  };
}

export function validateEvalTaskManifest(input: unknown, datasetRoot = process.cwd()): EvalTaskManifest {
  const task = expectObject(input, "eval task") as EvalTaskManifest;
  requireString(task.id, "task.id");
  requireString(task.name, "task.name");
  requireString(task.description, "task.description");
  requireString(task.task, "task.task");
  expectObject(task.fixture, "task.fixture");
  expectObject(task.target, "task.target");
  expectObject(task.expected, "task.expected");
  if (task.fixture.workspacePath) {
    assertLocalPathExists(datasetRoot, task.fixture.workspacePath, `task ${task.id} fixture.workspacePath`);
  }
  if (task.expected.expectedDiffPath) {
    assertLocalPathExists(datasetRoot, task.expected.expectedDiffPath, `task ${task.id} expectedDiffPath`);
  }
  for (const fixture of task.fixture.connectorFixtures ?? []) {
    assertLocalPathExists(datasetRoot, fixture, `task ${task.id} connector fixture`);
  }
  if (task.target.type !== "skill" && task.target.type !== "team" && task.target.type !== "workflow") {
    throw new Error(`Unsupported eval task target type: ${String(task.target.type)}`);
  }
  assertNoSecrets(task);
  return task;
}

export function normalizeWeights(weights: Record<string, number>): Record<string, number> {
  const entries = Object.entries(weights).filter(([, value]) => Number.isFinite(value) && value > 0);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) {
    return {};
  }
  return Object.fromEntries(entries.map(([key, value]) => [key, Number((value / total).toFixed(6))]));
}

function assertLocalPathExists(root: string, relativePath: string, label: string): void {
  if (/^https?:\/\//i.test(relativePath)) {
    throw new Error(`${label} must be local, not a URL.`);
  }
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(path.resolve(root))) {
    throw new Error(`${label} must stay inside the dataset folder.`);
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`${label} does not exist: ${relativePath}`);
  }
}

function assertNoSecrets(value: unknown): void {
  const text = JSON.stringify(value);
  if (redactSecrets(text) !== text) {
    throw new Error("Dataset manifests and tasks must not contain raw secrets.");
  }
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
}
