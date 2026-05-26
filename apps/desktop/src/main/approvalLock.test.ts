import { describe, it, expect } from "vitest";
import { withApprovalLock } from "./approvalLock.js";

describe("withApprovalLock", () => {
  it("serializes concurrent calls for the same id", async () => {
    const order: string[] = [];
    const slow = (label: string) => async () => {
      order.push(`start-${label}`);
      await new Promise((r) => setTimeout(r, 25));
      order.push(`end-${label}`);
      return label;
    };

    const r1 = withApprovalLock("appr-1", slow("a"));
    const r2 = withApprovalLock("appr-1", slow("b"));

    await Promise.all([r1, r2]);

    expect(order).toEqual(["start-a", "end-a", "start-b", "end-b"]);
  });

  it("releases the lock after the function rejects, letting the next call proceed", async () => {
    const fail = async () => {
      throw new Error("boom");
    };
    await expect(withApprovalLock("appr-2", fail)).rejects.toThrow("boom");

    let ran = false;
    await withApprovalLock("appr-2", async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("does not serialize across different ids", async () => {
    const order: string[] = [];
    const slow = (label: string) => async () => {
      order.push(`start-${label}`);
      await new Promise((r) => setTimeout(r, 25));
      order.push(`end-${label}`);
    };

    await Promise.all([
      withApprovalLock("appr-3", slow("a")),
      withApprovalLock("appr-4", slow("b"))
    ]);

    const startA = order.indexOf("start-a");
    const startB = order.indexOf("start-b");
    const endA = order.indexOf("end-a");
    const endB = order.indexOf("end-b");
    // Both must start before either ends — strict interleaving.
    expect(Math.max(startA, startB)).toBeLessThan(Math.min(endA, endB));
  });

  it("returns the value the function returned", async () => {
    const r = await withApprovalLock("appr-5", async () => 42);
    expect(r).toBe(42);
  });
});
