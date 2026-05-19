import { forwardRef } from "react";
import { Menu, X } from "lucide-react";

type BurgerButtonProps = {
  onClick: () => void;
  expanded: boolean;
};

/**
 * Mobile hamburger button. Rendered only at width < --bp-mobile.
 * Hides on tablet+ via CSS (display: none).
 *
 * forwardRef so App can hold a ref for focus restoration when the
 * drawer closes (WCAG 2.4.3 — focus must return to the trigger).
 */
export const BurgerButton = forwardRef<HTMLButtonElement, BurgerButtonProps>(
  function BurgerButton({ onClick, expanded }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className="burger-button"
        onClick={onClick}
        aria-label={expanded ? "Close navigation" : "Open navigation"}
        aria-expanded={expanded}
      >
        {expanded ? <X size={22} aria-hidden /> : <Menu size={22} aria-hidden />}
      </button>
    );
  }
);
