type MobileNavBackdropProps = {
  visible: boolean;
  onClose: () => void;
};

/**
 * Translucent overlay that fades in when the mobile drawer is open.
 * Clicking it closes the drawer. Decorative — the burger button is
 * the accessible control.
 */
export function MobileNavBackdrop({ visible, onClose }: MobileNavBackdropProps) {
  if (!visible) return null;
  return (
    <div
      className="mobile-nav-backdrop"
      aria-hidden="true"
      onClick={onClose}
    />
  );
}
