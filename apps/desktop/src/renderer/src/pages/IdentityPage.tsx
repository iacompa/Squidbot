import { useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { IdentitySection, type IdentitySectionHandle } from "../components/IdentitySection";

/**
 * "About SquidBot" page. Shows what the agent thinks it is right now —
 * its identity card, the active enterprise profile, and its registered tool
 * capabilities. This is the GUI counterpart to `npm run whoami`.
 */
export function IdentityPage() {
  const sectionRef = useRef<IdentitySectionHandle | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <div className="page identity-page">
      <header className="page-header">
        <div>
          <h2>Identity</h2>
          <p className="page-subtitle">Who SquidBot thinks it is right now — adapted to your active business profile.</p>
        </div>
        <button
          type="button"
          className="ghost-button"
          onClick={() => void sectionRef.current?.refresh()}
          disabled={loading}
          aria-label="Refresh identity"
        >
          <RefreshCw size={14} className={loading ? "spin" : ""} aria-hidden /> Refresh
        </button>
      </header>
      <IdentitySection ref={sectionRef} onLoadingChange={setLoading} />
    </div>
  );
}
