import type { SquidDatabase } from "@squidbot/db";
import {
  activateModelAccount,
  getActiveModelAccount,
  listModelAccounts,
  redactAccount
} from "./modelAccounts.js";
import type { ToolContext, ToolRegistry } from "./toolRegistry.js";
import type { JsonObject } from "./types.js";

/**
 * Agent-facing tools that let SquidBot manage which model account is in use,
 * directly from chat. Two tools:
 *
 *   • `model.listAccounts` — read-only. Returns every saved account (with
 *     api keys redacted) and which one is currently active. The agent uses
 *     this to confirm what's available BEFORE calling useAccount, so the
 *     model can answer "what models do you have access to?" honestly.
 *
 *   • `model.useAccount` — switches the active account. Audited. Only
 *     accepts a name that already exists. The runtime refreshes its
 *     ModelRouter on the next chat turn so subsequent messages route
 *     through the newly-selected account.
 *
 * Crucial constraint: these tools never let the agent CREATE a new account.
 * The user has to pre-configure accounts (via Settings or CLI) — chat can
 * only switch among them. That keeps API keys out of the LLM's reach.
 */
export function registerModelAccountTools(registry: ToolRegistry, database: SquidDatabase): void {
  registry.register({
    name: "model.listAccounts",
    description:
      "List every pre-configured model account (OpenRouter, OpenAI, Ollama, ...) the operator has saved, and report which one is currently active. Use this when the user asks what models / providers are available, or to confirm the right name BEFORE calling model.useAccount.",
    inputSchema: {
      type: "object",
      properties: {}
    },
    permissionScopes: ["model.read"],
    riskLevel: "low",
    metadata: {
      readOnly: true
    },
    handler: (_args: JsonObject, _context: ToolContext) => {
      const accounts = listModelAccounts(database);
      return {
        active: getActiveModelAccount(database)?.name ?? null,
        accounts: accounts.map((account) => redactAccount(account))
      };
    }
  });

  registry.register({
    name: "model.useAccount",
    description:
      "Switch SquidBot's active model account to the one named in the input. Call this tool ONLY when the user explicitly asks to change which LLM / model / provider / account is in use — for example: 'switch to my OR Llama account', 'use gpt-4o-mini instead', 'route through OpenRouter', 'change the model to Gemini'. Do NOT call this tool for unrelated requests, even if the user mentions a model or account name in passing. If the user names an account you don't recognise, call model.listAccounts first to confirm available names. Note: this is different from enterprise *profiles* (industry settings like law firm / dealership) — those have their own commands.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: {
          type: "string",
          description: "The name of the saved model account to activate."
        }
      }
    },
    permissionScopes: ["model.switch"],
    riskLevel: "medium",
    handler: (args: JsonObject, context: ToolContext) => {
      const requested = typeof args.name === "string" ? args.name.trim() : "";
      if (!requested) {
        throw new Error("model.useAccount requires a `name` argument naming the account to activate.");
      }

      const previous = getActiveModelAccount(database);
      const activated = activateModelAccount(database, requested);

      // Emit an event so the audit trail shows exactly which account was
      // chosen, by whom (the agent), and what it replaced. The runtime
      // picks `model.fallback` up too — same event type the router uses
      // when it falls back between providers — so the trace viewer
      // already renders it.
      context.emitEvent?.("model.fallback", {
        fromProvider: previous?.name ?? "(none)",
        toProvider: activated.name,
        reason: "Agent invoked model.useAccount",
        callKind: "chat",
        providerKind: activated.providerKind,
        apiModel: activated.apiModel,
        activatedAccountId: activated.id
      });

      const redacted = redactAccount(activated);
      return {
        switched: true,
        previousAccount: previous?.name ?? null,
        activeAccount: redacted,
        note:
          "The active account has been switched. Subsequent user messages will route through this account."
      };
    }
  });
}
