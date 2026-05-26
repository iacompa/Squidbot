// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let submitFeedback: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  submitFeedback = vi.fn(async () => ({ ok: true, feedbackId: "feedback_test_1", submittedAt: "2026-05-25T00:00:00Z" }));
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: { submitFeedback }
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "squidbot");
});

describe("FeedbackButton", () => {
  it("opens the modal when the trigger is clicked", async () => {
    const { FeedbackButton } = await import("./FeedbackButton");
    render(<FeedbackButton currentPage="briefing" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /send feedback/i }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByLabelText(/feedback message/i)).toBeTruthy();
  });

  it("submits feedback with message + page + sentiment and shows the returned id", async () => {
    const { FeedbackButton } = await import("./FeedbackButton");
    render(<FeedbackButton currentPage="chat" />);
    fireEvent.click(screen.getByRole("button", { name: /send feedback/i }));

    fireEvent.click(screen.getByRole("button", { name: /positive/i }));
    fireEvent.change(screen.getByLabelText(/feedback message/i), {
      target: { value: "Sandbox flow felt great." }
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(submitFeedback).toHaveBeenCalledWith({
        message: "Sandbox flow felt great.",
        page: "chat",
        sentiment: "positive"
      })
    );
    await waitFor(() => expect(screen.getByText(/feedback_test_1/)).toBeTruthy());
  });

  it("refuses to submit when message is empty", async () => {
    const { FeedbackButton } = await import("./FeedbackButton");
    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: /send feedback/i }));
    // Send button is disabled with no message — click should be a no-op.
    const sendButton = screen.getByRole("button", { name: /^send$/i }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);
    fireEvent.click(sendButton);
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  it("surfaces IPC errors without losing the user's draft", async () => {
    submitFeedback.mockRejectedValueOnce(new Error("Disk full"));
    const { FeedbackButton } = await import("./FeedbackButton");
    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: /send feedback/i }));
    fireEvent.change(screen.getByLabelText(/feedback message/i), {
      target: { value: "This is going to fail" }
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() => expect(screen.getByText(/Disk full/)).toBeTruthy());
    // Draft is preserved so the user can retry without retyping.
    expect((screen.getByLabelText(/feedback message/i) as HTMLTextAreaElement).value).toBe(
      "This is going to fail"
    );
  });
});
