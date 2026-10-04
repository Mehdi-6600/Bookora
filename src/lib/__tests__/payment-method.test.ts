import { describe, it, expect } from "vitest";
import {
  isPaymentPreference,
  resolvePaymentMethod,
} from "@/lib/subscription/payment-method";

describe("payment-method helpers", () => {
  it("isPaymentPreference accepts AUTO/MANUAL/STARS only", () => {
    expect(isPaymentPreference("AUTO")).toBe(true);
    expect(isPaymentPreference("MANUAL")).toBe(true);
    expect(isPaymentPreference("STARS")).toBe(true);
    expect(isPaymentPreference("CRYPTO")).toBe(false);
  });

  it("MANUAL preference always returns MANUAL", () => {
    expect(resolvePaymentMethod("MANUAL", "IR")).toBe("MANUAL");
    expect(resolvePaymentMethod("MANUAL", "OTHER")).toBe("MANUAL");
  });

  it("STARS preference always returns STARS", () => {
    expect(resolvePaymentMethod("STARS", "IR")).toBe("STARS");
    expect(resolvePaymentMethod("STARS", "OTHER")).toBe("STARS");
  });

  it("AUTO + IR returns MANUAL", () => {
    expect(resolvePaymentMethod("AUTO", "IR")).toBe("MANUAL");
  });

  it("AUTO + OTHER returns STARS", () => {
    expect(resolvePaymentMethod("AUTO", "OTHER")).toBe("STARS");
    expect(resolvePaymentMethod("AUTO", null)).toBe("STARS");
  });
});
