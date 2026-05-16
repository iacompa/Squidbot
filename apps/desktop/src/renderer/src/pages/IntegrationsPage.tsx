import { useEffect, useState } from "react";
import { Cpu, MessageCircle, Plug } from "lucide-react";
import { ModelAccountsSection } from "../components/ModelAccountsSection";
import { ConnectorsSection } from "../components/ConnectorsSection";
import { MessagingSection } from "../components/MessagingSection";
import { squidbotApi } from "../lib/api";
import type { SettingsDto } from "../../../shared/api";

export type IntegrationsTab = "models" | "connectors" | "messaging";

type IntegrationsPageProps = {
  /**
   * Optional initial tab — used when the App.tsx redirect map routes the
   * deprecated PageId "messaging" to IntegrationsPage with a tab hint.
   */
  initialTab?: IntegrationsTab;
};

export function IntegrationsPage({ initialTab = "models" }: IntegrationsPageProps = {}) {
  const [tab, setTab] = useState<IntegrationsTab>(initialTab);
  const [settings, setSettings] = useState<SettingsDto | null>(null);

  // ConnectorsSection needs settings — load lazily when its tab is opened so
  // a user who only ever uses AI models doesn't pay the IPC cost on mount.
  useEffect(() => {
    if (tab === "connectors" && settings === null) {
      void squidbotApi.getSettings().then(setSettings);
    }
  }, [tab, settings]);

  return (
    <main className="page-panel integrations-page">
      <header className="page-header">
        <div>
          <p className="section-label">Integrations</p>
          <h2>Connect your tools</h2>
          <p className="page-subtitle">
            SquidBot uses AI models for reasoning and connectors for action. Keys live on this machine
            only — they never reach our servers.
          </p>
        </div>
      </header>

      <div className="integrations-tabs" role="tablist" aria-label="Integration types">
        <button
          role="tab"
          type="button"
          aria-selected={tab === "models"}
          className={tab === "models" ? "is-active" : ""}
          onClick={() => setTab("models")}
        >
          <Cpu size={15} aria-hidden /> AI models
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={tab === "connectors"}
          className={tab === "connectors" ? "is-active" : ""}
          onClick={() => setTab("connectors")}
        >
          <Plug size={15} aria-hidden /> Connectors
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={tab === "messaging"}
          className={tab === "messaging" ? "is-active" : ""}
          onClick={() => setTab("messaging")}
        >
          <MessageCircle size={15} aria-hidden /> Messaging
        </button>
      </div>

      <div className="integrations-tab-content">
        {tab === "models" && <ModelAccountsSection />}
        {tab === "connectors" && settings && (
          <ConnectorsSection settings={settings} onSettingsChange={setSettings} />
        )}
        {tab === "connectors" && !settings && <div className="muted">Loading…</div>}
        {tab === "messaging" && <MessagingSection />}
      </div>
    </main>
  );
}
