// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useFocusTrap } from "./useFocusTrap";

afterEach(() => {
  cleanup();
});

function Trapped({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, active);
  return (
    <div>
      <button data-testid="outside-before">outside-before</button>
      <div ref={ref} data-testid="container">
        <button data-testid="inside-first">first</button>
        <button data-testid="inside-last">last</button>
      </div>
      <button data-testid="outside-after">outside-after</button>
    </div>
  );
}

describe("useFocusTrap", () => {
  it("cycles Tab from last back to first when active", () => {
    const { getByTestId } = render(<Trapped active={true} />);
    const first = getByTestId("inside-first");
    const last = getByTestId("inside-last");

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("cycles Shift+Tab from first back to last when active", () => {
    const { getByTestId } = render(<Trapped active={true} />);
    const first = getByTestId("inside-first");
    const last = getByTestId("inside-last");

    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("does not interfere when inactive", () => {
    const { getByTestId } = render(<Trapped active={false} />);
    const last = getByTestId("inside-last");
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    // browser's default tab order would move on — jsdom doesn't simulate it,
    // but at minimum the focus shouldn't return to inside-first.
    expect(document.activeElement).not.toBe(getByTestId("inside-first"));
  });
});
