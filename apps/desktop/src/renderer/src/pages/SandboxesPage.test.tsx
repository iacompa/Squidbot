// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SandboxDto } from "../types";

const activeSandbox: SandboxDto = {
  id: "sandbox_test_123",
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

describe("SandboxesPage", () => {
  it("loads staged work and approves the selected sandbox", async () => {
    vi.resetModules();
    const sandboxes = [activeSandbox];
    const listSandboxes = vi.fn(async ({ status }: { status?: string } = {}) => {
      if (status === "all") {
        return sandboxes;
      }
      return sandboxes.filter((sandbox) => sandbox.status === (status ?? "active"));
    });
    const approveSandbox = vi.fn(async (sandboxId: string) => {
      const sandbox = sandboxes.find((candidate) => candidate.id === sandboxId);
      if (!sandbox) {
        throw new Error("Sandbox not found");
      }
      sandbox.status = "promoted";
      sandbox.approvalId = "approval_test";
      sandbox.promotedAt = "2026-05-02T20:00:00.000Z";
      sandbox.destroyedAt = "2026-05-02T20:00:00.000Z";
      return sandbox;
    });

    Object.defineProperty(window, "squidbot", {
      configurable: true,
      value: {
        listSandboxes,
        getSandbox: vi.fn(async () => activeSandbox),
        approveSandbox,
        rejectSandbox: vi.fn()
      }
    });

    const { SandboxesPage } = await import("./SandboxesPage");
    render(<SandboxesPage />);

    expect((await screen.findAllByText("sandbox_test_123")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/return a \+ b/)).toBeTruthy();
    expect(screen.getByText(/pytest/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Approve/i }));

    await waitFor(() => {
      expect(approveSandbox).toHaveBeenCalledWith("sandbox_test_123");
    });
    await waitFor(() => {
      expect(screen.getByText("No sandboxes in this view")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "all" } });
    expect((await screen.findAllByText("sandbox_test_123")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("promoted").length).toBeGreaterThanOrEqual(1);
  });
});
