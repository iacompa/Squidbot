import { describe, expect, it } from "vitest";
import { resolveNav } from "./navRedirects";

describe("resolveNav — redirect map for deprecated PageIds", () => {
  it("passes through current PageIds unchanged", () => {
    expect(resolveNav("chat")).toEqual({ pageId: "chat" });
    expect(resolveNav("integrations")).toEqual({ pageId: "integrations" });
    expect(resolveNav("history")).toEqual({ pageId: "history" });
    expect(resolveNav("settings")).toEqual({ pageId: "settings" });
  });

  it("redirects traces → history with tab=activity", () => {
    expect(resolveNav("traces")).toEqual({ pageId: "history", tab: "activity" });
  });

  it("redirects memory → history with tab=memory", () => {
    expect(resolveNav("memory")).toEqual({ pageId: "history", tab: "memory" });
  });

  it("redirects config-y PageIds into Settings tabs", () => {
    expect(resolveNav("identity")).toEqual({ pageId: "settings", tab: "profile" });
    expect(resolveNav("profiles")).toEqual({ pageId: "settings", tab: "profile" });
    expect(resolveNav("skills")).toEqual({ pageId: "settings", tab: "skills" });
    expect(resolveNav("governance")).toEqual({ pageId: "settings", tab: "governance" });
  });

  it("redirects messaging → integrations with tab=messaging", () => {
    expect(resolveNav("messaging")).toEqual({ pageId: "integrations", tab: "messaging" });
  });
});
