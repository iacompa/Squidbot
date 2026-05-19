// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileNavBackdrop } from "./MobileNavBackdrop";

afterEach(cleanup);

describe("MobileNavBackdrop", () => {
  it("renders backdrop element without .open class when not visible", () => {
    const { container } = render(<MobileNavBackdrop visible={false} onClose={() => {}} />);
    const el = container.querySelector(".mobile-nav-backdrop");
    expect(el).not.toBeNull();
    expect(el!.classList.contains("open")).toBe(false);
  });

  it("renders backdrop with .open class when visible", () => {
    const { container } = render(<MobileNavBackdrop visible={true} onClose={() => {}} />);
    const el = container.querySelector(".mobile-nav-backdrop");
    expect(el).not.toBeNull();
    expect(el!.classList.contains("open")).toBe(true);
  });

  it("calls onClose when tapped while visible", () => {
    const fn = vi.fn();
    const { container } = render(<MobileNavBackdrop visible={true} onClose={fn} />);
    fireEvent.click(container.querySelector(".mobile-nav-backdrop")!);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onClose when tapped while hidden", () => {
    const fn = vi.fn();
    const { container } = render(<MobileNavBackdrop visible={false} onClose={fn} />);
    fireEvent.click(container.querySelector(".mobile-nav-backdrop")!);
    expect(fn).not.toHaveBeenCalled();
  });

  it("has aria-hidden true (decorative)", () => {
    const { container } = render(<MobileNavBackdrop visible={true} onClose={() => {}} />);
    expect(container.querySelector(".mobile-nav-backdrop")!.getAttribute("aria-hidden")).toBe("true");
  });
});
