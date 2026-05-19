// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BurgerButton } from "./BurgerButton";

afterEach(cleanup);

describe("BurgerButton", () => {
  it("calls onClick when tapped", () => {
    const fn = vi.fn();
    const { getByRole } = render(<BurgerButton onClick={fn} expanded={false} />);
    fireEvent.click(getByRole("button"));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("renders with aria-label 'Open navigation' when collapsed", () => {
    const { getByRole } = render(<BurgerButton onClick={() => {}} expanded={false} />);
    expect(getByRole("button").getAttribute("aria-label")).toBe("Open navigation");
  });

  it("renders with aria-label 'Close navigation' when expanded", () => {
    const { getByRole } = render(<BurgerButton onClick={() => {}} expanded={true} />);
    expect(getByRole("button").getAttribute("aria-label")).toBe("Close navigation");
  });

  it("renders with aria-expanded matching prop", () => {
    const { getByRole, rerender } = render(<BurgerButton onClick={() => {}} expanded={false} />);
    expect(getByRole("button").getAttribute("aria-expanded")).toBe("false");
    rerender(<BurgerButton onClick={() => {}} expanded={true} />);
    expect(getByRole("button").getAttribute("aria-expanded")).toBe("true");
  });
});
