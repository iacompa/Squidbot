import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { CheckCircle2, CircleSlash, MessageCircle, Send, ShieldCheck } from "lucide-react";
import { squidbotApi } from "../lib/api";
import type {
  MessagingAdapterDto,
  MessagingAllowlistRuleDto,
  MessagingChannelDto,
  MessagingDeliveryRuleDto,
  MessagingEventDto,
  PlatformMatrixEntryDto
} from "../types";

/**
 * Reusable messaging-config panel. Rendered standalone via `MessagingPage`,
 * and inside `IntegrationsPage`'s Messaging tab (Task 1.4 of the sidebar
 * reorg).
 *
 * Why a shared component? Both surfaces need the same adapter catalog,
 * channel controls, allowlist, delivery rules, and inbox. Pulling them out
 * of `MessagingPage` so the IntegrationsPage tab can reuse the markup
 * without duplication.
 *
 * Refresh affordance: the section exposes its `refresh()` via a
 * `MessagingSectionHandle` ref so the owning page can keep its Refresh
 * button in the `page-header` strip (the original visual location)
 * without the section having to know about the button's chrome. The
 * data-loading logic stays encapsulated here.
 */

export type MessagingSectionHandle = {
  refresh: () => Promise<void>;
};

function statusClass(status: string): string {
  if (status === "installed" || status === "active" || status === "supportedReal" || status === "low") {
    return "resolved";
  }
  if (status === "fixtureOnly" || status === "planned" || status === "disabled" || status === "medium") {
    return "medium";
  }
  return "high";
}

function formatTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "None";
}

export const MessagingSection = forwardRef<MessagingSectionHandle>((_props, ref) => {
  const [adapters, setAdapters] = useState<MessagingAdapterDto[]>([]);
  const [matrix, setMatrix] = useState<PlatformMatrixEntryDto[]>([]);
  const [channels, setChannels] = useState<MessagingChannelDto[]>([]);
  const [allowlist, setAllowlist] = useState<MessagingAllowlistRuleDto[]>([]);
  const [deliveryRules, setDeliveryRules] = useState<MessagingDeliveryRuleDto[]>([]);
  const [events, setEvents] = useState<MessagingEventDto[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState("slack");
  const [newChannel, setNewChannel] = useState({ platform: "slack", externalChannelId: "C_FIXTURE", displayName: "#fixture-approvals" });
  const [newUser, setNewUser] = useState({ platform: "slack", externalUserId: "U_FIXTURE", riskLimit: "medium" as const });
  const [localText, setLocalText] = useState("/squid help");
  const [error, setError] = useState<string | null>(null);

  const selectedMatrix = useMemo(() => matrix.find((entry) => entry.platform === selectedPlatform) ?? matrix[0] ?? null, [matrix, selectedPlatform]);

  async function refresh(): Promise<void> {
    setError(null);
    const [nextAdapters, nextMatrix, nextChannels, nextAllowlist, nextRules, nextEvents] = await Promise.all([
      squidbotApi.listMessagingAdapters(),
      squidbotApi.listMessagingMatrix(),
      squidbotApi.listMessagingChannels(),
      squidbotApi.listMessagingAllowlist(),
      squidbotApi.listMessagingDeliveryRules(),
      squidbotApi.listMessagingEvents({ limit: 40 })
    ]);
    setAdapters(nextAdapters);
    setMatrix(Array.isArray(nextMatrix) ? nextMatrix : nextMatrix ? [nextMatrix] : []);
    setChannels(nextChannels);
    setAllowlist(nextAllowlist);
    setDeliveryRules(nextRules);
    setEvents(nextEvents);
  }

  useEffect(() => {
    void refresh().catch((nextError: unknown) => setError(nextError instanceof Error ? nextError.message : "Unable to load Messaging."));
  }, []);

  // Expose `refresh` to the owning page so the Refresh button can live in
  // the page-header strip (its original location) while the data-loading
  // logic stays encapsulated here.
  useImperativeHandle(ref, () => ({ refresh }), []);

  async function addChannel(): Promise<void> {
    await squidbotApi.addMessagingChannel({
      platform: newChannel.platform,
      externalChannelId: newChannel.externalChannelId,
      displayName: newChannel.displayName
    });
    await refresh();
  }

  async function addAllowUser(): Promise<void> {
    await squidbotApi.addMessagingAllowlistRule({
      platform: newUser.platform,
      externalUserId: newUser.externalUserId,
      ruleType: "allowUser",
      riskLimit: newUser.riskLimit
    });
    await refresh();
  }

  async function addRunSummaryDelivery(channelId: string): Promise<void> {
    await squidbotApi.addMessagingDeliveryRule({
      name: "Run summaries",
      triggerType: "runSummary",
      targetChannelId: channelId
    });
    await refresh();
  }

  async function sendLocalMessage(): Promise<void> {
    await squidbotApi.sendLocalWebMessage(localText);
    await refresh();
  }

  return (
    <>
      {error ? <div className="error-strip">{error}</div> : null}

      <section className="metric-grid">
        <div className="metric-card">
          <span>Adapters</span>
          <strong>{adapters.length}</strong>
        </div>
        <div className="metric-card">
          <span>Channels</span>
          <strong>{channels.length}</strong>
        </div>
        <div className="metric-card">
          <span>Allowlist rules</span>
          <strong>{allowlist.length}</strong>
        </div>
        <div className="metric-card">
          <span>Events</span>
          <strong>{events.length}</strong>
        </div>
      </section>

      <section className="affordance-layout skills-layout">
        <div className="memory-section affordance-table-section">
          <div className="memory-section-heading">
            <h3>Adapter catalog</h3>
            <span>fixture-first</span>
          </div>
          <div className="affordance-table skill-table" role="table" aria-label="Messaging adapters">
            <div className="affordance-table-head" role="row">
              <span>Status</span>
              <span>Platform</span>
              <span>Transport</span>
              <span>Auth</span>
            </div>
            {adapters.slice(0, 14).map((adapter) => (
              <button className="affordance-row" key={adapter.id} role="row" type="button" onClick={() => setSelectedPlatform(adapter.platform)}>
                <span className={`severity-pill ${statusClass(adapter.status)}`}>{adapter.status}</span>
                <strong>{adapter.name}</strong>
                <span>{String((adapter.manifest.transport as Record<string, unknown> | undefined)?.mode ?? "fixture")}</span>
                <span>{String((adapter.manifest.auth as Record<string, unknown> | undefined)?.type ?? "none")}</span>
              </button>
            ))}
          </div>

          <div className="memory-section-heading">
            <h3>Platform matrix</h3>
            <span>{selectedMatrix?.platform ?? "none"}</span>
          </div>
          {selectedMatrix ? (
            <div className="affordance-detail">
              <div className="detail-kv">
                <span>Real mode</span>
                <strong className={`severity-pill ${statusClass(selectedMatrix.realAdapterStatus)}`}>{selectedMatrix.realAdapterStatus}</strong>
              </div>
              <div className="detail-kv">
                <span>Auth</span>
                <strong>{selectedMatrix.authType}</strong>
              </div>
              <div className="detail-kv">
                <span>Self-hosted</span>
                <strong>{selectedMatrix.selfHostedOption ? "yes" : "no"}</strong>
              </div>
              <div className="button-row">
                {Object.entries(selectedMatrix.capabilities)
                  .filter(([, enabled]) => enabled)
                  .slice(0, 8)
                  .map(([capability]) => (
                    <span className="severity-pill resolved" key={capability}>{capability}</span>
                  ))}
              </div>
              {selectedMatrix.complianceNotes.length > 0 ? (
                <section className="trace-artifact">
                  <h4>Compliance notes</h4>
                  <pre>{selectedMatrix.complianceNotes.join("\n")}</pre>
                </section>
              ) : null}
            </div>
          ) : null}
        </div>

        <aside className="memory-section affordance-detail-section skill-detail-section">
          <div className="memory-section-heading">
            <h3>Local web chat</h3>
            <span>zero-spend</span>
          </div>
          <div className="chat-input-row">
            <input value={localText} onChange={(event) => setLocalText(event.target.value)} aria-label="Local web chat message" />
            <button className="primary-button" type="button" onClick={() => void sendLocalMessage()}>
              <Send size={16} />
              <span>Send</span>
            </button>
          </div>

          <div className="memory-section-heading">
            <h3>Channels</h3>
            <span>{channels.length}</span>
          </div>
          <div className="chat-input-row">
            <input value={newChannel.platform} onChange={(event) => setNewChannel((current) => ({ ...current, platform: event.target.value }))} aria-label="Channel platform" />
            <input
              value={newChannel.externalChannelId}
              onChange={(event) => setNewChannel((current) => ({ ...current, externalChannelId: event.target.value }))}
              aria-label="External channel ID"
            />
            <button className="secondary-button" type="button" onClick={() => void addChannel()}>
              <MessageCircle size={15} />
              <span>Add</span>
            </button>
          </div>
          <div className="version-list">
            {channels.slice(0, 6).map((channel) => (
              <div className="version-row" key={channel.id}>
                <span>{channel.displayName ?? channel.externalChannelId}</span>
                <span className={`severity-pill ${statusClass(channel.status)}`}>{channel.platform}</span>
                <button className="secondary-button compact-button" type="button" onClick={() => void addRunSummaryDelivery(channel.id)}>
                  <CheckCircle2 size={14} />
                  <span>Summaries</span>
                </button>
              </div>
            ))}
          </div>

          <div className="memory-section-heading">
            <h3>Allowlist</h3>
            <span>deny by default</span>
          </div>
          <div className="chat-input-row">
            <input value={newUser.platform} onChange={(event) => setNewUser((current) => ({ ...current, platform: event.target.value }))} aria-label="Allowlist platform" />
            <input value={newUser.externalUserId} onChange={(event) => setNewUser((current) => ({ ...current, externalUserId: event.target.value }))} aria-label="Allowlist user" />
            <button className="secondary-button" type="button" onClick={() => void addAllowUser()}>
              <ShieldCheck size={15} />
              <span>Allow</span>
            </button>
          </div>
          <div className="version-list">
            {allowlist.slice(0, 5).map((rule) => (
              <div className="version-row" key={rule.id}>
                <span>{rule.externalUserId ?? rule.externalChannelId ?? "domain"}</span>
                <span>{rule.ruleType}</span>
                <span className={`severity-pill ${statusClass(rule.riskLimit)}`}>{rule.riskLimit}</span>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="affordance-layout skills-layout">
        <div className="memory-section">
          <div className="memory-section-heading">
            <h3>Delivery rules</h3>
            <span>{deliveryRules.length}</span>
          </div>
          <div className="version-list">
            {deliveryRules.length === 0 ? (
              <div className="empty-state compact">
                <h3>No delivery rules</h3>
                <p>Add a channel above, then attach run summaries or approvals to it.</p>
              </div>
            ) : (
              deliveryRules.map((rule) => (
                <div className="version-row" key={rule.id}>
                  <span>{rule.name}</span>
                  <span>{rule.triggerType}</span>
                  <span className={`severity-pill ${rule.enabled ? "resolved" : "medium"}`}>{rule.enabled ? "enabled" : "off"}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="memory-section">
          <div className="memory-section-heading">
            <h3>Inbox</h3>
            <span>redacted</span>
          </div>
          <div className="version-list">
            {events.slice(0, 10).map((event) => (
              <div className="version-row" key={event.id}>
                {event.direction === "inbound" ? <MessageCircle size={15} /> : <CircleSlash size={15} />}
                <span>{event.platform}</span>
                <span>{event.normalizedType}</span>
                <span>{event.bodyText ?? "(no text)"}</span>
                <span>{formatTime(event.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
});

MessagingSection.displayName = "MessagingSection";
