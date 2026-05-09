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

describe("CLI affordance gaps", () => {
  it("lists, shows, and resolves gap records as JSON", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-cli-home-"));

    runRootNpm(
      [
        "run",
        "--silent",
        "run",
        "--",
        "--workspace",
        "./examples/buggy-python",
        "use nonexistentTool to do something"
      ],
      home
    );

    const listed = JSON.parse(runRootNpm(["run", "--silent", "gaps", "--", "list"], home)) as {
      gaps: Array<{ id: string; name: string; status: string }>;
    };
    const missingToolGap = listed.gaps.find((gap) => gap.name === "nonexistentTool");

    expect(missingToolGap).toBeDefined();

    const shown = JSON.parse(runRootNpm(["run", "--silent", "gaps", "--", "show", missingToolGap!.id], home)) as {
      gap: { id: string; name: string };
    };

    expect(shown.gap).toMatchObject({
      id: missingToolGap!.id,
      name: "nonexistentTool"
    });

    const resolved = JSON.parse(runRootNpm(["run", "--silent", "gaps", "--", "resolve", missingToolGap!.id], home)) as {
      gap: { id: string; status: string; resolvedAt: string | null };
    };

    expect(resolved.gap.status).toBe("resolved");
    expect(resolved.gap.resolvedAt).toBeTruthy();

    const openAfterResolve = JSON.parse(runRootNpm(["run", "--silent", "gaps", "--", "list"], home)) as {
      gaps: Array<{ id: string }>;
    };

    expect(openAfterResolve.gaps.some((gap) => gap.id === missingToolGap!.id)).toBe(false);
  });
});
