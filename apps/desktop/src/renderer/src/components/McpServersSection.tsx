import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { squidbotApi } from "../lib/api";
import type { McpServerDto, McpServerInputDto } from "../../../shared/api";

const EMPTY_FORM: McpServerInputDto = {
  name: "",
  command: "npx",
  args: [],
  env: {},
  riskLevel: "medium",
  enabled: true
};

/**
 * Configured Model Context Protocol servers. Each row spawns a child
 * process on app start; tools that server exposes register in the agent's
 * ToolRegistry as `mcp.<name>.<tool>` and pick up the same sensitivity
 * policy / approval queue / trace plumbing as manifest connectors.
 *
 * Mounted below ConnectorsSection on the Integrations → Connectors tab.
 */
export function McpServersSection() {
  const [servers, setServers] = useState<McpServerDto[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<McpServerInputDto>(EMPTY_FORM);
  const [argsText, setArgsText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload(): Promise<void> {
    try {
      setServers(await squidbotApi.listMcpServers());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function saveServer(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const args = argsText.trim().split(/\s+/).filter(Boolean);
      await squidbotApi.addMcpServer({ ...form, args });
      setShowForm(false);
      setForm(EMPTY_FORM);
      setArgsText("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function removeServer(name: string): Promise<void> {
    if (!window.confirm(`Remove MCP server "${name}"?`)) return;
    try {
      await squidbotApi.removeMcpServer(name);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="mcp-servers" aria-label="MCP servers">
      <header className="mcp-servers__header">
        <div>
          <h3>MCP servers</h3>
          <p className="muted">
            MCP servers are programs that run on your machine with your user's
            permissions. Only add servers you trust.
          </p>
        </div>
        {!showForm && (
          <button type="button" className="primary-button" onClick={() => setShowForm(true)}>
            <Plus size={14} aria-hidden /> Add MCP server
          </button>
        )}
      </header>

      {error && <div className="mcp-servers__error">{error}</div>}

      {servers.length === 0 && !showForm ? (
        <div className="empty-state compact">
          <h4>No MCP servers configured</h4>
          <p>Add one to give the agent access to hundreds of community-built tools.</p>
        </div>
      ) : (
        <ul className="mcp-servers__list">
          {servers.map((server) => (
            <li key={server.id} className="mcp-server-row">
              <div className="mcp-server-row__main">
                <strong>{server.name}</strong>
                <span className="chip chip--risk">{server.riskLevel}</span>
                <span className="muted">{server.toolCount} tools</span>
                {server.lastError && <span className="chip chip--error">error</span>}
              </div>
              <div className="mcp-server-row__actions">
                <button
                  type="button"
                  className="ghost-button"
                  aria-label={`Remove ${server.name}`}
                  onClick={() => void removeServer(server.name)}
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showForm && (
        <form
          className="mcp-servers__form"
          onSubmit={(e) => {
            e.preventDefault();
            void saveServer();
          }}
        >
          <label>
            <span>Server name</span>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
              placeholder="e.g. filesystem-home"
              autoComplete="off"
              required
            />
          </label>
          <label>
            <span>Command</span>
            <input
              type="text"
              value={form.command}
              onChange={(e) => setForm((c) => ({ ...c, command: e.target.value }))}
              autoComplete="off"
              required
            />
          </label>
          <label>
            <span>Arguments</span>
            <input
              type="text"
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              placeholder="-y @modelcontextprotocol/server-filesystem /Users/me"
              autoComplete="off"
            />
          </label>
          <label>
            <span>Risk level</span>
            <select
              value={form.riskLevel}
              onChange={(e) =>
                setForm((c) => ({
                  ...c,
                  riskLevel: e.target.value as McpServerInputDto["riskLevel"]
                }))
              }
            >
              <option value="low">Low — read-only tools</option>
              <option value="medium">Medium — writes prompt on Sensitive profile</option>
              <option value="high">High — writes always prompt</option>
              <option value="critical">Critical — every call prompts</option>
            </select>
          </label>
          <div className="mcp-servers__form-actions">
            <button type="button" className="ghost-button" onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={saving}>
              <Save size={14} aria-hidden /> {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
