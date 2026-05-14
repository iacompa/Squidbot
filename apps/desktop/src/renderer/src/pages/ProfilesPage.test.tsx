// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const activateMock = vi.fn(async () => ({}));

beforeEach(() => {
  vi.resetModules();
  activateMock.mockClear();
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: {
      listEnterpriseProfiles: vi.fn(async () => [
        {
          id: "profile_seed_generic_business",
          industry: "general_business",
          displayName: "Generic Business",
          businessUnit: null,
          role: "operator",
          primarySystems: [],
          primaryChannels: [],
          sensitivity: "standard",
          vocabulary: {},
          branding: {},
          policyPacks: ["developer-safe-default"],
          defaultSkills: [],
          defaultConnectors: [],
          readOnlyByDefault: false,
          isActive: true,
          seeded: true,
          metadata: {},
          createdAt: "now",
          updatedAt: "now"
        },
        {
          id: "profile_seed_law_firm",
          industry: "legal",
          displayName: "Law Firm",
          businessUnit: null,
          role: "attorney",
          primarySystems: ["clio"],
          primaryChannels: ["email"],
          sensitivity: "regulated",
          vocabulary: { project: "matter" },
          branding: {},
          policyPacks: ["legal-review"],
          defaultSkills: ["contract-clause-extraction"],
          defaultConnectors: [],
          readOnlyByDefault: true,
          isActive: false,
          seeded: true,
          metadata: {},
          createdAt: "now",
          updatedAt: "now"
        }
      ]),
      activateEnterpriseProfile: activateMock,
      createEnterpriseProfile: vi.fn()
    }
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, "squidbot");
});

describe("ProfilesPage", () => {
  it("lists profiles, marks the active one, and offers Activate on inactive ones", async () => {
    const { ProfilesPage } = await import("./ProfilesPage");
    render(<ProfilesPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Generic Business").length).toBeGreaterThan(0);
    });
    expect(screen.getByText("Law Firm")).toBeTruthy();
    // Active marker rendered for Generic Business
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    // Activate button visible for Law Firm
    const activateButtons = screen.getAllByText("Activate");
    expect(activateButtons.length).toBeGreaterThan(0);

    fireEvent.click(activateButtons[0]);
    await waitFor(() => {
      expect(activateMock).toHaveBeenCalledWith("profile_seed_law_firm");
    });
  });

  it("toggles the create-profile form when 'New profile' is clicked", async () => {
    const { ProfilesPage } = await import("./ProfilesPage");
    render(<ProfilesPage />);
    // "Generic Business" appears twice (once in the page subtitle, once as the
    // active profile card name), so we just wait for any occurrence.
    await waitFor(() => expect(screen.getAllByText("Generic Business").length).toBeGreaterThan(0));

    // "New profile" is both the toggle button label and the form region
    // aria-label, so getAllByText returns more than one; click the first
    // (the button).
    fireEvent.click(screen.getAllByText("New profile")[0]);
    expect(screen.getByLabelText("Profile display name")).toBeTruthy();
    expect(screen.getByLabelText("Data sensitivity")).toBeTruthy();
  });
});
