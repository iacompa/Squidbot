import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Plus, RefreshCw, UserCog } from "lucide-react";
import { squidbotApi } from "../lib/api";
import { TerminalSnippet } from "../components/TerminalSnippet";
import type { EnterpriseProfileDto, ProfileSensitivityDto } from "../types";

const SENSITIVITY_LABELS: Record<ProfileSensitivityDto, string> = {
  standard: "Standard — internal docs, communications",
  sensitive: "Sensitive — customer PII, financial data, contracts",
  regulated: "Regulated — HIPAA / GLBA / attorney-client privilege / FedRAMP",
  "air-gapped": "Air-gapped — no external network at all"
};

/**
 * Enterprise profiles management page.
 *
 *   • Lists all profiles (seeded + custom), marks the active one.
 *   • Lets the operator activate any profile with one click.
 *   • Lets the operator define a brand-new custom profile inline — the same
 *     primitive the onboarding wizard uses on its final step.
 */
export function ProfilesPage() {
  const [profiles, setProfiles] = useState<EnterpriseProfileDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  // Create-profile form state
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("general_business");
  const [role, setRole] = useState("");
  const [sensitivity, setSensitivity] = useState<ProfileSensitivityDto>("standard");
  const [readOnlyByDefault, setReadOnlyByDefault] = useState(false);
  const [activateOnCreate, setActivateOnCreate] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await squidbotApi.listEnterpriseProfiles();
      setProfiles(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const active = useMemo(() => profiles.find((profile) => profile.isActive) ?? null, [profiles]);
  const sorted = useMemo(
    () => [...profiles].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [profiles]
  );

  async function handleActivate(profileId: string): Promise<void> {
    setError(null);
    try {
      await squidbotApi.activateEnterpriseProfile(profileId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCreate(): Promise<void> {
    if (!name.trim()) {
      setError("Profile name is required.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await squidbotApi.createEnterpriseProfile({
        displayName: name.trim(),
        industry: industry.trim() || "general_business",
        role: role.trim() || null,
        sensitivity,
        readOnlyByDefault,
        activate: activateOnCreate
      });
      setName("");
      setRole("");
      setIndustry("general_business");
      setSensitivity("standard");
      setReadOnlyByDefault(false);
      setActivateOnCreate(true);
      setFormOpen(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

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
          <button type="button" className="ghost-button" onClick={refresh} disabled={loading} aria-label="Refresh profiles">
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

      {error && <div className="page-error">{error}</div>}

      {formOpen && (
        <section className="profile-form" aria-label="Create new profile">
          <h3>Define a custom profile</h3>
          <p className="muted">
            Tell SquidBot about your business. You can always come back and edit. For a guided experience instead,
            run the Onboarding wizard.
          </p>
          <div className="profile-form__grid">
            <label>
              <span>Display name</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Acme Corp"
                aria-label="Profile display name"
              />
            </label>
            <label>
              <span>Industry</span>
              <input
                type="text"
                value={industry}
                onChange={(event) => setIndustry(event.target.value)}
                placeholder="general_business"
                aria-label="Industry slug"
              />
            </label>
            <label>
              <span>Operator role</span>
              <input
                type="text"
                value={role}
                onChange={(event) => setRole(event.target.value)}
                placeholder="founder / operations lead / ..."
                aria-label="Operator role"
              />
            </label>
            <label>
              <span>Sensitivity</span>
              <select
                value={sensitivity}
                onChange={(event) => setSensitivity(event.target.value as ProfileSensitivityDto)}
                aria-label="Data sensitivity"
              >
                {(Object.keys(SENSITIVITY_LABELS) as ProfileSensitivityDto[]).map((value) => (
                  <option key={value} value={value}>
                    {SENSITIVITY_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="profile-form__checkbox">
              <input
                type="checkbox"
                checked={readOnlyByDefault}
                onChange={(event) => setReadOnlyByDefault(event.target.checked)}
              />
              <span>Read-only by default (recommended for regulated / sensitive data)</span>
            </label>
            <label className="profile-form__checkbox">
              <input
                type="checkbox"
                checked={activateOnCreate}
                onChange={(event) => setActivateOnCreate(event.target.checked)}
              />
              <span>Activate this profile right after creating it</span>
            </label>
          </div>
          <div className="profile-form__actions">
            <button type="button" className="ghost-button" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={handleCreate} disabled={creating}>
              {creating ? "Creating…" : "Create profile"}
            </button>
          </div>
        </section>
      )}

      <section className="profile-list" aria-label="Profiles list">
        {sorted.length === 0 && !loading && <div className="muted">No profiles loaded yet.</div>}
        {sorted.map((profile) => (
          <article
            key={profile.id}
            className={["profile-card", profile.isActive ? "is-active" : ""].filter(Boolean).join(" ")}
            aria-label={`Profile ${profile.displayName}`}
          >
            <div className="profile-card__head">
              <div>
                <div className="profile-card__name">
                  <UserCog size={16} aria-hidden /> {profile.displayName}
                  {profile.isActive && (
                    <span className="profile-card__active">
                      <CheckCircle2 size={14} aria-hidden /> Active
                    </span>
                  )}
                  {profile.seeded && <span className="profile-card__seed">example</span>}
                </div>
                <div className="profile-card__industry">
                  {profile.industry}
                  {profile.role && <> · {profile.role}</>}
                </div>
              </div>
              {!profile.isActive && (
                <button type="button" className="ghost-button" onClick={() => handleActivate(profile.id)}>
                  Activate
                </button>
              )}
            </div>
            <dl className="profile-card__detail">
              <div>
                <dt>Sensitivity</dt>
                <dd>
                  {profile.sensitivity}
                  {profile.readOnlyByDefault && <span className="chip chip--small">read-only</span>}
                </dd>
              </div>
              {profile.policyPacks.length > 0 && (
                <div>
                  <dt>Policy packs</dt>
                  <dd>{profile.policyPacks.join(", ")}</dd>
                </div>
              )}
              {profile.defaultSkills.length > 0 && (
                <div>
                  <dt>Default skills</dt>
                  <dd>{profile.defaultSkills.join(", ")}</dd>
                </div>
              )}
              {profile.primarySystems.length > 0 && (
                <div>
                  <dt>Systems</dt>
                  <dd>{profile.primarySystems.join(", ")}</dd>
                </div>
              )}
            </dl>
          </article>
        ))}
      </section>

      <section className="profile-terminal-hint">
        <h3>Equivalent terminal commands</h3>
        <TerminalSnippet command="npm run profile -- list" label="List profiles" />
        <TerminalSnippet command="npm run profile -- activate profile_seed_engineering_shop" label="Activate a vertical example" />
        <TerminalSnippet
          command={`npm run profile -- create --name "${active?.displayName ?? "Acme Corp"}" --industry saas --sensitivity sensitive --activate`}
          label="Create + activate a custom profile"
        />
      </section>
    </div>
  );
}
