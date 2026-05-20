import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Boxes,
  CalendarClock,
  FlaskConical,
  MessageSquare,
  Plug,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sunrise,
  UsersRound
} from "lucide-react";
import { BurgerButton } from "./components/BurgerButton";
import { MobileNavBackdrop } from "./components/MobileNavBackdrop";
import { useBreakpoint } from "./hooks/useBreakpoint";
import { squidbotApi } from "./lib/api";
import { resolveNav } from "./lib/navRedirects";
import { GapsPage } from "./pages/GapsPage";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { BriefingPage } from "./pages/BriefingPage";
import { ChatPage } from "./pages/ChatPage";
import { EvaluationLabPage } from "./pages/EvaluationLabPage";
import { HistoryPage } from "./pages/HistoryPage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { JobsPage } from "./pages/JobsPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { SandboxesPage } from "./pages/SandboxesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TeamsPage } from "./pages/TeamsPage";
import { TrustPage } from "./pages/TrustPage";
import type { PageId, TraceDto } from "./types";
import type { SettingsDto } from "../../shared/api";

type NavItem = { id: PageId; label: string; icon: typeof MessageSquare };

const primaryPages: NavItem[] = [
  { id: "briefing", label: "Briefing", icon: Sunrise },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "approvals", label: "Approvals", icon: ShieldCheck },
  { id: "trust", label: "Trust", icon: ShieldCheck },
  { id: "history", label: "History", icon: Activity },
  { id: "settings", label: "Settings", icon: Settings }
];

const advancedPages: NavItem[] = [
  { id: "jobs", label: "Jobs", icon: CalendarClock },
  { id: "teams", label: "Teams", icon: UsersRound },
  { id: "evals", label: "Evals", icon: FlaskConical },
  { id: "sandboxes", label: "Sandboxes", icon: Boxes },
  { id: "gaps", label: "Gaps", icon: ShieldAlert }
];

const ADVANCED_OPEN_KEY = "sidebar.advancedOpen";

export function App() {
  const [activePage, setActivePage] = useState<PageId>("briefing");
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [, setLatestTrace] = useState<TraceDto | null>(null);
  const [, setTraces] = useState<TraceDto[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(ADVANCED_OPEN_KEY) === "true";
    } catch {
      return false;
    }
  });
  // Wired to listPendingApprovals — the sidebar badge reflects the live
  // pending count. Refresh fires on App mount and after every chat send
  // (a chat turn can produce a new sandbox approval via tool execution).
  const [pendingApprovalCount, setPendingApprovalCount] = useState<number>(0);
  // Tab hint forwarded from onNavigate redirects (e.g. onNavigate("memory")
  // → { pageId: "history", tab: "memory" } — the tab is stashed here so the
  // destination page gets it as `initialTab`).
  const [pendingTab, setPendingTab] = useState<string | null>(null);

  // Mobile drawer state — sidebar slides off-canvas below --bp-mobile and
  // toggles back in via the burger button. The .nav-open class on the
  // outer .app-shell drives the CSS transform (see app.css).
  const [isMobileNavOpen, setMobileNavOpen] = useState(false);
  const breakpoint = useBreakpoint();
  const burgerRef = useRef<HTMLButtonElement | null>(null);

  // Auto-close drawer when window grows past mobile — otherwise the user
  // ends up in a "drawer-open on desktop" state that has no visual cue.
  useEffect(() => {
    if (breakpoint !== "mobile" && isMobileNavOpen) {
      setMobileNavOpen(false);
    }
  }, [breakpoint, isMobileNavOpen]);

  // Close drawer on Escape — matches the established a11y idiom for
  // dismissible overlays.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape" && isMobileNavOpen) setMobileNavOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isMobileNavOpen]);

  // Restore focus to the burger button when the drawer closes (WCAG 2.4.3).
  // Tracking the prior open state in a ref means we only fire on the
  // open→closed edge, not on the initial mount.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (wasOpenRef.current && !isMobileNavOpen) {
      burgerRef.current?.focus();
    }
    wasOpenRef.current = isMobileNavOpen;
  }, [isMobileNavOpen]);

  // Body scroll lock when drawer is open — prevents the page-behind from
  // scrolling. CSS rule (body.no-scroll { overflow: hidden }) lives in app.css.
  useEffect(() => {
    if (isMobileNavOpen) {
      document.body.classList.add("no-scroll");
      return () => document.body.classList.remove("no-scroll");
    }
  }, [isMobileNavOpen]);

  async function refreshSettings(): Promise<void> {
    const nextSettings = await squidbotApi.getSettings();
    setSettings(nextSettings);
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

  const refreshPendingApprovalCount = useCallback(async () => {
    try {
      const list = await squidbotApi.listPendingApprovals();
      setPendingApprovalCount(list.length);
    } catch {
      // Non-fatal — keep last known value.
    }
  }, []);

  function handleTraceChange(trace: TraceDto): void {
    setLatestTrace(trace);
    setTraces((currentTraces) => [trace, ...currentTraces.filter((item) => item.id !== trace.id)].slice(0, 20));
    // A chat turn may have produced a sandbox that needs approval — refresh
    // the badge count so the sidebar surfaces it immediately.
    void refreshPendingApprovalCount();
  }

  function handleNavigate(pageId: PageId, payload?: { tab?: string }): void {
    // Route change always dismisses the mobile drawer — the user has
    // selected their destination, so the drawer's job is done.
    setMobileNavOpen(false);
    const resolved = resolveNav(pageId);
    setActivePage(resolved.pageId);
    const tab = payload?.tab ?? resolved.tab ?? null;
    setPendingTab(tab);
  }

  function toggleAdvanced(): void {
    setAdvancedOpen((open) => {
      const next = !open;
      try {
        window.localStorage.setItem(ADVANCED_OPEN_KEY, String(next));
      } catch {
        // localStorage may be unavailable (e.g. in tests with a stubbed
        // window); silently fall back to in-memory state only.
      }
      return next;
    });
  }

  useEffect(() => {
    void refreshSettings();
    void refreshTraces();
  }, []);

  useEffect(() => {
    void refreshPendingApprovalCount();
  }, [refreshPendingApprovalCount]);

  // Refresh the trace list when navigating to History so the Activity tab
  // reflects newly-recorded runs without a page reload.
  useEffect(() => {
    if (activePage === "history") {
      void refreshTraces();
    }
  }, [activePage]);

  const renderPage = () => {
    if (!settings) {
      return <main className="page-panel skeleton-panel" />;
    }

    if (activePage === "briefing") {
      return <BriefingPage onNavigate={handleNavigate} />;
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

    if (activePage === "integrations") {
      return (
        <IntegrationsPage
          initialTab={pendingTab as "models" | "connectors" | "messaging" | undefined}
        />
      );
    }

    if (activePage === "history") {
      return (
        <HistoryPage initialTab={pendingTab as "activity" | "memory" | undefined} />
      );
    }

    if (activePage === "approvals") {
      return <ApprovalsPage />;
    }

    if (activePage === "trust") {
      return <TrustPage />;
    }

    if (activePage === "onboarding") {
      return <OnboardingPage onNavigate={handleNavigate} />;
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

    if (activePage === "sandboxes") {
      return <SandboxesPage />;
    }

    if (activePage === "gaps") {
      return <GapsPage />;
    }

    return (
      <SettingsPage
        settings={settings}
        onSettingsChange={setSettings}
        onNavigate={handleNavigate}
        initialTab={pendingTab as "general" | "profile" | "skills" | "governance" | undefined}
      />
    );
  };

  return (
    <div
      className={`app-shell${isMobileNavOpen ? " nav-open" : ""}`}
      data-bp={breakpoint}
    >
      <BurgerButton
        ref={burgerRef}
        onClick={() => setMobileNavOpen((v) => !v)}
        expanded={isMobileNavOpen}
      />
      <aside
        className="sidebar"
        inert={breakpoint === "mobile" && !isMobileNavOpen ? true : undefined}
      >
        <div className="brand-block">
          <div className="brand-mark">SB</div>
          <div>
            <h1>SquidBot</h1>
            <p>Local agent control plane</p>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary">
          {primaryPages.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${isActive ? "active" : ""}`}
                onClick={() => handleNavigate(item.id)}
              >
                <Icon size={18} aria-hidden />
                <span>{item.label}</span>
                {item.id === "approvals" && pendingApprovalCount > 0 && (
                  <span
                    className="nav-badge"
                    aria-label={`${pendingApprovalCount} pending`}
                  >
                    {pendingApprovalCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          className="sidebar-section-toggle"
          aria-expanded={advancedOpen}
          onClick={toggleAdvanced}
        >
          Advanced {advancedOpen ? "▾" : "▸"}
        </button>

        {advancedOpen && (
          <nav className="nav-list nav-list--advanced" aria-label="Advanced">
            {advancedPages.map((item) => {
              const Icon = item.icon;
              const isActive = activePage === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`nav-item ${isActive ? "active" : ""}`}
                  onClick={() => handleNavigate(item.id)}
                >
                  <Icon size={15} aria-hidden />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        )}

        <div className="status-stack">
          <div className="status-row">
            <span className="status-dot green" />
            <span>SQLite local</span>
          </div>
          <div className="status-row">
            <span className="status-dot amber" />
            <span>Draft writes</span>
          </div>
          <div className="status-row">
            <span className="status-dot coral" />
            <span>Dry-run terminal</span>
          </div>
        </div>
      </aside>

      <section className="content-shell">{renderPage()}</section>

      <MobileNavBackdrop
        visible={isMobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />
    </div>
  );
}
