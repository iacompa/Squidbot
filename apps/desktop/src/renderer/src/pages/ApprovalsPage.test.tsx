// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sample = [
  {
    id: "sb_one",
    kind: "sandbox-promotion" as const,
    title: "Promote sandbox sb_one…",
    summary: "Workspace: /tmp/x · 1024 bytes of diff",
    riskLevel: "medium" as const,
    createdAt: "2026-05-15T10:00:00Z",
    payload: { sandboxId: "sb_one", workspacePath: "/tmp/x" }
  }
];

let listPending: ReturnType<typeof vi.fn>;
let approveSandbox: ReturnType<typeof vi.fn>;
let rejectSandbox: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  listPending = vi.fn(async () => sample);
  approveSandbox = vi.fn(async (id: string) => ({ id, status: "promoted" }));
  rejectSandbox = vi.fn(async (id: string) => ({ id, status: "rejected" }));
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: { listPendingApprovals: listPending, approveSandbox, rejectSandbox }
  });
});
afterEach(() => { cleanup(); Reflect.deleteProperty(window, "squidbot"); });

describe("ApprovalsPage", () => {
  it("renders the queue from listPendingApprovals", async () => {
    const { ApprovalsPage } = await import("./ApprovalsPage");
    render(<ApprovalsPage />);
    await waitFor(() => expect(screen.getByText(/Promote sandbox sb_one/i)).toBeTruthy());
    expect(screen.getByText(/1024 bytes of diff/i)).toBeTruthy();
  });

  it("shows an empty state when nothing is pending", async () => {
    listPending.mockResolvedValueOnce([]);
    const { ApprovalsPage } = await import("./ApprovalsPage");
    render(<ApprovalsPage />);
    await waitFor(() => expect(screen.getByText(/no pending approvals/i)).toBeTruthy());
  });

  it("clicking Approve calls approveSandbox with the sandbox id", async () => {
    const { ApprovalsPage } = await import("./ApprovalsPage");
    render(<ApprovalsPage />);
    await waitFor(() => screen.getByText(/Promote sandbox sb_one/i));
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    await waitFor(() => expect(approveSandbox).toHaveBeenCalledWith("sb_one"));
  });

  it("clicking Reject calls rejectSandbox", async () => {
    const { ApprovalsPage } = await import("./ApprovalsPage");
    render(<ApprovalsPage />);
    await waitFor(() => screen.getByText(/Promote sandbox sb_one/i));
    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));
    await waitFor(() => expect(rejectSandbox).toHaveBeenCalledWith("sb_one"));
  });
});

describe("ApprovalsPage — connector-call kind", () => {
  beforeEach(() => {
    Object.defineProperty(window, "squidbot", {
      configurable: true,
      value: {
        listPendingApprovals: vi.fn(async () => [
          {
            id: "ap_cc1",
            kind: "connector-call",
            title: "Allow github.createIssue?",
            summary: "Args: { title: 'Bug', repo: 'foo' }",
            riskLevel: "high",
            createdAt: new Date().toISOString(),
            payload: {
              connectorName: "github",
              operationId: "createIssue",
              args: { title: "Bug" }
            }
          }
        ]),
        approveConnectorCall: vi.fn(async () => ({ ok: true, result: { number: 42 } })),
        rejectConnectorCall: vi.fn(async () => ({ ok: true }))
      }
    });
  });

  it("renders connector-call rows and routes Approve to approveConnectorCall", async () => {
    const { ApprovalsPage } = await import("./ApprovalsPage");
    render(<ApprovalsPage />);
    await waitFor(() => screen.getByText(/github\.createIssue/i));
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() =>
      expect((window as unknown as { squidbot: { approveConnectorCall: ReturnType<typeof vi.fn> } }).squidbot.approveConnectorCall).toHaveBeenCalledWith("ap_cc1")
    );
  });

  it("routes Reject to rejectConnectorCall", async () => {
    const { ApprovalsPage } = await import("./ApprovalsPage");
    render(<ApprovalsPage />);
    await waitFor(() => screen.getByText(/github\.createIssue/i));
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    await waitFor(() =>
      expect((window as unknown as { squidbot: { rejectConnectorCall: ReturnType<typeof vi.fn> } }).squidbot.rejectConnectorCall).toHaveBeenCalledWith("ap_cc1")
    );
  });
});
