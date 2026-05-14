// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("OnboardingPage wizard", () => {
  it("walks the user through questions and shows a live preview after answering", async () => {
    const { OnboardingPage } = await import("./OnboardingPage");
    render(<OnboardingPage />);

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
    await waitFor(() => screen.getByText("In one sentence, what does your business do?"));

    fireEvent.click(screen.getByText("Next"));
    await waitFor(() => {
      expect(screen.getByText(/is required/i)).toBeTruthy();
    });
  });
});
