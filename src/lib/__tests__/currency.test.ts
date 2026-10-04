import { describe, it, expect } from "vitest";
import { isCountryCode, COUNTRY_CURRENCY, formatPrice } from "@/lib/currency";

describe("currency helpers", () => {
  it("isCountryCode accepts IR and OTHER only", () => {
    expect(isCountryCode("IR")).toBe(true);
    expect(isCountryCode("OTHER")).toBe(true);
    expect(isCountryCode("US")).toBe(false);
    expect(isCountryCode("")).toBe(false);
  });

  it("COUNTRY_CURRENCY has entries for IR and OTHER", () => {
    expect(COUNTRY_CURRENCY.IR).toBeDefined();
    expect(COUNTRY_CURRENCY.OTHER).toBeDefined();
  });

  it("formatPrice renders a numeric price", () => {
    const formatted = formatPrice("100", "EUR");
    expect(formatted).toContain("100");
  });
});
