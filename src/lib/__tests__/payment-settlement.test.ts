import { describe, it, expect } from "vitest";

/**
 * Mirrors the settlement math used by the payment-review route. A booking can
 * collect several partial deposits, so both the paid total and the remainder
 * must accumulate instead of being overwritten.
 */
function settledTotals(
  finalPrice: unknown,
  paidBefore: unknown,
  paymentAmount: unknown
): { depositPaid: number; remainingAmount: number } {
  const final = Number(finalPrice);
  const previous = Number(paidBefore);
  const paid = Number(paymentAmount);

  if (!Number.isFinite(paid)) return { depositPaid: 0, remainingAmount: 0 };

  const settled =
    (Number.isFinite(previous) && previous > 0 ? previous : 0) + paid;
  const remaining = Number.isFinite(final) ? Math.max(0, final - settled) : 0;

  return { depositPaid: settled, remainingAmount: remaining };
}

describe("settledTotals", () => {
  it("settles a full deposit", () => {
    expect(settledTotals(100, 0, 100)).toEqual({
      depositPaid: 100,
      remainingAmount: 0,
    });
  });

  it("keeps a remainder for a partial deposit", () => {
    expect(settledTotals(100, 0, 30)).toEqual({
      depositPaid: 30,
      remainingAmount: 70,
    });
  });

  it("accumulates a second partial deposit", () => {
    expect(settledTotals(100, 30, 20)).toEqual({
      depositPaid: 50,
      remainingAmount: 50,
    });
  });

  it("never reports a negative remainder on overpayment", () => {
    expect(settledTotals(100, 80, 50)).toEqual({
      depositPaid: 130,
      remainingAmount: 0,
    });
  });

  it("fails safe on malformed amounts", () => {
    expect(settledTotals("nope", 0, 30).remainingAmount).toBe(0);
    expect(settledTotals(100, 0, "nope")).toEqual({
      depositPaid: 0,
      remainingAmount: 0,
    });
  });
});