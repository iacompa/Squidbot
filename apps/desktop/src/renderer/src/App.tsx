import { useEffect, useState } from "react";
import { Activity, Bot, Boxes, CalendarClock, Database, FlaskConical, MessageCircle, MessageSquare, Settings, ShieldAlert, ShieldCheck, Sparkles, UserCog, UsersRound, Wand2 } from "lucide-react";
import { squidbotApi } from "./lib/api";
import { AffordancePage } from "./pages/AffordancePage";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { ChatPage } from "./pages/ChatPage";
import { IdentityPage } from "./pages/IdentityPage";
import { MemoryPage } from "./pages/MemoryPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { ProfilesPage } from "./pages/ProfilesPage";
import { RunListPage } from "./pages/RunListPage";
import { SandboxesPage } from "./pages/SandboxesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SkillsPage } from "./pages/SkillsPage";
import { TeamsPage } from "./pages/TeamsPage";
import { TrustPage } from "./pages/TrustPage";
import { JobsPage } from "./pages/JobsPage";
import { EvaluationLabPage } from "./pages/EvaluationLabPage";
import { MessagingPage } from "./pages/MessagingPage";
import { GovernancePage } from "./pages/GovernancePage";
import type { PageId, TraceDto } from "./types";
import type { SettingsDto } from "../../shared/api";

const pages: Array<{ id: PageId; label: string; icon: typeof MessageSquare }> = [
  { id: "onboarding", label: "Onboarding", icon: Wand2 },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "identity", label: "Identity", icon: Bot },
  { id: "trust", label: "Trust", icon: ShieldCheck },
  { id: "profiles", label: "Profiles", icon: UserCog },
  { id: "traces", label: "Runs", icon: Activity },
  { id: "memory", label: "Memory", icon: Database },
  { id: "gaps", label: "Gaps", icon: ShieldAlert },
  { id: "sandboxes", label: "Sandboxes", icon: Boxes },
  { id: "skills", label: "Skills", icon: Sparkles },
  { id: "jobs", label: "Jobs", icon: CalendarClock },
  { id: "teams", label: "Teams", icon: UsersRound },
  { id: "evals", label: "Evals", icon: FlaskConical },
  { id: "messaging", label: "Messaging", icon: MessageCircle },
  { id: "governance", label: "Governance", icon: ShieldCheck },
  { id: "approvals", label: "Approvals", icon: ShieldCheck },
  { id: "settings", label: "Settings", icon: Settings }
];

export function App() {
  const [activePage, setActivePage] = useState<PageId>("chat");
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [latestTrace, setLatestTrace] = useState<TraceDto | null>(null);
  const [traces, setTraces] = useState<TraceDto[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>();

  async function refreshSettings(): Promise<void> {
    const nextSettings = await squidbotApi.getSettings();
    setSettings(nextSettings);
  }

  async function refreshTrace(): Promise<void> {
    const trace = await squidbotApi.getLatestTrace();
    setLatestTrace(trace);
  }

  async function refreshTraces(): Promise<void> {
    const nextTraces = await squidbotApi.listTraces();
    setTraces(nextTraces);
    setLatestTrace((currentTrace) => {
      if (!currentTrace) {
        return nextTraces[0] ?? null;
      }

      return nextTraces.find((trace) => trace.id === currentTrace.id) ?? nextTraces[0] ?? null;
    });
  }

  function handleTraceChange(trace: TraceDto): void {
    setLatestTrace(trace);
    setTraces((currentTraces) => [trace, ...currentTraces.filter((item) => item.id !== trace.id)].slice(0, 20));
  }

  useEffect(() => {
    void refreshSettings();
    void refreshTraces();
  }, []);

  useEffect(() => {
    if (activePage === "traces") {
      void refreshTraces();
    }
  }, [activePage]);

  const renderPage = () => {
    if (!settings) {
      return <main className="page-panel skeleton-panel" />;
    }

    if (activePage === "chat") {
      return (
        <ChatPage
          sessionId={sessionId}
          settings={settings}
          onSessionChange={setSessionId}
          onTraceChange={handleTraceChange}
          onSettingsChange={setSettings}
        />
      );
    }

    if (activePage === "onboarding") {
      return <OnboardingPage />;
    }

    if (activePage === "identity") {
      return <IdentityPage />;
    }

    if (activePage === "trust") {
      return <TrustPage />;
    }

    if (activePage === "profiles") {
      return <ProfilesPage />;
    }

    if (activePage === "traces") {
      return <RunListPage />;
    }

    if (activePage === "memory") {
      return <MemoryPage />;
    }

    if (activePage === "gaps") {
      return <AffordancePage />;
    }

    if (activePage === "sandboxes") {
      return <SandboxesPage />;
    }

    if (activePage === "skills") {
      return <SkillsPage />;
    }

    if (activePage === "jobs") {
      return <JobsPage />;
    }

    if (activePage === "teams") {
      return <TeamsPage />;
    }

    if (activePage === "evals") {
      return <EvaluationLabPage />;
    }

    if (activePage === "messaging") {
      return <MessagingPage />;
    }

    if (activePage === "governance") {
      return <GovernancePage />;
    }

    if (activePage === "approvals") {
      return <ApprovalsPage />;
    }

    return <SettingsPage settings={settings} onSettingsChange={setSettings} onNavigate={setActivePage} />;
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">SB</div>
          <div>
            <h1>SquidBot</h1>
            <p>Local agent control plane</p>
          </div>
        </div>

        <nav className="nav-list" aria-label="Main navigation">
          {pages.map((page) => {
            const Icon = page.icon;
            return (
              <button
                className={`nav-item ${activePage === page.id ? "active" : ""}`}
                key={page.id}
                onClick={() => setActivePage(page.id)}
                type="button"
              >
                <Icon size={18} />
                <span>{page.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="status-stack">
          <div className="status-row">
            <span className="status-dot green" />
            <span>SQLite local</span>
          </div>
          <div className="status-row">
            <span className="status-dot amber" />
            <span>Sandbox staging</span>
          </div>
          <div className="status-row">
            <span className="status-dot green" />
            <span>Tests in sandbox</span>
          </div>
        </div>
      </aside>

      <section className="content-shell">{renderPage()}</section>
    </div>
  );
}
