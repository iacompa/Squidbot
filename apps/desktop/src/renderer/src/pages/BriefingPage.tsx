import { useEffect, useState } from "react";
import { ArrowRight, Inbox, CalendarDays, ClipboardCheck, PlayCircle, MessageSquare } from "lucide-react";
import { squidbotApi } from "../lib/api";
import type { PageId } from "../types";

type BriefingPageProps = {
  onNavigate: (pageId: PageId) => void;
};

/**
 * The default landing page — frames SquidBot as the user's AI CEO.
 * Three columns: what was handled overnight, what needs the founder's
 * attention, what's planned for today. Plus a strip of running jobs
 * and quick action buttons.
 *
 * Phase 1 ships the layout + the two real counters that come from
 * existing IPCs (pending approvals, running jobs). Phase 2 wires the
 * email/calendar/financial data into the other slots.
 */
export function BriefingPage({ onNavigate }: BriefingPageProps) {
  const [approvalsCount, setApprovalsCount] = useState<number | null>(null);
  const [jobsCount, setJobsCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      squidbotApi.listPendingApprovals().catch(() => []),
      squidbotApi.listJobs({ status: "active" }).catch(() => ({ items: [], total: 0 }))
    ]).then(([approvals, jobs]) => {
      if (cancelled) return;
      setApprovalsCount(approvals.length);
      const items = Array.isArray(jobs) ? jobs : jobs.items;
      setJobsCount(items.length);
    });
    return () => { cancelled = true; };
  }, []);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric"
  });

  return (
    <main className="page-panel briefing-page" aria-label="Briefing">
      <header className="page-header briefing-header">
        <p className="section-label">Today, {today}</p>
        <h2>Good morning. Here's what's on your plate.</h2>
        <p className="page-subtitle">
          A snapshot of last night's activity, items waiting for your sign-off, and the day ahead.
        </p>
      </header>

      <div className="briefing-grid">
        <section className="briefing-card">
          <h3><Inbox size={16} aria-hidden /> Overnight</h3>
          <ul className="briefing-list">
            <li><strong>—</strong> emails triaged</li>
            <li><strong>—</strong> drafts ready</li>
            <li><strong>—</strong> auto-replies sent</li>
          </ul>
          <button className="ghost-button" onClick={() => onNavigate("messaging" as PageId)}>
            Open inbox <ArrowRight size={14} aria-hidden />
          </button>
        </section>

        <section className="briefing-card">
          <h3><ClipboardCheck size={16} aria-hidden /> Needs you</h3>
          <ul className="briefing-list">
            <li>
              <strong>{approvalsCount ?? "—"}</strong> approvals pending
            </li>
          </ul>
          <button className="ghost-button" onClick={() => onNavigate("approvals" as PageId)}>
            Open approvals <ArrowRight size={14} aria-hidden />
          </button>
        </section>

        <section className="briefing-card">
          <h3><CalendarDays size={16} aria-hidden /> Today's plan</h3>
          <ul className="briefing-list">
            <li><strong>—</strong> meetings scheduled</li>
            <li><strong>—</strong> tasks queued</li>
          </ul>
          <button className="ghost-button" onClick={() => onNavigate("jobs" as PageId)}>
            Open jobs <ArrowRight size={14} aria-hidden />
          </button>
        </section>
      </div>

      <section className="briefing-jobs">
        <h3><PlayCircle size={16} aria-hidden /> Running jobs ({jobsCount ?? "—"})</h3>
        <p className="muted">
          Scheduled tasks your AI CEO is running on a cadence. Open Jobs to see details.
        </p>
        <button className="secondary-button" onClick={() => onNavigate("jobs" as PageId)}>
          Open jobs
        </button>
      </section>

      <section className="briefing-actions">
        <button className="primary-button" onClick={() => onNavigate("chat" as PageId)}>
          <MessageSquare size={14} aria-hidden /> Open chat
        </button>
        <button className="ghost-button" onClick={() => onNavigate("history" as PageId)}>
          View audit log
        </button>
      </section>
    </main>
  );
}
