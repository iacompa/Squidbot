import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  FolderOpen,
  KeyRound,
  Loader2,
  Plug,
  Plus,
  RefreshCcw,
  Save,
  Trash2,
  Wand2
} from "lucide-react";
import { squidbotApi } from "../lib/api";
import type {
  ModelAccountInputDto,
  ModelAccountSummaryDto,
  ModelCatalogEntryDto,
  ProviderKindDto,
  ProviderPresetDto,
  SettingsDto
} from "../../../shared/api";
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

/**
 * In-app docs surface lives directly inside Settings — that's where a brand-new
 * operator looks first, and putting the explanation right next to the controls
 * means they never have to alt-tab to a website to learn what a knob does.
 * Each topic optionally deep-links to the page it describes via `onNavigate`.
 *
 * Editing tip for future contributors: keep `body` to one short paragraph —
 * one idea per topic. If a topic needs more, add a follow-up topic instead.
 */
type DocTopic = {
  title: string;
  body: string;
  page?: PageId;
  pageLabel?: string;
};

const DOC_TOPICS: DocTopic[] = [
  {
    title: "What SquidBot is",
    body:
      "SquidBot is a local-first AI agent that runs entirely on your machine. It connects to large language models through your own API keys (BYOK — bring your own key), so you keep ownership of every chat, trace, and memory. Nothing leaves the laptop unless you wire it up yourself."
  },
  {
    title: "Getting started",
    body:
      "Run the onboarding wizard. Six short questions tune SquidBot's vocabulary, policy packs, default skills, and memories to your specific business. Every answer becomes a memory with provenance — SquidBot will cite it back to you in future runs.",
    page: "onboarding",
    pageLabel: "Open onboarding"
  },
  {
    title: "Chat",
    body:
      "The default surface. Talk to SquidBot in natural language. It can read files in your workspace, call tools, ask for your approval before risky operations, and even switch model accounts mid-conversation when you ask (\"use my OpenAI account instead\").",
    page: "chat",
    pageLabel: "Open chat"
  },
  {
    title: "Model accounts (BYOK)",
    body:
      "Save multiple model accounts — OpenRouter, OpenAI, Anthropic, Groq, Together, Ollama, or any OpenAI-compatible endpoint — and switch the active one any time. SquidBot can switch on its own when you ask it to in chat. Configure them below in this page, or from the CLI: `squidbot model accounts add`."
  },
  {
    title: "Identity",
    body:
      "What SquidBot believes it is right now: which model account is active, its bonded skills, the policies it's enforcing, the memories that shape its answers. Open this when you want to understand why SquidBot just behaved the way it did.",
    page: "identity",
    pageLabel: "Open identity"
  },
  {
    title: "Trust report",
    body:
      "A live audit surface for you — and, when you need it, for customers, auditors, or regulators. Shows real model spend, policy violations caught, audit-trail completeness, retention compliance, and provider-by-provider cost breakdowns.",
    page: "trust",
    pageLabel: "Open trust report"
  },
  {
    title: "Enterprise profiles",
    body:
      "A profile is a pre-tuned bundle: vocabulary, sensitivity defaults, policy packs, default skills. Start with the Generic Business profile (the default) and let onboarding personalise it — or pick a vertical preset.",
    page: "profiles",
    pageLabel: "Open profiles"
  },
  {
    title: "Memory",
    body:
      "Every memory has provenance — what created it, when, and the trace it came from. SquidBot retrieves relevant memories before each turn and can cite them in its answers. Curate, delete, or pin memories here.",
    page: "memory",
    pageLabel: "Open memory"
  },
  {
    title: "Traces",
    body:
      "Every chat turn and every task run is recorded as a trace: which model, which tools, which approvals, which cost. Replay any of them. Search across all of them. Export them for compliance.",
    page: "traces",
    pageLabel: "Open traces"
  },
  {
    title: "Skills, Jobs, and Teams",
    body:
      "Skills are reusable capabilities SquidBot can compose. Jobs are scheduled work. Teams are multi-agent collaborations with a shared blackboard. All optional — you can use SquidBot without any of them.",
    page: "skills",
    pageLabel: "Open skills"
  },
  {
    title: "Governance & approvals",
    body:
      "Tools have risk levels. Risky tools require explicit human approval; low-risk ones run automatically. The Governance page shows the policy engine state — who can do what, what's allowed, what's been audited.",
    page: "governance",
    pageLabel: "Open governance"
  },
  {
    title: "Sandboxes & evaluations",
    body:
      "Need to test a change without affecting your real data? Spin up a sandbox. Want to measure how well SquidBot does on a benchmark? Run an evaluation. Both keep the main runtime clean.",
    page: "sandboxes",
    pageLabel: "Open sandboxes"
  }
];

type ConnectorDrafts = Record<string, { apiKey: string; baseUrl: string }>;

export function SettingsPage({ settings, onSettingsChange, onNavigate }: SettingsPageProps) {
  const [connectorDrafts, setConnectorDrafts] = useState<ConnectorDrafts>(() => buildConnectorDrafts(settings));
  // Active enterprise profile drives the onboarding-shortcut copy: a fresh
  // install on the default Generic Business shows "Start onboarding", while
  // an operator who's already configured a custom or vertical profile sees
  // "Re-run onboarding".
  const [activeProfile, setActiveProfile] = useState<EnterpriseProfileDto | null>(null);

  useEffect(() => {
    setConnectorDrafts(buildConnectorDrafts(settings));
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

      <section className="settings-docs" aria-label="Docs and guides">
        <header className="settings-docs__header">
          <div className="settings-docs__icon" aria-hidden>
            <BookOpen size={20} />
          </div>
          <div>
            <h3>Docs &amp; guides</h3>
            <p className="settings-docs__intro">
              A short tour of SquidBot's surfaces. Expand any topic for a one-paragraph
              explanation; the link inside jumps straight to the relevant page.
            </p>
          </div>
        </header>
        <div className="settings-docs__list">
          {DOC_TOPICS.map((topic) => (
            <details className="settings-docs__item" key={topic.title}>
              <summary>{topic.title}</summary>
              <div className="settings-docs__body">
                <p>{topic.body}</p>
                {topic.page && onNavigate && (
                  <button
                    type="button"
                    className="secondary-button settings-docs__cta"
                    onClick={() => onNavigate(topic.page!)}
                  >
                    <span>{topic.pageLabel ?? `Open ${topic.page}`}</span>
                    <ArrowRight size={13} aria-hidden />
                  </button>
                )}
              </div>
            </details>
          ))}
        </div>
      </section>

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

      <ModelAccountsSection />


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

// ---------------------- Model accounts section ----------------------
//
// Replaces the old single-key BYOK form. Users can now save multiple model
// accounts (OpenRouter, OpenAI, Anthropic, Groq, …), see all of them at a
// glance, switch the active one, or remove one. The "+ Add account" form
// auto-fills the URL based on the provider preset, and the model dropdown
// is populated from the curated catalog — with a "Refresh from API" button
// that fetches the provider's live `/v1/models` list to override the static
// catalog when the user's key has access to models we don't ship.
//
// Security: API keys leave this component only via the upsertModelAccount
// IPC, which stores them in the model_accounts SQLite table. After that the
// renderer only ever sees `apiKeyConfigured: true` — never the raw key.

type ModelAccountFormState = {
  name: string;
  providerKind: ProviderKindDto;
  apiUrl: string;
  apiKey: string;
  apiModel: string;
  /** The catalog the dropdown is currently sourcing options from. */
  catalog: readonly ModelCatalogEntryDto[];
  /** Used to disable the refresh button while a fetch is in flight. */
  isDiscovering: boolean;
  /** Human-readable error from the last failed discoverModels call. */
  discoveryError: string | null;
  /** Confirmation banner shown briefly after a successful discoverModels. */
  discoverySuccess: string | null;
};

const EMPTY_FORM: ModelAccountFormState = {
  name: "",
  providerKind: "openrouter",
  apiUrl: "",
  apiKey: "",
  apiModel: "",
  catalog: [],
  isDiscovering: false,
  discoveryError: null,
  discoverySuccess: null
};

function ModelAccountsSection() {
  const [accounts, setAccounts] = useState<ModelAccountSummaryDto[]>([]);
  const [activeAccountName, setActiveAccountName] = useState<string | null>(null);
  const [presets, setPresets] = useState<ProviderPresetDto[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ModelAccountFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const reloadAccounts = useCallback(async () => {
    const next = await squidbotApi.listModelAccounts();
    setAccounts(next.accounts);
    setActiveAccountName(next.activeAccountName);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([squidbotApi.listModelAccounts(), squidbotApi.getProviderPresets()])
      .then(([accountsResp, presetsResp]) => {
        if (cancelled) return;
        setAccounts(accountsResp.accounts);
        setActiveAccountName(accountsResp.activeAccountName);
        setPresets(presetsResp);
      })
      .catch((err) => {
        if (!cancelled) {
          setSaveError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Reset the form to a chosen provider's defaults. This is the magic that
   * makes the "smart dropdown" feel right: picking Anthropic instantly
   * populates the URL, the default model, and the catalog the model
   * dropdown is sourced from — no manual configuration needed.
   */
  function selectProvider(kind: ProviderKindDto): void {
    const preset = presets.find((p) => p.providerKind === kind);
    if (!preset) return;
    setForm((current) => ({
      ...current,
      providerKind: kind,
      apiUrl: preset.defaultApiUrl,
      apiModel: preset.defaultModel ?? "",
      catalog: preset.catalog,
      discoveryError: null,
      discoverySuccess: null
    }));
  }

  function openAddForm(): void {
    // Default to the first preset (OpenRouter) so the form is usable on first
    // open without making the user pick a provider before they see fields.
    const firstPreset = presets[0];
    if (firstPreset) {
      setForm({
        ...EMPTY_FORM,
        name: "",
        providerKind: firstPreset.providerKind,
        apiUrl: firstPreset.defaultApiUrl,
        apiModel: firstPreset.defaultModel ?? "",
        catalog: firstPreset.catalog
      });
    } else {
      setForm(EMPTY_FORM);
    }
    setSaveError(null);
    setShowForm(true);
  }

  function closeForm(): void {
    setShowForm(false);
    setForm(EMPTY_FORM);
    setSaveError(null);
  }

  async function refreshModels(): Promise<void> {
    if (!form.apiUrl || !form.apiKey) {
      setForm((c) => ({
        ...c,
        discoveryError:
          "Enter an API URL and key first — that's how SquidBot asks the provider which models you can use.",
        discoverySuccess: null
      }));
      return;
    }
    setForm((c) => ({ ...c, isDiscovering: true, discoveryError: null, discoverySuccess: null }));
    try {
      const result = await squidbotApi.discoverModels({
        providerKind: form.providerKind,
        apiUrl: form.apiUrl,
        apiKey: form.apiKey
      });
      if (result.success) {
        setForm((c) => ({
          ...c,
          catalog: result.merged,
          isDiscovering: false,
          // Surface the count so the user knows the live fetch actually did
          // something. "Pulled 142 models" is much more reassuring than a
          // silent reload.
          discoverySuccess: `Pulled ${result.models.length} model${result.models.length === 1 ? "" : "s"} from the provider.`
        }));
      } else {
        setForm((c) => ({
          ...c,
          catalog: result.fallback.catalog,
          isDiscovering: false,
          discoveryError: `${result.code}: ${result.message}`
        }));
      }
    } catch (err) {
      setForm((c) => ({
        ...c,
        isDiscovering: false,
        discoveryError: err instanceof Error ? err.message : String(err)
      }));
    }
  }

  async function saveNewAccount(): Promise<void> {
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      setSaveError("Give the account a name (e.g. 'OpenRouter — Gemini Flash').");
      return;
    }
    if (!form.apiUrl) {
      setSaveError("API URL is required.");
      return;
    }
    if (!form.apiModel) {
      setSaveError("Pick a model from the dropdown, or refresh from the provider's catalog.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const input: ModelAccountInputDto = {
        name: trimmedName,
        providerKind: form.providerKind,
        apiUrl: form.apiUrl,
        apiKey: form.apiKey || undefined,
        apiModel: form.apiModel,
        // First account becomes active automatically — otherwise the runtime
        // has no model to route through and the user is in a worse state
        // than before they added it.
        activate: accounts.length === 0
      };
      await squidbotApi.upsertModelAccount(input);
      await reloadAccounts();
      closeForm();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function switchActive(name: string): Promise<void> {
    try {
      await squidbotApi.activateModelAccount(name);
      await reloadAccounts();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteAccount(name: string): Promise<void> {
    const ok = window.confirm(
      `Delete model account "${name}"? The API key stored for this account will be removed.`
    );
    if (!ok) return;
    try {
      await squidbotApi.deleteModelAccount(name);
      await reloadAccounts();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="model-accounts" aria-label="Model accounts">
      <header className="model-accounts__header">
        <div>
          <h3>Model accounts</h3>
          <p className="model-accounts__intro">
            Save one or more API keys. Switch the active account here, or just ask SquidBot in chat
            (&quot;use my OpenAI account instead&quot;).
          </p>
        </div>
        {!showForm && (
          <button type="button" className="primary-button" onClick={openAddForm}>
            <Plus size={14} aria-hidden /> Add account
          </button>
        )}
      </header>

      {saveError && <div className="model-accounts__error">{saveError}</div>}

      {accounts.length === 0 ? (
        <div className="empty-state compact">
          <h4>No model accounts yet</h4>
          <p>
            Add an OpenRouter, OpenAI, Anthropic, Groq, Together, or Ollama key to start chatting with
            a real model. Until you do, SquidBot routes everything through the deterministic mock
            provider.
          </p>
        </div>
      ) : (
        <ul className="model-accounts__list">
          {accounts.map((account) => {
            const isActive = account.name === activeAccountName;
            return (
              <li key={account.id} className={`model-account-row${isActive ? " is-active" : ""}`}>
                <div className="model-account-row__main">
                  <div className="model-account-row__title">
                    <strong>{account.name}</strong>
                    {isActive && (
                      <span className="chip chip--active">
                        <CheckCircle2 size={11} aria-hidden /> active
                      </span>
                    )}
                  </div>
                  <div className="model-account-row__meta">
                    <span className="chip chip--provider">{account.providerKind}</span>
                    <code>{account.apiModel}</code>
                    <span className="muted">
                      {account.apiKeyConfigured ? "key set" : "no key"}
                    </span>
                  </div>
                </div>
                <div className="model-account-row__actions">
                  {!isActive && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void switchActive(account.name)}
                    >
                      Switch
                    </button>
                  )}
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void deleteAccount(account.name)}
                    aria-label={`Delete ${account.name}`}
                  >
                    <Trash2 size={14} aria-hidden />
                    <span>Delete</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {showForm && (
        <div className="model-account-form" role="form" aria-label="Add a model account">
          <div className="model-account-form__row">
            <label>
              <span>Account name</span>
              <input
                autoComplete="off"
                type="text"
                placeholder="e.g. OpenRouter — main"
                value={form.name}
                onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
              />
            </label>

            <label>
              <span>Provider</span>
              <select
                value={form.providerKind}
                onChange={(e) => selectProvider(e.target.value as ProviderKindDto)}
              >
                {presets.map((preset) => (
                  <option key={preset.providerKind} value={preset.providerKind}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="model-account-form__full">
            <span>API URL</span>
            <input
              autoComplete="off"
              type="url"
              placeholder="https://provider/v1/chat/completions"
              value={form.apiUrl}
              onChange={(e) => setForm((c) => ({ ...c, apiUrl: e.target.value }))}
            />
          </label>

          <label className="model-account-form__full">
            <span>API key</span>
            <input
              autoComplete="off"
              type="password"
              placeholder="sk-…"
              value={form.apiKey}
              onChange={(e) => setForm((c) => ({ ...c, apiKey: e.target.value }))}
            />
          </label>

          <div className="model-account-form__model-row">
            <label className="model-account-form__model">
              <span>Model</span>
              {form.catalog.length > 0 ? (
                <select
                  value={form.apiModel}
                  onChange={(e) => setForm((c) => ({ ...c, apiModel: e.target.value }))}
                >
                  {!form.catalog.some((entry) => entry.id === form.apiModel) && form.apiModel && (
                    <option value={form.apiModel}>{form.apiModel} (custom)</option>
                  )}
                  {form.catalog.map((entry) => (
                    <option key={entry.id} value={entry.id} title={entry.description}>
                      {entry.label}
                      {entry.tier !== "balanced" ? ` — ${entry.tier}` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="Model id (e.g. gpt-5)"
                  value={form.apiModel}
                  onChange={(e) => setForm((c) => ({ ...c, apiModel: e.target.value }))}
                />
              )}
            </label>

            <button
              type="button"
              className="secondary-button"
              onClick={() => void refreshModels()}
              disabled={form.isDiscovering || !form.apiUrl || !form.apiKey}
              title="Ask the provider which models your key has access to"
            >
              {form.isDiscovering ? (
                <Loader2 size={14} className="spin" aria-hidden />
              ) : (
                <RefreshCcw size={14} aria-hidden />
              )}
              <span>{form.isDiscovering ? "Fetching…" : "Refresh from API"}</span>
            </button>
          </div>

          {form.discoverySuccess && (
            <div className="model-account-form__success">{form.discoverySuccess}</div>
          )}
          {form.discoveryError && (
            <div className="model-account-form__warn">{form.discoveryError}</div>
          )}

          <div className="model-account-form__actions">
            <button type="button" className="ghost-button" onClick={closeForm} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => void saveNewAccount()}
              disabled={saving}
            >
              <Save size={14} aria-hidden />
              <span>{saving ? "Saving…" : "Save account"}</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
