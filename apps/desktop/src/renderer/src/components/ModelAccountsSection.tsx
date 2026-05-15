import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Plus, RefreshCcw, Save, Trash2 } from "lucide-react";
import { squidbotApi } from "../lib/api";
import type {
  ModelAccountInputDto,
  ModelAccountSummaryDto,
  ModelCatalogEntryDto,
  ProviderKindDto,
  ProviderPresetDto
} from "../../../shared/api";

/**
 * Reusable multi-account model picker. Used in two places:
 *
 *   1. Settings → "Model accounts" section (always visible).
 *   2. Onboarding → Step 0 "Connect a model" (must be completed before the
 *      structured questions begin).
 *
 * Why a shared component?
 *   • The two surfaces have identical data needs (listModelAccounts +
 *     getProviderPresets + the upsert/activate/delete IPCs) and identical UI
 *     primitives (provider dropdown, key field, model dropdown with live
 *     refresh). Duplicating that logic would mean two places to fix when a
 *     provider quirk is discovered.
 *   • The two surfaces *don't* share top-level chrome, so the component
 *     itself doesn't try to be a page — it's a focused panel that drops into
 *     either context.
 *
 * Props are deliberately minimal:
 *   • `onAccountSaved` — fires after a successful save, so the parent can
 *     (for example) advance the onboarding wizard to the next step.
 *   • `forceOpenForm` — when the parent wants the form open immediately
 *     (onboarding step 0 with zero accounts), pass true to skip the "+ Add
 *     account" toggle and render the form straight away.
 *   • `introNode` — optional ReactNode rendered above the saved-accounts
 *     list. Used by onboarding to inject a chat-style welcome message from
 *     SquidBot.
 */
export type ModelAccountsSectionProps = {
  onAccountSaved?: (account: ModelAccountSummaryDto) => void;
  forceOpenForm?: boolean;
  introNode?: React.ReactNode;
};

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

export function ModelAccountsSection({
  onAccountSaved,
  forceOpenForm = false,
  introNode
}: ModelAccountsSectionProps) {
  const [accounts, setAccounts] = useState<ModelAccountSummaryDto[]>([]);
  const [activeAccountName, setActiveAccountName] = useState<string | null>(null);
  const [presets, setPresets] = useState<ProviderPresetDto[]>([]);
  const [showForm, setShowForm] = useState(forceOpenForm);
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
   * forceOpenForm callers (onboarding) want the form pre-populated with the
   * first preset as soon as presets arrive. Without this effect the form
   * would render with empty fields until the user manually picks a provider.
   */
  useEffect(() => {
    if (forceOpenForm && presets.length > 0 && !form.apiUrl) {
      const first = presets[0];
      setForm({
        ...EMPTY_FORM,
        providerKind: first.providerKind,
        apiUrl: first.defaultApiUrl,
        apiModel: first.defaultModel ?? "",
        catalog: first.catalog
      });
    }
    // We intentionally depend on `presets.length` and `forceOpenForm` only —
    // we DON'T want this to re-fire on every form keystroke, just when
    // presets first arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets.length, forceOpenForm]);

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
        activate: accounts.length === 0
      };
      const saved = await squidbotApi.upsertModelAccount(input);
      await reloadAccounts();
      if (!forceOpenForm) {
        closeForm();
      }
      onAccountSaved?.(saved);
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
      {introNode}

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
            {!forceOpenForm && (
              <button type="button" className="ghost-button" onClick={closeForm} disabled={saving}>
                Cancel
              </button>
            )}
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
