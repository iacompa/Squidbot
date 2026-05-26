// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SandboxDto } from "../types";

const activeSandbox: SandboxDto = {
  id: "sandbox_approval_1",
  sessionId: "session_test",
  runId: "run_test",
  workspacePath: "/tmp/workspace",
  sandboxPath: "/tmp/sandbox/workspace",
  backend: "local",
  status: "active",
  resourceLimits: { cpu: 1, memoryMb: 512, diskMb: 512 },
  networkPolicy: "deny",
  diff: "--- a/calculator.py\n+++ b/calculator.py\n@@\n-    return a - b\n+    return a + b\n",
  testResults: [{ command: "pytest", exitCode: 0 }],
  approvalId: null,
  createdAt: "2026-05-02T19:49:39.448Z",
  updatedAt: "2026-05-02T19:49:39.448Z",
  promotedAt: null,
  destroyedAt: null,
  lastError: null
};

afterEach(() => {
  Reflect.deleteProperty(window, "squidbot");
});

describe("ApprovalsPage", () => {
  it("loads pending sandboxes and approves the selected item", async () => {
    vi.resetModules();
    const sandboxes = [activeSandbox];
    const listSandboxes = vi.fn(async ({ status }: { status?: string } = {}) =>
      status === "active" ? sandboxes : sandboxes.filter((sandbox) => sandbox.status === status)
    );
    const approveSandbox = vi.fn(async (sandboxId: string) => {
      const sandbox = sandboxes.find((candidate) => candidate.id === sandboxId);
      if (!sandbox) {
        throw new Error("Sandbox not found");
      }
      sandbox.status = "promoted";
      sandbox.approvalId = "approval_test";
      return sandbox;
    });

    Object.defineProperty(window, "squidbot", {
      configurable: true,
      value: {
        listSandboxes,
        approveSandbox,
        rejectSandbox: vi.fn()
      }
    });

    const { ApprovalsPage } = await import("./ApprovalsPage");
    render(<ApprovalsPage />);

    expect((await screen.findAllByText("sandbox_approval_1")).length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole("button", { name: /Approve/i }));

    await waitFor(() => {
      expect(approveSandbox).toHaveBeenCalledWith("sandbox_approval_1");
    });
  });
});
