import { useState } from "react";
import { Activity, Database } from "lucide-react";
import { RunListPage } from "./RunListPage";
import { MemoryPage } from "./MemoryPage";

type HistoryTab = "activity" | "memory";

type HistoryPageProps = {
  /**
   * Optional initial tab — used when the App.tsx redirect map routes
   * deprecated PageIds ("memory" / "traces") to HistoryPage with a tab hint.
   */
  initialTab?: HistoryTab;
};

export function HistoryPage({ initialTab = "activity" }: HistoryPageProps = {}) {
  const [tab, setTab] = useState<HistoryTab>(initialTab);
  return (
    <main className="page-panel history-page">
      <header className="page-header">
        <div>
          <p className="section-label">History</p>
          <h2>Everything SquidBot has done and learned</h2>
        </div>
      </header>

      <div className="integrations-tabs" role="tablist" aria-label="History views">
        <button
          role="tab"
          aria-selected={tab === "activity"}
          className={tab === "activity" ? "is-active" : ""}
          onClick={() => setTab("activity")}
        >
          <Activity size={15} aria-hidden /> Activity
        </button>
        <button
          role="tab"
          aria-selected={tab === "memory"}
          className={tab === "memory" ? "is-active" : ""}
          onClick={() => setTab("memory")}
        >
          <Database size={15} aria-hidden /> Memory
        </button>
      </div>

      <div className="integrations-tab-content">
        {tab === "activity" && <RunListPage embedded />}
        {tab === "memory" && <MemoryPage embedded />}
      </div>
    </main>
  );
}
