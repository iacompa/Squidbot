import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { squidbotApi } from "../lib/api";

type Sentiment = "positive" | "negative" | "neutral";

type FeedbackButtonProps = {
  /** Page identifier for context. Stored alongside the feedback to help
   *  routing of follow-up. Optional. */
  currentPage?: string;
};

export function FeedbackButton({ currentPage }: FeedbackButtonProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sentiment, setSentiment] = useState<Sentiment>("neutral");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const reset = useCallback(() => {
    setMessage("");
    setSentiment("neutral");
    setError(null);
    setFeedbackId(null);
    setSubmitting(false);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    reset();
    triggerRef.current?.focus();
  }, [reset]);

  useEffect(() => {
    if (open && !feedbackId) {
      textareaRef.current?.focus();
    }
  }, [open, feedbackId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  async function submit(): Promise<void> {
    const trimmed = message.trim();
    if (!trimmed) {
      setError("Add a short note before sending.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await squidbotApi.submitFeedback({
        message: trimmed,
        page: currentPage,
        sentiment
      });
      setFeedbackId(result.feedbackId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="ghost-button feedback-trigger"
        aria-label="Send feedback"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MessageCircle size={14} aria-hidden />
        <span>Feedback</span>
      </button>

      {open ? (
        <div
          className="feedback-modal-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-modal-title"
            className="feedback-modal"
          >
            <header className="feedback-modal__header">
              <h3 id="feedback-modal-title">Send feedback</h3>
              <button
                type="button"
                className="ghost-button"
                onClick={close}
                aria-label="Close feedback"
              >
                <X size={14} aria-hidden />
              </button>
            </header>

            {feedbackId ? (
              <div className="feedback-modal__success">
                <p>Thanks — your feedback was logged.</p>
                <code aria-label="Feedback identifier">{feedbackId}</code>
                <div className="feedback-modal__actions">
                  <button type="button" className="primary-button" onClick={close}>
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <>
                <fieldset className="feedback-modal__sentiment" aria-label="Sentiment">
                  <button
                    type="button"
                    aria-pressed={sentiment === "positive"}
                    className={`sentiment-chip ${sentiment === "positive" ? "is-selected" : ""}`}
                    onClick={() => setSentiment("positive")}
                  >
                    <ThumbsUp size={14} aria-hidden /> Positive
                  </button>
                  <button
                    type="button"
                    aria-pressed={sentiment === "neutral"}
                    className={`sentiment-chip ${sentiment === "neutral" ? "is-selected" : ""}`}
                    onClick={() => setSentiment("neutral")}
                  >
                    Neutral
                  </button>
                  <button
                    type="button"
                    aria-pressed={sentiment === "negative"}
                    className={`sentiment-chip ${sentiment === "negative" ? "is-selected" : ""}`}
                    onClick={() => setSentiment("negative")}
                  >
                    <ThumbsDown size={14} aria-hidden /> Negative
                  </button>
                </fieldset>

                <textarea
                  ref={textareaRef}
                  className="feedback-modal__textarea"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="What worked, what didn't, what should change?"
                  rows={5}
                  maxLength={4000}
                  aria-label="Feedback message"
                />

                {error ? <div className="page-error">{error}</div> : null}

                <div className="feedback-modal__actions">
                  <button type="button" className="ghost-button" onClick={close} disabled={submitting}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void submit()}
                    disabled={submitting || !message.trim()}
                  >
                    {submitting ? "Sending…" : "Send"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
