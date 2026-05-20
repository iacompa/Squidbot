// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const inferMock = vi.fn();
const commitMock = vi.fn();

beforeEach(() => {
  vi.resetModules();
  inferMock.mockReset();
  commitMock.mockReset();

  inferMock.mockResolvedValue({
    profile: {
      industry: "saas",
      displayName: "Acme",
      businessUnit: null,
      role: null,
      primarySystems: [],
      primaryChannels: [],
      sensitivity: "standard",
      vocabulary: { project: "feature" },
      branding: { productName: "SquidBot for Acme" },
      policyPacks: ["developer-safe-default", "secrets-redaction"],
      defaultSkills: [],
      defaultConnectors: [],
      readOnlyByDefault: false,
      metadata: {}
    },
    memories: [
      {
        type: "business_summary",
        title: "Business summary — Acme",
        body: "Acme is a small SaaS.",
        importance: 0.8,
        confidence: 0.95
      }
    ],
    rationale: ["Inferred industry: saas."],
    nextActions: ["npm run whoami    # confirm the new profile is active"]
  });

  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: {
      getOnboardingQuestions: vi.fn(async () => [
        {
          id: "business_summary",
          prompt: "In one sentence, what does your business do?",
          hint: "Helps me figure out your industry.",
          kind: "text",
          required: true
        },
        {
          id: "sensitivity",
          prompt: "How sensitive is the data you work with?",
          hint: "Hardens defaults automatically.",
          kind: "choice",
          required: true,
          choices: [
            { value: "standard", label: "Standard" },
            { value: "regulated", label: "Regulated" }
          ]
        }
      ]),
      inferOnboarding: inferMock,
      commitOnboarding: commitMock,
      // Step 0 (Connect a model) reads these on mount. We default to "no
      // accounts saved" so the existing tests need to click through the
      // skip-style "Continue without a model" button to reach the question
      // wizard — that mirrors the real new-user flow.
      listModelAccounts: vi.fn(async () => ({ activeAccountName: null, accounts: [] })),
      getProviderPresets: vi.fn(async () => [
        {
          providerKind: "openrouter",
          label: "OpenRouter",
          defaultApiUrl: "https://openrouter.ai/api/v1/chat/completions",
          defaultModel: "anthropic/claude-opus-4-5",
          notes: "BYOK gateway.",
          catalog: [{ id: "anthropic/claude-opus-4-5", label: "Claude Opus 4.5", tier: "flagship" }]
        }
      ]),
      upsertModelAccount: vi.fn(async (input) => ({
        id: "id_test",
        ...input,
        apiKeyConfigured: Boolean(input.apiKey),
        isActive: true,
        costPerToken: 0,
        dailyBudgetTokens: null,
        description: null,
        createdAt: "now",
        updatedAt: "now"
      })),
      activateModelAccount: vi.fn(),
      deleteModelAccount: vi.fn(),
      discoverModels: vi.fn(async () => ({ success: false, code: "not_found", message: "mock", fallback: { providerKind: "openrouter", catalog: [] } })),
      listSquidbotCommands: vi.fn(async () => [
        { id: "whoami", label: "whoami", description: "Identity", displayCommand: "npm run whoami", outputIsMarkdown: false }
      ]),
      runSquidbotCommand: vi.fn()
    }
  });
});

afterEach(() => {
  // Without explicit cleanup the rendered DOM persists across tests, so the
  // second time we look for the SquidBot intro bubble we find three of them
  // (one per prior render) and getByText throws "found multiple elements".
  // SettingsPage has the same setup — keep them consistent.
  cleanup();
  Reflect.deleteProperty(window, "squidbot");
});

/**
 * Helper to skip the new Step 0 (Connect a model). The existing wizard tests
 * don't care about model setup — they want to exercise the question flow —
 * so we click the "Continue without a model" CTA and proceed.
 */
async function skipModelStep(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByText(/Hi, I'm SquidBot/i)).toBeTruthy();
  });
  // With zero accounts, the CTA reads "Continue without a model".
  fireEvent.click(screen.getByRole("button", { name: /continue without a model/i }));
}

describe("OnboardingPage Step 0 — Connect a model (chat intro)", () => {
  it("introduces SquidBot in a chat bubble and exposes the model picker", async () => {
    const { OnboardingPage } = await import("./OnboardingPage");
    render(<OnboardingPage />);
    await waitFor(() => {
      expect(screen.getByText(/Hi, I'm SquidBot/i)).toBeTruthy();
    });
    // The page subtitle now reflects the model-first flow.
    expect(screen.getByText(/First, connect SquidBot to an AI model/i)).toBeTruthy();
    // The empty-state inside the model-accounts panel tells the user why they
    // need an account, not just *that* they need one.
    expect(screen.getByText("No model accounts yet")).toBeTruthy();
    // The Continue CTA is labelled to make the no-key path explicit.
    expect(screen.getByRole("button", { name: /continue without a model/i })).toBeTruthy();
  });

  it("advances to question 1 when the user clicks Continue without a model", async () => {
    const { OnboardingPage } = await import("./OnboardingPage");
    render(<OnboardingPage />);
    await skipModelStep();
    await waitFor(() => {
      expect(screen.getByText("In one sentence, what does your business do?")).toBeTruthy();
    });
  });
});

describe("OnboardingPage wizard", () => {
  it("walks the user through questions and shows a live preview after answering", async () => {
    const { OnboardingPage } = await import("./OnboardingPage");
    render(<OnboardingPage />);
    await skipModelStep();

    // Q1 visible after the question catalog loads
    await waitFor(() => {
      expect(screen.getByText("In one sentence, what does your business do?")).toBeTruthy();
    });

    // Answer Q1
    const textbox = screen.getByLabelText("In one sentence, what does your business do?");
    fireEvent.change(textbox, { target: { value: "Acme is a small SaaS." } });
    fireEvent.click(screen.getByText("Next"));

    // Inference call triggered, preview reflects industry
    await waitFor(() => {
      expect(inferMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      // The live preview panel renders the inferred industry on the right side.
      expect(screen.getByText("saas")).toBeTruthy();
    });

    // Q2 — choice question — pick "Standard"
    expect(screen.getByText("How sensitive is the data you work with?")).toBeTruthy();
    fireEvent.click(screen.getByText("Standard"));
    fireEvent.click(screen.getByText("Next"));

    // We should now be on the confirm step
    await waitFor(() => {
      expect(screen.getByText("Ready to save")).toBeTruthy();
    });
  });

  it("requires an answer to required questions", async () => {
    const { OnboardingPage } = await import("./OnboardingPage");
    render(<OnboardingPage />);
    await skipModelStep();
    await waitFor(() => screen.getByText("In one sentence, what does your business do?"));

    fireEvent.click(screen.getByText("Next"));
    await waitFor(() => {
      expect(screen.getByText(/is required/i)).toBeTruthy();
    });
  });
});

describe("OnboardingPage success screen", () => {
  it("shows an 'Open Briefing' button on the success screen that calls onNavigate('briefing')", async () => {
    // Stub commitOnboarding so the wizard transitions into the committed
    // success state. The shape mirrors the real IPC contract — see
    // CommittedOnboardingDto in shared/api.ts.
    commitMock.mockResolvedValue({
      inference: {
        profile: {
          industry: "saas",
          displayName: "Acme",
          businessUnit: null,
          role: null,
          primarySystems: [],
          primaryChannels: [],
          sensitivity: "standard",
          vocabulary: { project: "feature" },
          branding: { productName: "SquidBot for Acme" },
          policyPacks: ["developer-safe-default", "secrets-redaction"],
          defaultSkills: [],
          defaultConnectors: [],
          readOnlyByDefault: false,
          metadata: {}
        },
        memories: [],
        rationale: ["Inferred industry: saas."],
        nextActions: []
      },
      committed: {
        profile: {
          id: "profile_acme",
          industry: "saas",
          displayName: "Acme",
          businessUnit: null,
          role: null,
          primarySystems: [],
          primaryChannels: [],
          sensitivity: "standard",
          vocabulary: {},
          branding: { productName: "SquidBot for Acme" },
          policyPacks: [],
          defaultSkills: [],
          defaultConnectors: [],
          readOnlyByDefault: false,
          isActive: true,
          seeded: false,
          metadata: {},
          createdAt: "now",
          updatedAt: "now"
        },
        memories: [],
        syntheticRunId: "run_test"
      }
    });

    const navigate = vi.fn();
    const { OnboardingPage } = await import("./OnboardingPage");
    render(<OnboardingPage onNavigate={navigate} />);

    await skipModelStep();
    await waitFor(() => screen.getByText("In one sentence, what does your business do?"));

    // Q1
    fireEvent.change(
      screen.getByLabelText("In one sentence, what does your business do?"),
      { target: { value: "Acme is a small SaaS." } }
    );
    fireEvent.click(screen.getByText("Next"));

    // Q2 — pick a choice, then Next to reach the Confirm step.
    await waitFor(() => screen.getByText("How sensitive is the data you work with?"));
    fireEvent.click(screen.getByText("Standard"));
    fireEvent.click(screen.getByText("Next"));

    // Confirm step — click Save & finish to invoke commitOnboarding.
    await waitFor(() => screen.getByText("Ready to save"));
    fireEvent.click(screen.getByText("Save & finish"));

    // After commit resolves the success screen renders.
    await waitFor(() => {
      expect(screen.getByText(/Onboarding complete/i)).toBeTruthy();
    });

    const openBriefing = screen.getByRole("button", { name: /open briefing/i });
    fireEvent.click(openBriefing);
    expect(navigate).toHaveBeenCalledWith("briefing");
  });
});
