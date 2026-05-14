import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Compass, Sparkles, Wand2 } from "lucide-react";
import { squidbotApi } from "../lib/api";
import { StepProgress } from "../components/StepProgress";
import { TerminalSnippet } from "../components/TerminalSnippet";
import { TerminalRunner } from "../components/TerminalRunner";
import type {
  CommittedOnboardingDto,
  OnboardingAnswerDto,
  OnboardingInferenceDto,
  OnboardingQuestionDto
} from "../types";

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
export function OnboardingPage() {
  const [questions, setQuestions] = useState<OnboardingQuestionDto[]>([]);
  const [answers, setAnswers] = useState<Record<string, OnboardingAnswerDto>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [draftValue, setDraftValue] = useState("");
  const [inference, setInference] = useState<OnboardingInferenceDto | null>(null);
  const [inferring, setInferring] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState<CommittedOnboardingDto | null>(null);
  const [activateOnSave, setActivateOnSave] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // ----- Sync draft input to whatever the current answer is -----
  const currentQuestion = questions[currentIndex] ?? null;
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

  // ----- Step progress (one logical step per question + a final confirm step) -----
  const steps = useMemo(
    () => [
      ...questions.map((question, index) => ({
        id: question.id,
        label: `${index + 1}. ${shortLabelForQuestion(question)}`
      })),
      { id: "confirm", label: `${questions.length + 1}. Confirm` }
    ],
    [questions]
  );
  const onConfirmStep = currentIndex === questions.length;
  const completedIds = useMemo(() => new Set(Object.keys(answers)), [answers]);

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
    setCurrentIndex((current) => Math.min(current + 1, questions.length));
  }

  function handlePrev(): void {
    setError(null);
    setCurrentIndex((current) => Math.max(0, current - 1));
  }

  function handleSkip(): void {
    if (!currentQuestion || currentQuestion.required) return;
    setError(null);
    recordAnswer("", true);
    setCurrentIndex((current) => Math.min(current + 1, questions.length));
  }

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
          <button type="button" className="ghost-button" onClick={handleRestart}>
            Re-run onboarding
          </button>
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
                allowedCommands={["whoami", "trust.summary", "memory.list", "profile.current"]}
                defaultCommandId="whoami"
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
            Six short questions · SquidBot adapts in real time on the right · everything you say becomes a memory
            with provenance.
          </p>
        </div>
      </header>

      <StepProgress steps={steps} currentIndex={currentIndex} completedIds={completedIds} />

      {error && <div className="page-error">{error}</div>}

      <div className="onboarding-grid">
        <section className="onboarding-step" aria-label="Current question">
          {onConfirmStep ? (
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
              index={currentIndex}
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
