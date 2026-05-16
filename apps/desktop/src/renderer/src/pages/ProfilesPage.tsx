import { useRef, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { ProfileSection, type ProfileSectionHandle } from "../components/ProfileSection";

/**
 * Enterprise profiles management page.
 *
 *   • Lists all profiles (seeded + custom), marks the active one.
 *   • Lets the operator activate any profile with one click.
 *   • Lets the operator define a brand-new custom profile inline — the same
 *     primitive the onboarding wizard uses on its final step.
 */
export function ProfilesPage() {
  const sectionRef = useRef<ProfileSectionHandle | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  return (
    <div className="page profiles-page">
      <header className="page-header">
        <div>
          <h2>Enterprise profiles</h2>
          <p className="page-subtitle">
            SquidBot adapts to your business. <strong>Generic Business</strong> is the safe default; the vertical
            examples are switchable; you can always define your own.
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => void sectionRef.current?.refresh()}
            disabled={loading}
            aria-label="Refresh profiles"
          >
            <RefreshCw size={14} className={loading ? "spin" : ""} aria-hidden /> Refresh
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => setFormOpen((current) => !current)}
            aria-expanded={formOpen}
          >
            <Plus size={14} aria-hidden /> New profile
          </button>
        </div>
      </header>
      <ProfileSection
        ref={sectionRef}
        formOpen={formOpen}
        onFormOpenChange={setFormOpen}
        onLoadingChange={setLoading}
      />
    </div>
  );
}
