import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Bot, CheckCircle2, Compass, Sparkles, Wand2 } from "lucide-react";
import { squidbotApi } from "../lib/api";
import { ModelAccountsSection } from "../components/ModelAccountsSection";
import { StepProgress } from "../components/StepProgress";
import { TerminalSnippet } from "../components/TerminalSnippet";
import { TerminalRunner } from "../components/TerminalRunner";
import type {
  CommittedOnboardingDto,
  ModelAccountSummaryDto,
  OnboardingAnswerDto,
  OnboardingInferenceDto,
  OnboardingQuestionDto,
  PageId
} from "../types";

type OnboardingPageProps = {
  /**
   * Optional navigation callback. When provided, the post-onboarding success
   * screen exposes an "Open Briefing" CTA that routes the user to the
   * Briefing home — wiring up Section 5.3 of the responsive-ui design.
   */
  onNavigate?: (pageId: PageId) => void;
};

/**
 * AI-assisted onboarding wizard.
 *
 *   • Left pane: one question at a time, with a progress bar and prev/next
 *     navigation.
 *   • Right pane: live preview of the inferred profile + memories — updates
 *     after every answer, so the operator sees SquidBot adapting in real time.
 *   • Final step: confirmation + commit, then a success screen with the new
 *     profile, written memories, and "Try this next" actions rendered as
 *     copy-able TerminalSnippets and an embedded TerminalRunner.
 *
 * The wizard infers a profile on every answer change by debouncing into the
 * `inferOnboarding` IPC handler. Inference is sub-millisecond locally, so the
 * preview feels instant.
 */
export function OnboardingPage({ onNavigate }: OnboardingPageProps = {}) {
  const [questions, setQuestions] = useState<OnboardingQuestionDto[]>([]);
  const [answers, setAnswers] = useState<Record<string, OnboardingAnswerDto>>({});
  // `currentIndex` is now offset by one to make room for the chat-style
  // "Connect a model" step at index 0. The first structured question is at
  // index 1, and the confirm step lives at index N+1 (instead of N).
  const [currentIndex, setCurrentIndex] = useState(0);
  const [draftValue, setDraftValue] = useState("");
  const [inference, setInference] = useState<OnboardingInferenceDto | null>(null);
  const [inferring, setInferring] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState<CommittedOnboardingDto | null>(null);
  const [activateOnSave, setActivateOnSave] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Model-step state. We pre-load existing accounts so a returning user who
  // already has a key configured (e.g. via Settings or the CLI) can move past
  // step 0 immediately. The ModelAccountsSection component manages its own
  // form/loading state — we just observe the count.
  const [modelAccounts, setModelAccounts] = useState<ModelAccountSummaryDto[]>([]);
  const [modelStepReady, setModelStepReady] = useState(false);

  // ----- Load the question catalog once -----
  useEffect(() => {
    let cancelled = false;
    squidbotApi
      .getOnboardingQuestions()
      .then((list) => {
        if (!cancelled) setQuestions(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ----- Load existing model accounts so step 0 knows whether to gate -----
  useEffect(() => {
    let cancelled = false;
    squidbotApi
      .listModelAccounts()
      .then((resp) => {
        if (cancelled) return;
        setModelAccounts(resp.accounts);
        setModelStepReady(true);
      })
      .catch(() => {
        if (!cancelled) setModelStepReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ----- Step routing (model step → questions → confirm) -----
  // currentIndex === 0          → Connect-a-model step
  // currentIndex === 1..N       → structured questions (questions[i-1])
  // currentIndex === N+1        → confirm + commit
  const isModelStep = currentIndex === 0;
  const questionIndex = currentIndex - 1;
  const currentQuestion =
    questionIndex >= 0 && questionIndex < questions.length ? questions[questionIndex] : null;

  // ----- Sync draft input to whatever the current answer is -----
  useEffect(() => {
    if (!currentQuestion) {
      setDraftValue("");
      return;
    }
    const stored = answers[currentQuestion.id];
    setDraftValue(stored?.rawValue ?? "");
  }, [currentQuestion?.id, answers]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- Re-infer whenever the recorded answers change -----
  const recordedAnswers = useMemo(
    () => questions.map((question) => answers[question.id]).filter(Boolean) as OnboardingAnswerDto[],
    [questions, answers]
  );
  useEffect(() => {
    if (recordedAnswers.length === 0) {
      setInference(null);
      return;
    }
    let cancelled = false;
    setInferring(true);
    squidbotApi
      .inferOnboarding(recordedAnswers)
      .then((next) => {
        if (!cancelled) setInference(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setInferring(false);
      });
    return () => {
      cancelled = true;
    };
  }, [recordedAnswers]);

  // ----- Step progress: model + N questions + confirm -----
  const steps = useMemo(
    () => [
      { id: "model", label: "1. Model" },
      ...questions.map((question, index) => ({
        id: question.id,
        label: `${index + 2}. ${shortLabelForQuestion(question)}`
      })),
      { id: "confirm", label: `${questions.length + 2}. Confirm` }
    ],
    [questions]
  );
  const onConfirmStep = currentIndex === questions.length + 1;
  const completedIds = useMemo(() => {
    // Mark the model step "done" as soon as the user has at least one saved
    // account — answers don't track this step (it's structurally different),
    // so we synthesize the completion here.
    const set = new Set<string>(Object.keys(answers));
    if (modelAccounts.length > 0) set.add("model");
    return set;
  }, [answers, modelAccounts.length]);

  const recordAnswer = useCallback(
    (value: string, skipped: boolean) => {
      if (!currentQuestion) return;
      setAnswers((current) => ({
        ...current,
        [currentQuestion.id]: {
          questionId: currentQuestion.id,
          rawValue: skipped ? "" : value,
          skipped
        }
      }));
    },
    [currentQuestion]
  );

  function handleNext(): void {
    if (!currentQuestion) return;
    const trimmed = draftValue.trim();
    const skipped = trimmed === "";
    if (skipped && currentQuestion.required) {
      setError(`"${currentQuestion.prompt}" is required.`);
      return;
    }
    setError(null);
    recordAnswer(trimmed, skipped);
    // questions.length + 1 is the confirm step.
    setCurrentIndex((current) => Math.min(current + 1, questions.length + 1));
  }

  function handlePrev(): void {
    setError(null);
    setCurrentIndex((current) => Math.max(0, current - 1));
  }

  function handleSkip(): void {
    if (!currentQuestion || currentQuestion.required) return;
    setError(null);
    recordAnswer("", true);
    setCurrentIndex((current) => Math.min(current + 1, questions.length + 1));
  }

  /**
   * The model step's "Continue" button — advances past step 0 once the user
   * has saved at least one account (or explicitly chose to proceed without
   * one, in which case SquidBot will route through the local/mock provider
   * until they add a key later via Settings).
   */
  function advancePastModelStep(): void {
    setError(null);
    setCurrentIndex(1);
  }

  /** Re-fetch the saved-accounts list after the model step saves one. */
  const refreshModelAccounts = useCallback(async () => {
    try {
      const resp = await squidbotApi.listModelAccounts();
      setModelAccounts(resp.accounts);
    } catch {
      // Non-fatal — the count was just optimistic UI.
    }
  }, []);

  function handleRestart(): void {
    setAnswers({});
    setDraftValue("");
    setCurrentIndex(0);
    setInference(null);
    setCommitted(null);
    setError(null);
  }

  async function handleCommit(): Promise<void> {
    if (!inference) return;
    setCommitting(true);
    setError(null);
    try {
      const result = await squidbotApi.commitOnboarding(recordedAnswers, { activate: activateOnSave });
      setCommitted(result.committed);
      setInference(result.inference);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCommitting(false);
    }
  }

  // ----- Success state -----
  if (committed) {
    return (
      <div className="page onboarding-page">
        <header className="page-header">
          <div>
            <h2>
              <Sparkles size={18} aria-hidden /> Onboarding complete
            </h2>
            <p className="page-subtitle">
              SquidBot is now configured for <strong>{committed.profile.displayName}</strong>.
            </p>
          </div>
          <div className="page-header__actions">
            {onNavigate && (
              <button
                type="button"
                className="primary-button"
                onClick={() => onNavigate("briefing")}
              >
                <Sparkles size={14} aria-hidden /> Open Briefing
              </button>
            )}
            <button type="button" className="ghost-button" onClick={handleRestart}>
              Re-run onboarding
            </button>
          </div>
        </header>

        <section className="onboarding-success">
          <div className="onboarding-success__profile">
            <CheckCircle2 size={20} aria-hidden />
            <div>
              <div className="onboarding-success__title">{committed.profile.displayName}</div>
              <div className="onboarding-success__meta">
                {committed.profile.industry} · sensitivity {committed.profile.sensitivity}
                {committed.profile.readOnlyByDefault && <> · read-only by default</>}
              </div>
              <div className="onboarding-success__provenance">
                Provenance run id: <code>{committed.syntheticRunId}</code>
              </div>
            </div>
          </div>

          <h3>Memories written</h3>
          <ul className="onboarding-success__memories">
            {committed.memories.map((memory) => (
              <li key={memory.id}>
                <span className={`memory-tag memory-tag--${memory.type}`}>{memory.type}</span>
                <div>
                  <div className="memory-title">{memory.title}</div>
                  <div className="memory-body">{memory.body}</div>
                </div>
              </li>
            ))}
          </ul>

          {inference && inference.nextActions.length > 0 && (
            <>
              <h3>Try this next</h3>
              <div className="onboarding-success__actions">
                {inference.nextActions.map((action, index) => {
                  // "npm run xxx    # comment" — show the comment as description.
                  const [commandPart, commentPart] = splitActionLine(action);
                  return (
                    <TerminalSnippet
                      key={index}
                      command={commandPart}
                      label={commentPart ?? undefined}
                      description={commentPart ? undefined : commandPart}
                    />
                  );
                })}
              </div>
              <TerminalRunner
                allowedCommands={["doctor", "demo", "whoami", "trust.summary", "memory.list", "profile.current"]}
                defaultCommandId="doctor"
                title="Or run one of these inside the app"
              />
            </>
          )}
        </section>
      </div>
    );
  }

  // ----- Wizard state -----
  return (
    <div className="page onboarding-page">
      <header className="page-header">
        <div>
          <h2>
            <Wand2 size={18} aria-hidden /> Get SquidBot configured for your business
          </h2>
          <p className="page-subtitle">
            First, connect SquidBot to an AI model. OpenAI is the default quick path, and if you pick
            it you can paste an API key or access token. Then six short questions tune it to your
            business — SquidBot adapts in real time on the right, and everything you say becomes a
            memory with provenance.
          </p>
        </div>
      </header>

      <StepProgress steps={steps} currentIndex={currentIndex} completedIds={completedIds} />

      <section className="onboarding-quickstart" aria-label="Quick start">
        <h3>Quick start</h3>
        <p className="muted-copy">
          Verify your install, then run the vertical-slice demo — fix a buggy Python calculator inside a sandbox.
        </p>
        <div className="onboarding-success__actions">
          <TerminalSnippet command="npm run doctor" label="Health check" />
          <TerminalSnippet command="npm run demo -- --workspace ./examples/buggy-python" label="Vertical slice demo" />
        </div>
        <TerminalRunner
          allowedCommands={["doctor", "demo", "whoami", "trust.summary"]}
          defaultCommandId="doctor"
          title="Run inside the app"
        />
      </section>

      {error && <div className="page-error">{error}</div>}

      <div className="onboarding-grid">
        <section className="onboarding-step" aria-label="Current question">
          {isModelStep ? (
            <ModelStep
              ready={modelStepReady}
              accountsCount={modelAccounts.length}
              onAccountSaved={() => {
                void refreshModelAccounts();
              }}
              onContinue={advancePastModelStep}
            />
          ) : onConfirmStep ? (
            <ConfirmStep
              inference={inference}
              activate={activateOnSave}
              onActivateChange={setActivateOnSave}
              onCommit={handleCommit}
              onBack={handlePrev}
              committing={committing}
            />
          ) : currentQuestion ? (
            <QuestionStep
              question={currentQuestion}
              index={questionIndex}
              total={questions.length}
              draftValue={draftValue}
              onChange={setDraftValue}
              onNext={handleNext}
              onPrev={handlePrev}
              onSkip={handleSkip}
              hasPrevious={currentIndex > 0}
            />
          ) : (
            <div className="muted">Loading questions…</div>
          )}
        </section>

        <aside className="onboarding-preview" aria-label="Live profile preview">
          <div className="onboarding-preview__header">
            <Compass size={14} aria-hidden /> Live preview {inferring && <span className="muted">· updating…</span>}
          </div>
          {inference ? (
            <PreviewPanel inference={inference} />
          ) : (
            <p className="muted">
              Start answering on the left — I'll show you exactly what I'm learning about your business here.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

// ---------------- Sub-components ----------------

/**
 * Step 0 — chat-style intro from SquidBot followed by the model-account
 * picker. This is the first thing a new operator sees on the Onboarding
 * page and is intentionally framed as a conversation: SquidBot introduces
 * itself, explains *why* it needs a model account, and then surfaces the
 * concrete form below.
 *
 * The "Continue" button has two modes:
 *   • Disabled state hint: "Add a model first or skip" — when the user has
 *     no saved accounts. The label changes to "Continue without a model"
 *     so the choice is explicit.
 *   • Enabled state: a normal "Continue" once an account exists.
 */
type ModelStepProps = {
  ready: boolean;
  accountsCount: number;
  onAccountSaved: () => void;
  onContinue: () => void;
};

function ModelStep({ ready, accountsCount, onAccountSaved, onContinue }: ModelStepProps) {
  if (!ready) {
    return <div className="muted">Loading model accounts…</div>;
  }
  const hasAccount = accountsCount > 0;
  return (
    <div className="onboarding-model-step">
      <div className="onboarding-chat-bubble" role="note" aria-label="SquidBot intro">
        <div className="onboarding-chat-bubble__avatar" aria-hidden>
          <Bot size={18} />
        </div>
        <div className="onboarding-chat-bubble__body">
          <p>
            <strong>Hi, I&apos;m SquidBot.</strong> Before we get into the questions about your business,
            let&apos;s plug me into a real AI model. OpenAI is preselected as the fastest path, but you
            can switch providers. If you use OpenAI, paste an API key or access token and I&apos;ll fetch
            the exact list of models your account can use.
          </p>
          <p className="muted">
            This is not a ChatGPT sign-in flow. You can also skip this for now and add a model later
            from Settings — but I&apos;ll be answering with the deterministic mock provider in the
            meantime, which is just a placeholder.
          </p>
        </div>
      </div>

      <ModelAccountsSection
        forceOpenForm={!hasAccount}
        onAccountSaved={onAccountSaved}
        introNode={null}
      />

      <div className="onboarding-actions">
        <span className="muted onboarding-model-step__hint">
          {hasAccount
            ? `${accountsCount} account${accountsCount === 1 ? "" : "s"} saved · SquidBot will route through the active one.`
            : "No account yet — you can still continue with the mock provider."}
        </span>
        <button type="button" className="primary-button" onClick={onContinue}>
          <span>{hasAccount ? "Continue" : "Continue without a model"}</span>
          <ArrowRight size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}

type QuestionStepProps = {
  question: OnboardingQuestionDto;
  index: number;
  total: number;
  draftValue: string;
  onChange: (value: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  hasPrevious: boolean;
};

function QuestionStep({
  question,
  index,
  total,
  draftValue,
  onChange,
  onNext,
  onPrev,
  onSkip,
  hasPrevious
}: QuestionStepProps) {
  return (
    <div className="onboarding-question">
      <div className="onboarding-question__meta">
        Question {index + 1} of {total}
        {question.required ? <span className="onboarding-required">required</span> : <span className="muted"> · optional</span>}
      </div>
      <h3 className="onboarding-question__prompt">{question.prompt}</h3>
      {question.hint && <p className="onboarding-question__hint">{question.hint}</p>}

      {question.kind === "choice" && question.choices ? (
        <div className="onboarding-choices">
          {question.choices.map((choice) => (
            <button
              type="button"
              key={choice.value}
              className={`onboarding-choice ${draftValue === choice.value ? "is-selected" : ""}`}
              onClick={() => onChange(choice.value)}
            >
              <div className="onboarding-choice__label">{choice.label}</div>
              {choice.description && <div className="onboarding-choice__desc">{choice.description}</div>}
            </button>
          ))}
        </div>
      ) : (
        <textarea
          className="onboarding-input"
          value={draftValue}
          onChange={(event) => onChange(event.target.value)}
          rows={4}
          placeholder="Type your answer…"
          aria-label={question.prompt}
        />
      )}

      <div className="onboarding-actions">
        <button type="button" className="ghost-button" onClick={onPrev} disabled={!hasPrevious}>
          <ArrowLeft size={14} aria-hidden /> Back
        </button>
        <div className="onboarding-actions__right">
          {!question.required && (
            <button type="button" className="ghost-button" onClick={onSkip}>
              Skip
            </button>
          )}
          <button type="button" className="primary-button" onClick={onNext}>
            Next <ArrowRight size={14} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

type ConfirmStepProps = {
  inference: OnboardingInferenceDto | null;
  activate: boolean;
  onActivateChange: (value: boolean) => void;
  onCommit: () => void;
  onBack: () => void;
  committing: boolean;
};

function ConfirmStep({ inference, activate, onActivateChange, onCommit, onBack, committing }: ConfirmStepProps) {
  return (
    <div className="onboarding-confirm">
      <h3>Ready to save</h3>
      <p className="muted">
        Review the inferred profile on the right. When you confirm, SquidBot will create the profile, write your
        memories, and (optionally) activate the profile so the agent is tuned to your business from this point on.
      </p>
      {inference && (
        <ul className="onboarding-confirm__rationale">
          {inference.rationale.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}
      <label className="onboarding-confirm__activate">
        <input type="checkbox" checked={activate} onChange={(event) => onActivateChange(event.target.checked)} />
        <span>Activate this profile right away</span>
      </label>
      <div className="onboarding-actions">
        <button type="button" className="ghost-button" onClick={onBack} disabled={committing}>
          <ArrowLeft size={14} aria-hidden /> Back
        </button>
        <button type="button" className="primary-button" onClick={onCommit} disabled={!inference || committing}>
          {committing ? "Saving…" : "Save & finish"}
        </button>
      </div>
    </div>
  );
}

function PreviewPanel({ inference }: { inference: OnboardingInferenceDto }) {
  const vocabEntries = Object.entries(inference.profile.vocabulary);
  return (
    <dl className="preview-list">
      <div>
        <dt>Display name</dt>
        <dd>{inference.profile.displayName}</dd>
      </div>
      <div>
        <dt>Industry</dt>
        <dd>{inference.profile.industry}</dd>
      </div>
      {inference.profile.role && (
        <div>
          <dt>Operator role</dt>
          <dd>{inference.profile.role}</dd>
        </div>
      )}
      <div>
        <dt>Sensitivity</dt>
        <dd>
          {inference.profile.sensitivity}
          {inference.profile.readOnlyByDefault && <span className="chip chip--small">read-only</span>}
        </dd>
      </div>
      {inference.profile.policyPacks.length > 0 && (
        <div>
          <dt>Policy packs</dt>
          <dd className="chip-row">
            {inference.profile.policyPacks.map((pack) => (
              <span key={pack} className="chip">
                {pack}
              </span>
            ))}
          </dd>
        </div>
      )}
      {inference.profile.primarySystems.length > 0 && (
        <div>
          <dt>Systems</dt>
          <dd>{inference.profile.primarySystems.join(", ")}</dd>
        </div>
      )}
      {inference.profile.primaryChannels.length > 0 && (
        <div>
          <dt>Channels</dt>
          <dd>{inference.profile.primaryChannels.join(", ")}</dd>
        </div>
      )}
      {vocabEntries.length > 0 && (
        <div>
          <dt>Vocabulary</dt>
          <dd>
            {vocabEntries.map(([from, to]) => (
              <span key={from} className="vocab-pair">
                {from}→{to}
              </span>
            ))}
          </dd>
        </div>
      )}
      {inference.memories.length > 0 && (
        <div>
          <dt>Memories</dt>
          <dd>
            <ul className="preview-memories">
              {inference.memories.map((memory) => (
                <li key={memory.type + memory.title}>
                  <span className={`memory-tag memory-tag--${memory.type}`}>{memory.type}</span>
                  <div>
                    <div className="memory-title">{memory.title}</div>
                    <div className="memory-body">{memory.body}</div>
                  </div>
                </li>
              ))}
            </ul>
          </dd>
        </div>
      )}
    </dl>
  );
}

// ---------------- Helpers ----------------

const SHORT_LABELS: Record<string, string> = {
  business_summary: "Business",
  role: "Role",
  founder_note: "Time-waster",
  systems: "Systems",
  sensitivity: "Sensitivity",
  guardrail: "Guardrails"
};

function shortLabelForQuestion(question: OnboardingQuestionDto): string {
  return SHORT_LABELS[question.id] ?? question.id;
}

function splitActionLine(action: string): [string, string | null] {
  // "npm run whoami    # confirm the new profile is active"
  const commentIndex = action.indexOf("#");
  if (commentIndex < 0) {
    return [action.trim(), null];
  }
  const command = action.slice(0, commentIndex).trim();
  const comment = action.slice(commentIndex + 1).trim();
  return [command, comment || null];
}
