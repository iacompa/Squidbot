type MobileNavBackdropProps = {
  visible: boolean;
  onClose: () => void;
};

/**
 * Translucent overlay that fades in when the mobile drawer is open.
 * Always rendered; toggles the .open class so the opacity transition
 * actually fires. Clicking it closes the drawer. Decorative — the
 * burger button is the accessible control.
 *
 * onClick is only wired while visible — when hidden, pointer-events:
 * none in CSS already lets clicks pass through, but guarding the
 * handler too keeps tests deterministic.
 */
export function MobileNavBackdrop({ visible, onClose }: MobileNavBackdropProps) {
  return (
    <div
      className={`mobile-nav-backdrop${visible ? " open" : ""}`}
      aria-hidden="true"
      onClick={visible ? onClose : undefined}
    />
  );
}
