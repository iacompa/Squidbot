import { useEffect, useState } from "react";
import { ArrowRight, FolderOpen, KeyRound, Plug, Save, Wand2 } from "lucide-react";
import { squidbotApi } from "../lib/api";
import type { SettingsDto } from "../../../shared/api";
import type { EnterpriseProfileDto, PageId } from "../types";

type SettingsPageProps = {
  settings: SettingsDto;
  onSettingsChange: (settings: SettingsDto) => void;
  /**
   * Optional navigation hook so the Settings page can deep-link to other
   * pages (e.g. the Onboarding wizard). Wired from `App.tsx`.
   */
  onNavigate?: (pageId: PageId) => void;
};

const GENERIC_PROFILE_ID = "profile_seed_generic_business";

type ConnectorDrafts = Record<string, { apiKey: string; baseUrl: string }>;
type ModelDrafts = { apiKey: string; apiUrl: string; apiModel: string; apiBudgetTokens: string };

export function SettingsPage({ settings, onSettingsChange, onNavigate }: SettingsPageProps) {
  const [connectorDrafts, setConnectorDrafts] = useState<ConnectorDrafts>(() => buildConnectorDrafts(settings));
  const [modelDrafts, setModelDrafts] = useState<ModelDrafts>(() => buildModelDrafts(settings));
  // Active enterprise profile drives the onboarding-shortcut copy: a fresh
  // install on the default Generic Business shows "Start onboarding", while
  // an operator who's already configured a custom or vertical profile sees
  // "Re-run onboarding".
  const [activeProfile, setActiveProfile] = useState<EnterpriseProfileDto | null>(null);

  useEffect(() => {
    setConnectorDrafts(buildConnectorDrafts(settings));
    setModelDrafts(buildModelDrafts(settings));
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    // The IPC handler may legitimately not exist in tests that mock a partial
    // API surface, so failures here are silent — the shortcut still renders
    // with its safe default copy ("Configure SquidBot for your business").
    if (typeof squidbotApi.getActiveEnterpriseProfile !== "function") {
      return;
    }
    squidbotApi
      .getActiveEnterpriseProfile()
      .then((profile) => {
        if (!cancelled) setActiveProfile(profile);
      })
      .catch(() => {
        if (!cancelled) setActiveProfile(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isConfigured = activeProfile !== null && activeProfile.id !== GENERIC_PROFILE_ID;

  async function chooseWorkspace(): Promise<void> {
    const selected = await squidbotApi.chooseWorkspace();
    if (selected) {
      onSettingsChange(await squidbotApi.getSettings());
    }
  }

  async function saveModelProvider(provider: "local" | "api" | "mock"): Promise<void> {
    onSettingsChange(await squidbotApi.saveSetting("model.provider", provider));
  }

  function updateModelDraft(key: keyof ModelDrafts, value: string): void {
    setModelDrafts((current) => ({ ...current, [key]: value }));
  }

  async function saveModelSetting(key: "model.apiKey" | "model.apiUrl" | "model.apiModel" | "model.budget.api"): Promise<void> {
    const draftKey =
      key === "model.apiKey"
        ? "apiKey"
        : key === "model.apiUrl"
          ? "apiUrl"
          : key === "model.apiModel"
            ? "apiModel"
            : "apiBudgetTokens";
    onSettingsChange(await squidbotApi.saveSetting(key, modelDrafts[draftKey]));
  }

  function updateConnectorDraft(connectorName: string, key: "apiKey" | "baseUrl", value: string): void {
    setConnectorDrafts((current) => ({
      ...current,
      [connectorName]: {
        ...(current[connectorName] ?? { apiKey: "", baseUrl: "" }),
        [key]: value
      }
    }));
  }

  async function saveConnectorSetting(connectorName: string, key: "apiKey" | "baseUrl"): Promise<void> {
    const value = connectorDrafts[connectorName]?.[key] ?? "";
    onSettingsChange(await squidbotApi.saveConnectorSetting(connectorName, key, value));
  }

  return (
    <main className="page-panel settings-page">
      <header className="page-header">
        <div>
          <p className="section-label">Settings</p>
          <h2>Local runtime</h2>
        </div>
      </header>

      {onNavigate && (
        <section className="settings-shortcut" aria-label="Onboarding shortcut">
          <div className="settings-shortcut__icon" aria-hidden>
            <Wand2 size={26} />
          </div>
          <div className="settings-shortcut__copy">
            <h3>{isConfigured ? `Re-run onboarding` : `Configure SquidBot for your business`}</h3>
            <p>
              {isConfigured
                ? `You're currently onboarded as ${activeProfile?.displayName ?? "a custom profile"}. Re-run the wizard to refresh memories, pivot to a different business, or fine-tune your sensitivity + policy packs.`
                : `Six short questions tune SquidBot's vocabulary, policy packs, default skills, and memories to your specific business. Everything you answer becomes a memory with provenance — SquidBot will cite it in future runs.`}
            </p>
          </div>
          <button
            type="button"
            className="primary-button settings-shortcut__cta"
            onClick={() => onNavigate("onboarding")}
            aria-label={isConfigured ? "Re-run onboarding wizard" : "Start onboarding wizard"}
          >
            <Wand2 size={14} aria-hidden />
            <span>{isConfigured ? "Re-run onboarding" : "Start onboarding"}</span>
            <ArrowRight size={14} aria-hidden />
          </button>
        </section>
      )}

      <section className="settings-grid">
        <div className="settings-row">
          <div>
            <h3>Workspace folder</h3>
            <p>{settings.workspacePath ?? "No folder selected"}</p>
          </div>
          <button className="secondary-button" type="button" onClick={chooseWorkspace}>
            <FolderOpen size={17} />
            <span>Choose</span>
          </button>
        </div>

        <div className="settings-row">
          <div>
            <h3>Model provider</h3>
            <p>
              Current provider: {settings.modelSettings.provider} ({settings.modelSettings.costOwner})
            </p>
          </div>
          <div className="segmented-control" aria-label="Model provider">
            <button
              className={settings.modelSettings.provider === "local" ? "selected" : ""}
              type="button"
              onClick={() => void saveModelProvider("local")}
            >
              Local
            </button>
            <button
              className={settings.modelSettings.provider === "api" ? "selected" : ""}
              type="button"
              onClick={() => void saveModelProvider("api")}
            >
              <KeyRound size={14} />
              BYOK
            </button>
            <button
              className={settings.modelSettings.provider === "mock" ? "selected" : ""}
              type="button"
              onClick={() => void saveModelProvider("mock")}
            >
              Mock
            </button>
          </div>
        </div>

        <div className="settings-row wide">
          <div>
            <h3>Model budget</h3>
            <p>
              API usage today: {settings.modelSettings.apiUsedTokens} tokens
              {settings.modelSettings.apiRemainingTokens !== undefined
                ? `, ${settings.modelSettings.apiRemainingTokens} remaining`
                : ", no budget set"}
              , ${settings.modelSettings.apiCost.toFixed(6)} estimated
            </p>
          </div>
        </div>

        <div className="settings-row wide">
          <div>
            <h3>Local database</h3>
            <p>{settings.databasePath}</p>
          </div>
        </div>

        <div className="settings-row wide">
          <div>
            <h3>App data</h3>
            <p>{settings.appDataDir}</p>
          </div>
        </div>

        <div className="settings-row wide connector-settings-heading">
          <div>
            <h3>Connectors</h3>
            <p>{settings.connectors.length} installed</p>
          </div>
          <Plug size={18} />
        </div>
      </section>

      <section className="connector-settings-list" aria-label="Model provider settings">
        <article className="connector-settings-card">
          <div className="connector-card-header">
            <div>
              <span>Model routing</span>
              <h3>BYOK provider</h3>
              <p>Stored locally and disabled unless selected with an API key.</p>
            </div>
            <div className="connector-meta">
              <span>{settings.modelSettings.provider}</span>
              <span>{settings.modelSettings.costOwner}</span>
              <span>{settings.modelSettings.apiKeyConfigured ? "key set" : "no key"}</span>
            </div>
          </div>

          <div className="connector-config-grid">
            <label>
              <span>API URL</span>
              <div className="connector-input-row">
                <input
                  autoComplete="off"
                  onChange={(event) => updateModelDraft("apiUrl", event.target.value)}
                  placeholder="Optional OpenAI-compatible endpoint"
                  type="url"
                  value={modelDrafts.apiUrl}
                />
                <button className="secondary-button" onClick={() => void saveModelSetting("model.apiUrl")} type="button">
                  <Save size={15} />
                  <span>Save</span>
                </button>
              </div>
            </label>

            <label>
              <span>API key {settings.modelSettings.apiKeyConfigured ? "(set)" : ""}</span>
              <div className="connector-input-row">
                <input
                  autoComplete="off"
                  onChange={(event) => updateModelDraft("apiKey", event.target.value)}
                  placeholder="Optional"
                  type="password"
                  value={modelDrafts.apiKey}
                />
                <button className="secondary-button" onClick={() => void saveModelSetting("model.apiKey")} type="button">
                  <Save size={15} />
                  <span>Save</span>
                </button>
              </div>
            </label>

            <label>
              <span>Model name</span>
              <div className="connector-input-row">
                <input
                  autoComplete="off"
                  onChange={(event) => updateModelDraft("apiModel", event.target.value)}
                  placeholder="byok-openai-compatible"
                  value={modelDrafts.apiModel}
                />
                <button className="secondary-button" onClick={() => void saveModelSetting("model.apiModel")} type="button">
                  <Save size={15} />
                  <span>Save</span>
                </button>
              </div>
            </label>

            <label>
              <span>Daily token budget</span>
              <div className="connector-input-row">
                <input
                  min={1}
                  onChange={(event) => updateModelDraft("apiBudgetTokens", event.target.value)}
                  placeholder="Optional"
                  type="number"
                  value={modelDrafts.apiBudgetTokens}
                />
                <button className="secondary-button" onClick={() => void saveModelSetting("model.budget.api")} type="button">
                  <Save size={15} />
                  <span>Save</span>
                </button>
              </div>
            </label>
          </div>
        </article>
      </section>

      <section className="connector-settings-list" aria-label="Connector settings">
        {settings.connectors.length === 0 ? (
          <div className="empty-state compact">
            <h3>No connectors installed</h3>
            <p>Install a connector from the CLI to configure it here.</p>
          </div>
        ) : (
          settings.connectors.map((connector) => {
            const draft = connectorDrafts[connector.name] ?? { apiKey: "", baseUrl: "" };
            const connectorSettings = settings.connectorSettings[connector.name];
            return (
              <article className="connector-settings-card" key={connector.name}>
                <div className="connector-card-header">
                  <div>
                    <span>{connector.systemType}</span>
                    <h3>{connector.name}</h3>
                    <p>{connector.description}</p>
                  </div>
                  <div className="connector-meta">
                    <span>{connector.protocol}</span>
                    <span>{connector.fixtureMode ? "fixture" : "real"}</span>
                    <span>{connector.costOwner}</span>
                  </div>
                </div>

                <div className="connector-operations" aria-label={`${connector.name} operations`}>
                  {connector.operations.map((operation) => (
                    <code key={operation}>{operation}</code>
                  ))}
                </div>

                <div className="connector-config-grid">
                  <label>
                    <span>Base URL</span>
                    <div className="connector-input-row">
                      <input
                        autoComplete="off"
                        onChange={(event) => updateConnectorDraft(connector.name, "baseUrl", event.target.value)}
                        placeholder="Optional"
                        type="url"
                        value={draft.baseUrl}
                      />
                      <button
                        className="secondary-button"
                        onClick={() => void saveConnectorSetting(connector.name, "baseUrl")}
                        type="button"
                      >
                        <Save size={15} />
                        <span>Save</span>
                      </button>
                    </div>
                  </label>

                  <label>
                    <span>API key {connectorSettings?.apiKeyConfigured ? "(set)" : ""}</span>
                    <div className="connector-input-row">
                      <input
                        autoComplete="off"
                        onChange={(event) => updateConnectorDraft(connector.name, "apiKey", event.target.value)}
                        placeholder="Optional"
                        type="password"
                        value={draft.apiKey}
                      />
                      <button
                        className="secondary-button"
                        onClick={() => void saveConnectorSetting(connector.name, "apiKey")}
                        type="button"
                      >
                        <Save size={15} />
                        <span>Save</span>
                      </button>
                    </div>
                  </label>
                </div>
              </article>
            );
          })
        )}
      </section>
    </main>
  );
}

function buildModelDrafts(settings: SettingsDto): ModelDrafts {
  return {
    apiKey: "",
    apiUrl: settings.modelSettings.apiUrl ?? "",
    apiModel: settings.modelSettings.apiModel,
    apiBudgetTokens: settings.modelSettings.apiBudgetTokens?.toString() ?? ""
  };
}

function buildConnectorDrafts(settings: SettingsDto): ConnectorDrafts {
  return Object.fromEntries(
    settings.connectors.map((connector) => [
      connector.name,
      {
        apiKey: "",
        baseUrl: settings.connectorSettings[connector.name]?.baseUrl ?? ""
      }
    ])
  );
}
