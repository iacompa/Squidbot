import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type SandboxNetworkPolicy = "allow" | "deny" | "custom";

export type SandboxResourceLimits = {
  cpu: number;
  memoryMb: number;
  diskMb: number;
};

export type Sandbox = {
  id: string;
  path: string;
  originalWorkspacePath: string;
  createdAt: string;
  backend: "local";
  resourceLimits: SandboxResourceLimits;
  networkPolicy: SandboxNetworkPolicy;
};

export type SandboxRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  sandboxId: string;
  command: string;
  args: string[];
  resourceLimitExceeded?: boolean;
  blockedByPolicy?: boolean;
};

export type SandboxCreateOptions = {
  resourceLimits?: Partial<SandboxResourceLimits>;
  networkPolicy?: SandboxNetworkPolicy;
};

export type SandboxRunOptions = {
  timeoutMs?: number;
};

const ignoredNames = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  "out",
  ".pytest_cache",
  "__pycache__",
  ".mypy_cache",
  ".ruff_cache",
  ".squidbot-home"
]);
const networkExecutables = new Set(["curl", "wget", "nc", "netcat", "ssh", "scp", "sftp", "ping", "dig", "nslookup"]);
const shellExecutables = new Set(["sh", "bash", "zsh", "fish", "pwsh", "powershell"]);
const defaultResourceLimits: SandboxResourceLimits = {
  cpu: 1,
  memoryMb: 512,
  diskMb: 512
};

export class SandboxPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxPolicyError";
  }
}

export class SandboxManager {
  private readonly baseDir: string;

  constructor(options: { baseDir?: string } = {}) {
    this.baseDir = options.baseDir ?? os.tmpdir();
  }

  async create(workspacePath: string, options: SandboxCreateOptions = {}): Promise<Sandbox> {
    const workspaceRoot = fs.realpathSync(workspacePath);
    const id = createSandboxId();
    const sandboxPath = path.join(this.baseDir, id, "workspace");
    const startedAt = Date.now();

    fs.mkdirSync(sandboxPath, { recursive: true });
    fs.cpSync(workspaceRoot, sandboxPath, {
      recursive: true,
      filter: (source) => {
        const name = path.basename(source);
        return !ignoredNames.has(name);
      }
    });

    const sandbox: Sandbox = {
      id,
      path: sandboxPath,
      originalWorkspacePath: workspaceRoot,
      createdAt: new Date(startedAt).toISOString(),
      backend: "local",
      resourceLimits: {
        ...defaultResourceLimits,
        ...options.resourceLimits
      },
      networkPolicy: options.networkPolicy ?? "deny"
    };

    await assertDiskLimit(sandbox);
    return sandbox;
  }

  async runCommand(sandbox: Sandbox, command: string, args: string[], options: SandboxRunOptions = {}): Promise<SandboxRunResult> {
    const startedAt = Date.now();
    const policyError = validateCommandPolicy(sandbox, command, args);
    if (policyError) {
      return {
        stdout: "",
        stderr: policyError.message,
        exitCode: 126,
        durationMs: Date.now() - startedAt,
        timedOut: false,
        sandboxId: sandbox.id,
        command,
        args,
        blockedByPolicy: true
      };
    }

    const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 15_000, 100), 120_000);
    await fs.promises.mkdir(path.join(sandbox.path, ".squidbot-home"), { recursive: true });

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let resolved = false;

      const child = spawn(command, args, {
        cwd: sandbox.path,
        shell: false,
        env: {
          ...process.env,
          HOME: path.join(sandbox.path, ".squidbot-home"),
          CI: "1",
          SQUIDBOT_SANDBOX: sandbox.id,
          SQUIDBOT_NETWORK_POLICY: sandbox.networkPolicy
        },
        windowsHide: true
      });

      const finish = (exitCode: number, extraStderr = ""): void => {
        if (resolved) {
          return;
        }
        resolved = true;
        clearTimeout(timer);
        void assertDiskLimit(sandbox)
          .then(() => {
            resolve({
              stdout: stdout.slice(0, 40_000),
              stderr: `${stderr}${extraStderr}`.slice(0, 40_000),
              exitCode,
              durationMs: Date.now() - startedAt,
              timedOut,
              sandboxId: sandbox.id,
              command,
              args
            });
          })
          .catch((error: unknown) => {
            resolve({
              stdout: stdout.slice(0, 40_000),
              stderr: `${stderr}${extraStderr}${error instanceof Error ? error.message : String(error)}`.slice(0, 40_000),
              exitCode: exitCode === 0 ? 125 : exitCode,
              durationMs: Date.now() - startedAt,
              timedOut,
              sandboxId: sandbox.id,
              command,
              args,
              resourceLimitExceeded: true
            });
          });
      };

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (error) => {
        finish(127, error.message);
      });

      child.on("close", (exitCode) => {
        finish(timedOut ? 124 : exitCode ?? 0);
      });
    });
  }

  async applyPatch(sandbox: Sandbox, patch: string): Promise<void> {
    if (!patch.trim()) {
      throw new Error("Patch is required.");
    }

    validatePatchPaths(sandbox, patch);
    const patchPath = path.join(sandbox.path, ".squidbot-patch.diff");
    await fs.promises.writeFile(patchPath, patch, "utf8");

    const gitResult = await this.runCommand(sandbox, "git", ["apply", "--whitespace=nowarn", patchPath], { timeoutMs: 10_000 });
    await fs.promises.rm(patchPath, { force: true });

    if (gitResult.exitCode !== 0) {
      try {
        await applyMinimalUnifiedPatch(sandbox, patch);
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(`Patch did not apply in sandbox ${sandbox.id}: ${gitResult.stderr || gitResult.stdout}${fallbackMessage ? `\n${fallbackMessage}` : ""}`);
      }
    }
  }

  async diff(sandbox: Sandbox): Promise<string> {
    const originalRoot = fs.realpathSync(sandbox.originalWorkspacePath);
    const sandboxRoot = fs.realpathSync(sandbox.path);
    const files = collectRelativeFiles(originalRoot, sandboxRoot);
    const hunks: string[] = [];

    for (const relativePath of files) {
      const originalPath = path.join(originalRoot, relativePath);
      const sandboxPath = path.join(sandboxRoot, relativePath);
      const originalExists = fs.existsSync(originalPath);
      const sandboxExists = fs.existsSync(sandboxPath);
      if (originalExists && sandboxExists && sameFile(originalPath, sandboxPath)) {
        continue;
      }
      if ((originalExists && !isTextFile(originalPath)) || (sandboxExists && !isTextFile(sandboxPath))) {
        continue;
      }

      const result = await runProcess("diff", ["-u", "--label", `a/${relativePath}`, "--label", `b/${relativePath}`, originalExists ? originalPath : nullDevice(), sandboxExists ? sandboxPath : nullDevice()], {
        cwd: sandboxRoot,
        timeoutMs: 10_000
      });
      if (result.exitCode === 0) {
        continue;
      }
      if (result.exitCode !== 1) {
        throw new Error(`Unable to diff ${relativePath}: ${result.stderr}`);
      }
      hunks.push(result.stdout);
    }

    return hunks.join("\n");
  }

  async promote(sandbox: Sandbox, approvalId: string): Promise<void> {
    if (!approvalId.trim()) {
      throw new Error("Approval ID is required before promotion.");
    }

    const diff = await this.diff(sandbox);
    if (!diff.trim()) {
      return;
    }

    validatePatchPaths(sandbox, diff);
    const patchPath = path.join(os.tmpdir(), `${sandbox.id}-promotion.diff`);
    await fs.promises.writeFile(patchPath, diff, "utf8");
    const result = await runProcess("git", ["apply", "--whitespace=nowarn", patchPath], {
      cwd: sandbox.originalWorkspacePath,
      timeoutMs: 10_000
    });
    await fs.promises.rm(patchPath, { force: true });

    if (result.exitCode !== 0) {
      throw new Error(`Sandbox promotion failed: ${result.stderr || result.stdout}`);
    }
  }

  async destroy(sandbox: Sandbox): Promise<void> {
    const parent = path.dirname(sandbox.path);
    await fs.promises.rm(parent, { recursive: true, force: true });
  }
}

export function parseCommandLine(commandLine: string): { command: string; args: string[] } {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < commandLine.length; index += 1) {
    const char = commandLine[index];
    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      continue;
    }
    if (quote === char) {
      quote = null;
      continue;
    }
    if (!quote && /\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  const [command = "", ...args] = tokens;
  return { command, args };
}

function createSandboxId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `sandbox_${Date.now().toString(36)}_${random}`;
}

function validateCommandPolicy(sandbox: Sandbox, command: string, args: string[]): Error | null {
  const executable = path.basename(command);
  if (shellExecutables.has(executable)) {
    return new SandboxPolicyError("Shell execution is blocked in local sandbox mode; pass an executable and arguments directly.");
  }

  if (sandbox.networkPolicy === "deny" && networkExecutables.has(executable)) {
    return new SandboxPolicyError(`Network command ${executable} is blocked by sandbox network policy.`);
  }

  const sandboxRoot = fs.realpathSync(sandbox.path);
  for (const arg of args) {
    if (!path.isAbsolute(arg) || arg === nullDevice()) {
      continue;
    }
    const target = fs.existsSync(arg) ? fs.realpathSync(arg) : path.resolve(arg);
    if (target !== sandboxRoot && !target.startsWith(sandboxRoot + path.sep)) {
      return new SandboxPolicyError(`Path ${arg} is outside the sandbox workspace.`);
    }
  }

  return null;
}

function validatePatchPaths(sandbox: Sandbox, patch: string): void {
  const root = fs.realpathSync(sandbox.path);
  const pathPattern = /^(?:---|\+\+\+) [ab]\/(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = pathPattern.exec(patch)) !== null) {
    const relativePath = match[1];
    if (!relativePath || relativePath === "/dev/null") {
      continue;
    }
    if (relativePath.includes("..") || path.isAbsolute(relativePath)) {
      throw new SandboxPolicyError(`Patch path is outside the sandbox workspace: ${relativePath}`);
    }
    const target = path.resolve(root, relativePath);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new SandboxPolicyError(`Patch path is outside the sandbox workspace: ${relativePath}`);
    }
  }
}

function applyMinimalUnifiedPatch(sandbox: Sandbox, patch: string): Promise<void> {
  const filePatches = parseMinimalUnifiedPatch(patch);
  if (filePatches.length === 0) {
    throw new Error("Patch fallback found no file hunks to apply.");
  }

  for (const filePatch of filePatches) {
    const targetPath = path.join(sandbox.path, filePatch.path);
    if (!fs.existsSync(targetPath)) {
      throw new Error(`Patch fallback target does not exist: ${filePatch.path}`);
    }

    const original = fs.readFileSync(targetPath, "utf8");
    const hadTrailingNewline = original.endsWith("\n");
    const lines = original.replace(/\r\n/g, "\n").split("\n");
    if (hadTrailingNewline) {
      lines.pop();
    }

    for (const hunk of filePatch.hunks) {
      const oldLines: string[] = [];
      const newLines: string[] = [];
      for (const line of hunk) {
        const marker = line[0];
        const text = line.slice(1);
        if (marker === " ") {
          oldLines.push(text);
          newLines.push(text);
        } else if (marker === "-") {
          oldLines.push(text);
        } else if (marker === "+") {
          newLines.push(text);
        }
      }

      const index = oldLines.length === 0 ? lines.length : findSubsequence(lines, oldLines);
      if (index < 0) {
        throw new Error(`Patch fallback could not find hunk context in ${filePatch.path}.`);
      }
      lines.splice(index, oldLines.length, ...newLines);
    }

    fs.writeFileSync(targetPath, `${lines.join("\n")}${hadTrailingNewline ? "\n" : ""}`, "utf8");
  }

  return Promise.resolve();
}

function parseMinimalUnifiedPatch(patch: string): Array<{ path: string; hunks: string[][] }> {
  const files: Array<{ path: string; hunks: string[][] }> = [];
  let currentFile: { path: string; hunks: string[][] } | null = null;
  let currentHunk: string[] | null = null;

  for (const line of patch.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("+++ ")) {
      const nextPath = cleanPatchPath(line.slice(4).trim());
      if (!nextPath) {
        currentFile = null;
        currentHunk = null;
        continue;
      }
      currentFile = { path: nextPath, hunks: [] };
      files.push(currentFile);
      currentHunk = null;
      continue;
    }

    if (!currentFile) {
      continue;
    }

    if (line.startsWith("@@")) {
      currentHunk = [];
      currentFile.hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk || line.startsWith("\\ No newline")) {
      continue;
    }

    if (line.startsWith(" ") || line.startsWith("-") || line.startsWith("+")) {
      currentHunk.push(line);
    }
  }

  return files.filter((item) => item.hunks.length > 0);
}

function cleanPatchPath(value: string): string | null {
  if (value === "/dev/null") {
    return null;
  }
  if (value.startsWith("a/") || value.startsWith("b/")) {
    return value.slice(2);
  }
  return value || null;
}

function findSubsequence(haystack: string[], needle: string[]): number {
  if (needle.length === 0) {
    return haystack.length;
  }
  for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    if (needle.every((line, offset) => haystack[index + offset] === line)) {
      return index;
    }
  }
  return -1;
}

function collectRelativeFiles(originalRoot: string, sandboxRoot: string): string[] {
  const files = new Set<string>();
  collectFiles(originalRoot, originalRoot, files);
  collectFiles(sandboxRoot, sandboxRoot, files);
  return [...files].sort();
}

function collectFiles(root: string, current: string, files: Set<string>): void {
  if (!fs.existsSync(current)) {
    return;
  }
  const entries = fs.readdirSync(current, { withFileTypes: true });
  for (const entry of entries) {
    if (ignoredNames.has(entry.name)) {
      continue;
    }
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute);
    if (entry.isDirectory()) {
      collectFiles(root, absolute, files);
    } else if (entry.isFile()) {
      files.add(relative);
    }
  }
}

function sameFile(left: string, right: string): boolean {
  const leftStat = fs.statSync(left);
  const rightStat = fs.statSync(right);
  if (leftStat.size !== rightStat.size) {
    return false;
  }
  return fs.readFileSync(left).equals(fs.readFileSync(right));
}

function isTextFile(filePath: string): boolean {
  if (!fs.existsSync(filePath)) {
    return true;
  }
  const sample = fs.readFileSync(filePath).subarray(0, 8192);
  return !sample.includes(0);
}

async function assertDiskLimit(sandbox: Sandbox): Promise<void> {
  const limitBytes = sandbox.resourceLimits.diskMb * 1024 * 1024;
  const usedBytes = directorySize(sandbox.path);
  if (usedBytes > limitBytes) {
    throw new Error(`Sandbox disk limit exceeded: ${Math.ceil(usedBytes / 1024 / 1024)}MB used of ${sandbox.resourceLimits.diskMb}MB.`);
  }
}

function directorySize(root: string): number {
  if (!fs.existsSync(root)) {
    return 0;
  }
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    return stat.size;
  }
  if (!stat.isDirectory()) {
    return 0;
  }
  return fs.readdirSync(root).reduce((total, entry) => total + directorySize(path.join(root, entry)), 0);
}

function nullDevice(): string {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}

async function runProcess(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number }
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: `${stderr}${error.message}`, exitCode: 127, timedOut });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: timedOut ? 124 : exitCode ?? 0, timedOut });
    });
  });
}

export function sandboxFromRecord(input: {
  id: string;
  sandboxPath: string;
  workspacePath: string;
  createdAt: string;
  resourceLimits: SandboxResourceLimits;
  networkPolicy: SandboxNetworkPolicy;
  backend?: "local";
}): Sandbox {
  return {
    id: input.id,
    path: input.sandboxPath,
    originalWorkspacePath: input.workspacePath,
    createdAt: input.createdAt,
    backend: input.backend ?? "local",
    resourceLimits: input.resourceLimits,
    networkPolicy: input.networkPolicy
  };
}

export const sandboxModulePath = fileURLToPath(import.meta.url);
