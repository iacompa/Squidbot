import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { squidbotApi } from "../lib/api";
import type { ConnectorDto, SettingsDto } from "../../../shared/api";

/**
 * Per-connector configuration list. Renders an empty state when no
 * connectors are installed, or one card per connector with two
 * editable fields (base URL + API key) wired to the
 * `saveConnectorSetting` IPC.
 *
 * Why a shared component? Both the legacy Settings page and the new
 * IntegrationsPage (Task 1.4 of the sidebar reorg) need to render the
 * same connector list. Pulling this out of `SettingsPage` so we don't
 * duplicate the markup or the draft-state plumbing.
 *
 * Props are deliberately minimal — the parent owns the `SettingsDto`
 * and the change handler; this component just re-renders when the
 * settings change and forwards the updated DTO back up after a save.
 */
type ConnectorsSectionProps = {
  settings: SettingsDto;
  onSettingsChange: (next: SettingsDto) => void;
  /**
   * Active enterprise profile sensitivity, if known. When the profile is
   * "air-gapped" the Test button is hidden and the status row shows a
   * locked indicator explaining that real calls are disabled by the
   * profile. Optional — callers that don't know the profile can omit it
   * and the "disabled" state simply won't render.
   */
  activeProfileSensitivity?: string;
};

type ConnectorStatusDot = "grey" | "yellow" | "blue" | "green" | "amber" | "red" | "lock";

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - Date.parse(iso);
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/**
 * Derives the dot color + chip text from connector state. See Section 8
 * of the design doc for the 8-state matrix.
 */
function deriveStatus(
  connector: ConnectorDto,
  connectorSettings: SettingsDto["connectorSettings"][string] | undefined,
  activeProfileSensitivity: string | undefined
): { dot: ConnectorStatusDot; text: string } {
  if (activeProfileSensitivity === "air-gapped") {
    return { dot: "lock", text: "Real calls disabled by profile sensitivity" };
  }
  if (connector.fixtureMode) {
    return { dot: "yellow", text: "Mock data — toggle off for real" };
  }
  if (!connectorSettings?.apiKeyConfigured) {
    return { dot: "grey", text: "Add a key to use this" };
  }
  const last = connectorSettings?.lastTest;
  if (!last) {
    return { dot: "blue", text: "Test connection ↗" };
  }
  if (last.status === "ok") {
    const ageMs = Date.now() - Date.parse(last.at);
    if (ageMs < 86_400_000) {
      return { dot: "green", text: `tested ${formatRelativeTime(last.at)}` };
    }
    return { dot: "amber", text: "Re-test recommended" };
  }
  if (last.status === "auth") {
    return { dot: "red", text: "Key rejected — check and re-test" };
  }
  return { dot: "red", text: "Provider unreachable" };
}

type ConnectorDrafts = Record<string, { apiKey: string; baseUrl: string }>;

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

export function ConnectorsSection({ settings, onSettingsChange, activeProfileSensitivity }: ConnectorsSectionProps) {
  const [connectorDrafts, setConnectorDrafts] = useState<ConnectorDrafts>(() => buildConnectorDrafts(settings));

  useEffect(() => {
    setConnectorDrafts(buildConnectorDrafts(settings));
  }, [settings]);

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

  async function testConnector(connectorName: string): Promise<void> {
    // Fire the test, then refresh settings so the status indicator picks up
    // the new lastTest values populated by the IPC handler.
    await squidbotApi.testConnector(connectorName);
    onSettingsChange(await squidbotApi.getSettings());
  }

  return (
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

              {(() => {
                const status = deriveStatus(connector, connectorSettings, activeProfileSensitivity);
                const showTestButton =
                  connectorSettings?.apiKeyConfigured &&
                  !connector.fixtureMode &&
                  activeProfileSensitivity !== "air-gapped";
                return (
                  <div className="connector-status-row">
                    <span className={`connector-status-dot ${status.dot}`} aria-hidden />
                    <span className="connector-status-text">{status.text}</span>
                    {showTestButton && (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void testConnector(connector.name)}
                      >
                        Test
                      </button>
                    )}
                  </div>
                );
              })()}
            </article>
          );
        })
      )}
    </section>
  );
}
