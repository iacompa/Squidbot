import { useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, FolderOpen, Plug, RefreshCw, ShieldCheck, Wand2 } from "lucide-react";
import { squidbotApi } from "../lib/api";
import { GovernanceSection, type GovernanceSectionHandle } from "../components/GovernanceSection";
import { IdentitySection } from "../components/IdentitySection";
import { ProfileSection, type ProfileSectionHandle } from "../components/ProfileSection";
import { SkillsSection, type SkillsSectionHandle } from "../components/SkillsSection";
import type { SettingsDto } from "../../../shared/api";
import type { EnterpriseProfileDto, PageId } from "../types";

/**
 * Settings is the four-tab "local runtime" destination introduced in the
 * sidebar reorg (Task 1.7). The left rail switches between:
 *
 *   • General    — workspace + paths + onboarding shortcut + Docs accordion.
 *                  (Model accounts + connectors moved to IntegrationsPage.)
 *   • Profile    — Identity (read-only "whoami" summary) + Profiles config.
 *   • Skills     — installed skills + manifest detail.
 *   • Governance — security control plane.
 *
 * Tab state is mirrored to localStorage so a hot-reload or app restart
 * keeps you on the same tab. The deprecated PageIds (identity / profiles /
 * skills / governance) redirect here via `initialTab` in Task 1.8.
 */
export type SettingsTab = "general" | "profile" | "skills" | "governance";

type SettingsPageProps = {
  settings: SettingsDto;
  onSettingsChange: (settings: SettingsDto) => void;
  /**
   * Optional navigation hook so the Settings page can deep-link to other
   * pages (e.g. the Onboarding wizard or the Integrations destination).
   * Wired from `App.tsx`.
   */
  onNavigate?: (pageId: PageId) => void;
  /**
   * Optional initial tab — used when the App.tsx redirect map routes
   * deprecated PageIds (identity / profiles / skills / governance) to
   * SettingsPage with a tab hint.
   */
  initialTab?: SettingsTab;
};

const TAB_STORAGE_KEY = "settings.activeTab";

function loadInitialTab(initialFromProps?: SettingsTab): SettingsTab {
  if (initialFromProps) return initialFromProps;
  try {
    const stored = window.localStorage.getItem(TAB_STORAGE_KEY);
    if (
      stored === "general" ||
      stored === "profile" ||
      stored === "skills" ||
      stored === "governance"
    ) {
      return stored;
    }
  } catch {
    /* localStorage may be unavailable (incognito, SSR). Fall through. */
  }
  return "general";
}

export function SettingsPage({ settings, onSettingsChange, onNavigate, initialTab }: SettingsPageProps) {
  const [tab, setTab] = useState<SettingsTab>(() => loadInitialTab(initialTab));
  // Section handles + per-tab loading flags so each tab's Refresh button
  // can disable while in-flight. The standalone pages do this same dance;
  // we keep the parity so users get the spinner UX they're used to.
  const profileRef = useRef<ProfileSectionHandle | null>(null);
  const skillsRef = useRef<SkillsSectionHandle | null>(null);
  const governanceRef = useRef<GovernanceSectionHandle | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  // ProfileSection consumes formOpen / onFormOpenChange because the standalone
  // ProfilesPage owns the "New profile" toggle in its header. Inside Settings
  // we don't surface that toggle in the header strip (the section can grow its
  // own form trigger in a future task), so we just keep local state and never
  // open it from a toolbar — the section still renders correctly with formOpen
  // pinned to false.
  const [profileFormOpen, setProfileFormOpen] = useState(false);

  function switchTab(next: SettingsTab): void {
    setTab(next);
    try {
      window.localStorage.setItem(TAB_STORAGE_KEY, next);
    } catch {
      /* localStorage may be unavailable; tab still switches in-memory. */
    }
  }

  return (
    <main className="page-panel settings-page settings-page--tabbed">
      <header className="page-header">
        <div>
          <p className="section-label">Settings</p>
          <h2>Local runtime</h2>
        </div>
      </header>

      <div className="settings-shell">
        <nav className="settings-rail" role="tablist" aria-label="Settings sections">
          <button
            role="tab"
            type="button"
            aria-selected={tab === "general"}
            onClick={() => switchTab("general")}
          >
            General
          </button>
          <button
            role="tab"
            type="button"
            aria-selected={tab === "profile"}
            onClick={() => switchTab("profile")}
          >
            Profile
          </button>
          <button
            role="tab"
            type="button"
            aria-selected={tab === "skills"}
            onClick={() => switchTab("skills")}
          >
            Skills
          </button>
          <button
            role="tab"
            type="button"
            aria-selected={tab === "governance"}
            onClick={() => switchTab("governance")}
          >
            Governance
          </button>
        </nav>

        <div className="settings-content">
          {tab === "general" && (
            <GeneralTab settings={settings} onSettingsChange={onSettingsChange} onNavigate={onNavigate} />
          )}

          {tab === "profile" && (
            <>
              <div className="settings-tab-toolbar">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={profileLoading}
                  onClick={() => void profileRef.current?.refresh()}
                  aria-label="Refresh profile"
                >
                  <RefreshCw size={15} className={profileLoading ? "spin" : ""} aria-hidden />
                  <span>Refresh</span>
                </button>
              </div>
              <IdentitySection readonly />
              <ProfileSection
                ref={profileRef}
                formOpen={profileFormOpen}
                onFormOpenChange={setProfileFormOpen}
                onLoadingChange={setProfileLoading}
              />
            </>
          )}

          {tab === "skills" && (
            <>
              <div className="settings-tab-toolbar">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void skillsRef.current?.refresh()}
                  aria-label="Refresh skills"
                >
                  <RefreshCw size={15} aria-hidden />
                  <span>Refresh</span>
                </button>
              </div>
              <SkillsSection ref={skillsRef} />
            </>
          )}

          {tab === "governance" && (
            <>
              <div className="settings-tab-toolbar">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void governanceRef.current?.simulate()}
                  aria-label="Simulate governance policy"
                >
                  <ShieldCheck size={15} aria-hidden />
                  <span>Simulate</span>
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void governanceRef.current?.refresh()}
                  aria-label="Refresh governance"
                >
                  <RefreshCw size={15} aria-hidden />
                  <span>Refresh</span>
                </button>
              </div>
              <GovernanceSection ref={governanceRef} />
            </>
          )}
        </div>
      </div>
    </main>
  );
}

// -------------------------------------------------------------------------
// GeneralTab — workspace + paths + onboarding shortcut + docs accordion.
// Everything that used to live directly inside SettingsPage minus the
// connector + model-routing blocks (those moved to IntegrationsPage in
// Task 1.4). The Connectors heading row stays as a sign-post so an operator
// who still expects to find connectors here at least sees "we know about
// them, they live in Integrations now".
// -------------------------------------------------------------------------

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

type GeneralTabProps = {
  settings: SettingsDto;
  onSettingsChange: (settings: SettingsDto) => void;
  onNavigate?: (pageId: PageId) => void;
};

function GeneralTab({ settings, onSettingsChange, onNavigate }: GeneralTabProps) {
  // Active enterprise profile drives the onboarding-shortcut copy: a fresh
  // install on the default Generic Business shows "Start onboarding", while
  // an operator who's already configured a custom or vertical profile sees
  // "Re-run onboarding".
  const [activeProfile, setActiveProfile] = useState<EnterpriseProfileDto | null>(null);

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

  return (
    <>
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
            <p>
              {settings.connectors.length} installed — manage them in Integrations.
            </p>
          </div>
          <Plug size={18} />
        </div>
      </section>
    </>
  );
}
