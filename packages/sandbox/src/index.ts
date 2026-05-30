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

/**
 * Options passed to a SandboxBackend.run call. The backend receives the
 * resolved command, args, and the sandbox working directory so it can
 * delegate to the right execution engine (local spawn, Docker, SSH, etc.)
 * without knowing about SandboxManager internals.
 */
export type SandboxBackendRunOptions = {
  command: string;
  args?: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
};

export type SandboxBackendRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
};

/**
 * Extension point for non-local sandbox execution (Docker, SSH, serverless,
 * etc.). Implement this interface and pass it to `new SandboxManager({ backend })`
 * to replace the default local-spawn execution without changing any other code.
 * Policy enforcement (network block, symlink guard, resource limits) always
 * runs in SandboxManager regardless of which backend is active.
 */
export interface SandboxBackend {
  readonly name: string;
  run(options: SandboxBackendRunOptions): Promise<SandboxBackendRunResult>;
}

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
const networkExecutables = new Set([
  "curl", "wget", "nc", "netcat", "ssh", "scp", "sftp", "ping", "dig", "nslookup",
  "rsync", "telnet", "ftp", "lftp", "aria2c", "axel"
]);
const shellExecutables = new Set(["sh", "bash", "zsh", "fish", "pwsh", "powershell"]);

// Subcommands of these tools that are known to perform network I/O.
const networkSubcommandsByTool: Record<string, Set<string>> = {
  git: new Set(["clone", "fetch", "pull", "push", "ls-remote", "remote", "archive"]),
  npm: new Set(["install", "i", "ci", "publish", "audit", "update", "outdated", "fund", "search", "view", "info", "ping", "exec", "dlx"]),
  pnpm: new Set(["install", "i", "add", "update", "publish", "audit", "outdated", "fetch", "search", "exec", "dlx"]),
  yarn: new Set(["install", "add", "publish", "audit", "outdated", "info", "search", "upgrade", "dlx"]),
  bun: new Set(["install", "i", "add", "update", "publish", "outdated", "x"]),
  pip: new Set(["install", "download", "search", "wheel"]),
  pip3: new Set(["install", "download", "search", "wheel"]),
  cargo: new Set(["fetch", "publish", "install", "search", "yank"]),
  gem: new Set(["install", "fetch", "push", "update", "search"]),
  composer: new Set(["install", "update", "require", "search", "create-project"]),
  go: new Set(["get", "install", "mod"]),
  brew: new Set(["install", "fetch", "update", "upgrade", "search"])
};

// Code-runner CLIs that accept an inline expression that could perform network I/O.
// We can't fully statically analyze the inline code, but we can scan the body for
// well-known network APIs — most legitimate test scripts don't reference them, while
// most exfil attempts do.
const inlineCodeRunners: Record<string, Set<string>> = {
  node: new Set(["-e", "--eval", "-p", "--print"]),
  deno: new Set(["eval"]),
  bun: new Set(["-e", "--eval"]),
  python: new Set(["-c"]),
  python3: new Set(["-c"]),
  ruby: new Set(["-e"]),
  perl: new Set(["-e", "-E"]),
  php: new Set(["-r"])
};

// Substrings that indicate the inline code is doing or preparing network I/O.
const networkIndicatorPatterns: RegExp[] = [
  /\b(urllib|urlopen|requests|httpx|aiohttp|http\.client|socket)\b/i,
  /\bfetch\s*\(/i,
  /\brequire\s*\(\s*['"](?:http|https|net|tls|dgram|dns)['"]\s*\)/i,
  /\bimport\s*\(\s*['"](?:http|https|node:http|node:https|node:net)['"]/i,
  /\bXMLHttpRequest\b/i,
  /\b__import__\s*\(\s*['"](?:urllib|http|socket|requests)/i,
  /\bNet::HTTP\b/i,
  /\bLWP::UserAgent\b/i,
  /\bfile_get_contents\s*\(\s*['"]https?:/i,
  /\bcurl_/i,
  // Inline code that names an actual network tool — catches shell-outs like
  // python3 -c "import os; os.system('curl ...')". We key on the network TOOL,
  // not the subprocess primitive: matching `subprocess`/`system`/`child_process`
  // alone would block ordinary local subprocess use in tests (a false positive).
  /\b(?:curl|wget|nc|netcat|telnet)\b/i
];

// Commands that run ANOTHER command — the network tool hides behind them
// (env curl, timeout 5 curl, xargs curl, nice -n 10 wget). We unwrap to the
// real command and re-classify it.
const wrapperCommands = new Set(["env", "timeout", "xargs", "nice", "stdbuf", "nohup", "setsid", "time", "ionice", "chrt"]);

/** Skip a wrapper's own flags / duration / KEY=VALUE assignments to find the wrapped command. */
function unwrapCommand(args: string[]): { command: string; args: string[] } | null {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith("-")) continue; // wrapper flag
    if (/^\d+(?:\.\d+)?[smhd]?$/.test(a)) continue; // timeout duration
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) continue; // env KEY=VALUE
    return { command: a, args: args.slice(i + 1) };
  }
  return null;
}

export function inlineCodeLooksLikeNetwork(code: string): boolean {
  return networkIndicatorPatterns.some((pattern) => pattern.test(code));
}

export function classifyNetworkPolicyBlock(command: string, args: string[], depth = 0): { blocked: boolean; reason?: string } {
  const executable = path.basename(command).toLowerCase().replace(/\.exe$/, "");
  if (networkExecutables.has(executable)) {
    return { blocked: true, reason: `Network command ${executable} is blocked by sandbox network policy.` };
  }
  // Unwrap wrapper commands (env/timeout/xargs/...) and re-classify the real
  // command they invoke. Depth-bounded so deeply-nested wrappers can't loop.
  if (wrapperCommands.has(executable) && depth < 5) {
    const unwrapped = unwrapCommand(args);
    if (unwrapped) {
      return classifyNetworkPolicyBlock(unwrapped.command, unwrapped.args, depth + 1);
    }
  }
  const subcommands = networkSubcommandsByTool[executable];
  if (subcommands) {
    const firstNonFlag = args.find((arg) => !arg.startsWith("-"));
    if (firstNonFlag && subcommands.has(firstNonFlag.toLowerCase())) {
      return {
        blocked: true,
        reason: `${executable} ${firstNonFlag} performs network I/O and is blocked by the sandbox network policy. Run the offline equivalent (e.g. --offline, --no-deps) or change networkPolicy.`
      };
    }
  }
  const inlineFlags = inlineCodeRunners[executable];
  if (inlineFlags) {
    for (let index = 0; index < args.length; index += 1) {
      if (!inlineFlags.has(args[index])) {
        continue;
      }
      const code = args[index + 1] ?? "";
      if (inlineCodeLooksLikeNetwork(code)) {
        return {
          blocked: true,
          reason: `${executable} inline code references network APIs (urllib/fetch/http/socket/...) and is blocked by sandbox network policy.`
        };
      }
    }
  }
  return { blocked: false };
}
// NOTE: of these limits, only `diskMb` is ENFORCED by the local-spawn backend
// (post-run via assertDiskLimit) and the wall-clock timeout bounds runtime.
// `cpu` and `memoryMb` are recorded and surfaced in events but NOT enforced —
// the local backend applies no cgroup/ulimit. A fork bomb or memory hog is only
// contained by the timeout. Hard CPU/memory isolation requires a container
// backend via the SandboxBackend interface (see sandboxBackend.ts).
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
  private readonly customBackend?: SandboxBackend;
  private readonly sandboxIndex = new Map<string, Sandbox>();

  get backendName(): string {
    return this.customBackend?.name ?? "local";
  }

  constructor(options: { baseDir?: string; backend?: SandboxBackend } = {}) {
    this.baseDir = options.baseDir ?? os.tmpdir();
    this.customBackend = options.backend;
  }

  async create(workspacePath: string, options: SandboxCreateOptions = {}): Promise<Sandbox> {
    const workspaceRoot = fs.realpathSync(workspacePath);
    const id = createSandboxId();
    const sandboxPath = path.join(this.baseDir, id, "workspace");
    const startedAt = Date.now();

    fs.mkdirSync(sandboxPath, { recursive: true });
    fs.cpSync(workspaceRoot, sandboxPath, {
      recursive: true,
      // Never follow or copy symlinks from the source workspace — they could point
      // at /etc, $HOME, /var, etc. and turn sandbox-relative paths into host reads.
      // dereference:false combined with the filter below means symlinks are skipped
      // entirely; we never create a symlink in the sandbox and never read through one.
      dereference: false,
      filter: (source) => {
        const name = path.basename(source);
        if (ignoredNames.has(name)) {
          return false;
        }
        try {
          const stat = fs.lstatSync(source);
          if (stat.isSymbolicLink()) {
            return false;
          }
        } catch {
          return false;
        }
        return true;
      }
    });

    assertNoSymlinksUnder(sandboxPath);

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
    this.sandboxIndex.set(sandbox.id, sandbox);
    return sandbox;
  }

  /**
   * Run a command in a sandbox identified by id. Routes through the custom
   * backend if one was configured, otherwise delegates to the local spawner.
   * Policy enforcement (network, symlink, resource limits) always runs here,
   * not in the backend — backends only decide *how* to execute the command.
   */
  async run(
    sandboxId: string,
    command: string,
    args: string[] = [],
    options: SandboxRunOptions & { database?: unknown } = {}
  ): Promise<SandboxRunResult> {
    const sandbox = this.sandboxIndex.get(sandboxId);
    if (!sandbox) {
      return {
        stdout: "",
        stderr: `Sandbox not found: ${sandboxId}`,
        exitCode: 1,
        durationMs: 0,
        timedOut: false,
        sandboxId,
        command,
        args
      };
    }
    if (this.customBackend) {
      const startedAt = Date.now();
      const policyError = validateCommandPolicy(sandbox, command, args);
      if (policyError) {
        return {
          stdout: "",
          stderr: policyError.message,
          exitCode: 126,
          durationMs: Date.now() - startedAt,
          timedOut: false,
          sandboxId,
          command,
          args,
          blockedByPolicy: true
        };
      }
      const backendResult = await this.customBackend.run({
        command,
        args,
        cwd: sandbox.path,
        env: buildSandboxEnv(sandbox),
        timeoutMs: options.timeoutMs
      });
      return {
        stdout: backendResult.stdout,
        stderr: backendResult.stderr,
        exitCode: backendResult.exitCode,
        durationMs: Date.now() - startedAt,
        timedOut: backendResult.timedOut ?? false,
        sandboxId,
        command,
        args
      };
    }
    return this.runCommand(sandbox, command, args, options);
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
        env: buildSandboxEnv(sandbox),
        windowsHide: true
      });

      const finish = (exitCode: number, extraStderr = ""): void => {
        if (resolved) {
          return;
        }
        resolved = true;
        clearTimeout(timer);
        if (killTimer) {
          clearTimeout(killTimer);
        }
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

      let killTimer: NodeJS.Timeout | undefined;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => {
          if (!resolved) {
            try {
              child.kill("SIGKILL");
            } catch {
              // ignore — process may have already exited
            }
            finish(137, "\nProcess force-killed after refusing SIGTERM.");
          }
        }, 5_000);
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

const SANDBOX_ENV_PASSTHROUGH = [
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TERM",
  "TMPDIR",
  "SHELL",
  "USER",
  "LOGNAME"
] as const;

function buildSandboxEnv(sandbox: Sandbox): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    HOME: path.join(sandbox.path, ".squidbot-home"),
    CI: "1",
    SQUIDBOT_SANDBOX: sandbox.id,
    SQUIDBOT_NETWORK_POLICY: sandbox.networkPolicy
  };
  for (const key of SANDBOX_ENV_PASSTHROUGH) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) {
      env[key] = value;
    }
  }
  return env;
}

function createSandboxId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `sandbox_${Date.now().toString(36)}_${random}`;
}

function assertNoSymlinksUnder(root: string): void {
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new SandboxPolicyError(`Symlink found inside sandbox after copy: ${fullPath}. Refusing to use sandbox.`);
      }
      if (entry.isDirectory()) {
        stack.push(fullPath);
      }
    }
  }
}

function validateCommandPolicy(sandbox: Sandbox, command: string, args: string[]): Error | null {
  const executable = path.basename(command);
  if (shellExecutables.has(executable)) {
    return new SandboxPolicyError("Shell execution is blocked in local sandbox mode; pass an executable and arguments directly.");
  }

  if (sandbox.networkPolicy === "deny") {
    const networkBlock = classifyNetworkPolicyBlock(command, args);
    if (networkBlock.blocked) {
      return new SandboxPolicyError(networkBlock.reason ?? "Network access blocked by sandbox policy.");
    }
  }

  const sandboxRoot = fs.realpathSync(sandbox.path);
  for (const arg of args) {
    if (arg === nullDevice()) {
      continue;
    }
    // Resolve EVERY arg against the sandbox root, not just absolute ones. The
    // child runs with cwd = sandbox.path, so a relative arg like "../../x"
    // escapes the workspace exactly like an absolute path does — the previous
    // check only inspected absolute args and let relative traversal through.
    // Non-path args (flags, plain values with no traversal) resolve to a
    // harmless in-sandbox path and pass.
    const resolved = path.resolve(sandboxRoot, arg);
    const target = fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
    if (target !== sandboxRoot && !target.startsWith(sandboxRoot + path.sep)) {
      return new SandboxPolicyError(`Path ${arg} is outside the sandbox workspace.`);
    }
  }

  return null;
}

function validatePatchPaths(sandbox: Sandbox, patch: string): void {
  const root = fs.realpathSync(sandbox.path);
  // Match EVERY file header line, whether or not it carries the a/ b/ prefix.
  // The git-apply fallback (applyMinimalUnifiedPatch + cleanPatchPath) honors
  // unprefixed paths, so an unprefixed "--- ../../x" header would otherwise skip
  // validation and let the fallback write outside the sandbox.
  const pathPattern = /^(?:---|\+\+\+) (.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = pathPattern.exec(patch)) !== null) {
    // Strip a trailing timestamp some diff tools append after a tab, then the
    // optional a/ b/ prefix — mirroring cleanPatchPath so validation sees the
    // same path the fallback will actually write to.
    const headerPath = match[1].trim().split("\t")[0];
    const relativePath = headerPath.startsWith("a/") || headerPath.startsWith("b/") ? headerPath.slice(2) : headerPath;
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
