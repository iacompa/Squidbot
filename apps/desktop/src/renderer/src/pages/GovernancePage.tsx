import { useRef } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { GovernanceSection, type GovernanceSectionHandle } from "../components/GovernanceSection";

export function GovernancePage() {
  const sectionRef = useRef<GovernanceSectionHandle | null>(null);
  return (
    <main className="page-panel eval-page">
      <header className="page-header">
        <div>
          <p className="section-label">Governance</p>
          <h2>Security Control Plane</h2>
        </div>
        <div className="button-row">
          <button className="secondary-button" type="button" onClick={() => void sectionRef.current?.simulate()}>
            <ShieldCheck size={17} />
            <span>Simulate</span>
          </button>
          <button className="secondary-button" type="button" onClick={() => void sectionRef.current?.refresh()}>
            <RefreshCw size={17} />
            <span>Refresh</span>
          </button>
        </div>
      </header>
      <GovernanceSection ref={sectionRef} />
    </main>
  );
}
