import { Menu, X } from "lucide-react";

type BurgerButtonProps = {
  onClick: () => void;
  expanded: boolean;
};

/**
 * Mobile hamburger button. Rendered only at width < --bp-mobile.
 * Hides on tablet+ via CSS (display: none).
 */
export function BurgerButton({ onClick, expanded }: BurgerButtonProps) {
  return (
    <button
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
