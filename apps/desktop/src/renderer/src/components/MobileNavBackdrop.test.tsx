// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileNavBackdrop } from "./MobileNavBackdrop";

afterEach(cleanup);

describe("MobileNavBackdrop", () => {
  it("renders nothing when not visible", () => {
    const { container } = render(<MobileNavBackdrop visible={false} onClose={() => {}} />);
    expect(container.querySelector(".mobile-nav-backdrop")).toBeNull();
  });

  it("renders backdrop element when visible", () => {
    const { container } = render(<MobileNavBackdrop visible={true} onClose={() => {}} />);
    expect(container.querySelector(".mobile-nav-backdrop")).not.toBeNull();
  });

  it("calls onClose when tapped", () => {
    const fn = vi.fn();
    const { container } = render(<MobileNavBackdrop visible={true} onClose={fn} />);
    fireEvent.click(container.querySelector(".mobile-nav-backdrop")!);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("has aria-hidden true (decorative)", () => {
    const { container } = render(<MobileNavBackdrop visible={true} onClose={() => {}} />);
    expect(container.querySelector(".mobile-nav-backdrop")!.getAttribute("aria-hidden")).toBe("true");
  });
});
