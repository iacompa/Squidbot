import { useRef } from "react";
import { RefreshCw } from "lucide-react";
import { SkillsSection, type SkillsSectionHandle } from "../components/SkillsSection";

export function SkillsPage() {
  const sectionRef = useRef<SkillsSectionHandle | null>(null);
  return (
    <main className="page-panel skills-page">
      <header className="page-header">
        <div>
          <p className="section-label">Procedural memory</p>
          <h2>Skills</h2>
        </div>
        <button className="secondary-button" type="button" onClick={() => void sectionRef.current?.refresh()}>
          <RefreshCw size={17} />
          <span>Refresh</span>
        </button>
      </header>
      <SkillsSection ref={sectionRef} />
    </main>
  );
}
