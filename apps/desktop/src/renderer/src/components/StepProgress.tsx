import { Check } from "lucide-react";

export type StepProgressStep = {
  id: string;
  label: string;
};

export type StepProgressProps = {
  steps: StepProgressStep[];
  /** Zero-based index of the currently active step. */
  currentIndex: number;
  /** Optional set of completed step ids — these render with a check mark. */
  completedIds?: Set<string>;
};

/**
 * Numbered, visually-progressing step indicator for multi-step flows like
 * the onboarding wizard. Renders a horizontal row with each step's number,
 * a filled bar showing progress, and a check mark on completed steps.
 *
 * Pure presentational — no state of its own. The caller controls which
 * step is current and which are completed.
 */
export function StepProgress({ steps, currentIndex, completedIds }: StepProgressProps) {
  const safeIndex = Math.max(0, Math.min(currentIndex, steps.length - 1));
  const progressPercent = steps.length <= 1 ? 100 : (safeIndex / (steps.length - 1)) * 100;

  return (
    <div className="step-progress" role="list" aria-label="Onboarding progress">
      <div className="step-progress__track" aria-hidden>
        <div className="step-progress__fill" style={{ width: `${progressPercent}%` }} />
      </div>
      <div className="step-progress__items">
        {steps.map((step, index) => {
          const isCurrent = index === safeIndex;
          const isCompleted = completedIds?.has(step.id) || index < safeIndex;
          return (
            <div
              key={step.id}
              role="listitem"
              className={[
                "step-progress__item",
                isCurrent ? "is-current" : "",
                isCompleted ? "is-completed" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              aria-current={isCurrent ? "step" : undefined}
            >
              <div className="step-progress__dot">
                {isCompleted ? <Check size={12} aria-hidden /> : <span>{index + 1}</span>}
              </div>
              <div className="step-progress__label">{step.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
