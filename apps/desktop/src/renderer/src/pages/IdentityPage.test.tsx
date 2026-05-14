// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: {
      getIdentityReport: vi.fn(async () => ({
        card: {
          id: "singleton",
          agentName: "SquidBot",
          agentVersion: "0.1.0",
          mission: "Be the auditable, self-hosted AI agent operating system.",
          installedAt: "2026-05-14T00:00:00.000Z",
          updatedAt: "2026-05-14T00:00:00.000Z"
        },
        profile: {
          id: "profile_seed_generic_business",
          industry: "general_business",
          displayName: "Generic Business",
          businessUnit: null,
          role: "operator",
          primarySystems: [],
          primaryChannels: [],
          sensitivity: "standard",
          vocabulary: {},
          branding: { productName: "SquidBot" },
          policyPacks: ["developer-safe-default", "secrets-redaction"],
          defaultSkills: [],
          defaultConnectors: [],
          readOnlyByDefault: false,
          isActive: true,
          seeded: true,
          metadata: {},
          createdAt: "2026-05-14T00:00:00.000Z",
          updatedAt: "2026-05-14T00:00:00.000Z"
        },
        capabilities: {
          toolCount: 2,
          tools: [
            { name: "workspace.listFiles", riskLevel: "low", permissionScopes: ["filesystem.read"] },
            { name: "workspace.proposePatch", riskLevel: "medium", permissionScopes: ["filesystem.write:draft"] }
          ],
          permissionScopes: ["filesystem.read", "filesystem.write:draft"]
        }
      })),
      listSquidbotCommands: vi.fn(async () => [
        { id: "whoami", label: "whoami", description: "Identity", displayCommand: "npm run whoami", outputIsMarkdown: false }
      ]),
      runSquidbotCommand: vi.fn()
    }
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, "squidbot");
});

describe("IdentityPage", () => {
  it("renders the SquidBot identity card and active profile", async () => {
    const { IdentityPage } = await import("./IdentityPage");
    render(<IdentityPage />);

    await waitFor(() => {
      expect(screen.getByText("SquidBot")).toBeTruthy();
    });
    expect(screen.getByText(/auditable, self-hosted AI agent/)).toBeTruthy();
    expect(screen.getByText("Generic Business")).toBeTruthy();
    expect(screen.getByText("general_business")).toBeTruthy();
    // Permission scope chips
    expect(screen.getByText("filesystem.read")).toBeTruthy();
    expect(screen.getByText("filesystem.write:draft")).toBeTruthy();
    // The same-thing-from-terminal block — `npm run whoami` appears in both
    // a TerminalSnippet (as <code>) and the TerminalRunner hint, so we expect
    // at least one match rather than exactly one.
    expect(screen.getAllByText("npm run whoami").length).toBeGreaterThan(0);
  });
});
