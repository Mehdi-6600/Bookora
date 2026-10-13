import { describe, expect, it } from "vitest";
import {
  INVALID_PHONE_MESSAGE,
  normalizePhoneNumber,
} from "@/lib/normalize-phone";
import {
  customerNameSchema,
  normalizedCustomerPhoneSchema,
} from "@/lib/booking/customer-validation";

describe("normalizePhoneNumber", () => {
  it.each([
    ["local Persian Iranian mobile", "۰۹۱۲۳۴۵۶۷۸۹", "+989123456789"],
    ["local Arabic-Indic Iranian mobile", "٠٩١٢٣٤٥٦٧٨٩", "+989123456789"],
    ["local ASCII Iranian mobile", "09123456789", "+989123456789"],
    ["mixed digit scripts", "۰۹1234۵67۸۹", "+989123456789"],
    ["spaced international German number", "+49 151 23456789", "+4915123456789"],
    ["international Iran with separators", "+98 (912) 345-6789", "+989123456789"],
    ["international UAE number", "+971 50 123 4567", "+971501234567"],
    ["international US number", "+1 (415) 555-2671", "+14155552671"],
    ["00 international prefix", "0049.151.23456789", "+4915123456789"],
    ["country-prefixed Iranian mobile without plus", "989123456789", "+989123456789"],
    ["Persian digits and punctuation", "+۹۸ (۹۱۲) ۳۴۵-۶۷۸۹", "+989123456789"],
  ])("normalizes %s", (_label, input, expected) => {
    expect(normalizePhoneNumber(input)).toBe(expected);
  });

  it.each([
    "",
    "0912345678",
    "091234567890",
    "015123456789",
    "4155552671",
    "+999123456789",
    "+49 151 23",
    "98+9123456789",
    "09123abc789",
    "۰۹۱۲۳۴۵۶۷۸۹ ext 1",
  ])("rejects invalid or ambiguous input %s with the Persian message", (input) => {
    expect(() => normalizePhoneNumber(input)).toThrowError(
      INVALID_PHONE_MESSAGE
    );
  });

  it("accepts valid normalized international numbers at the booking boundary", () => {
    for (const phone of [
      "+989123456789",
      "+4915123456789",
      "+971501234567",
      "+14155552671",
    ]) {
      expect(normalizedCustomerPhoneSchema.parse(phone)).toBe(phone);
    }
    expect(() => normalizedCustomerPhoneSchema.parse("۰۹۱۲۳۴۵۶۷۸۹")).toThrow();
    expect(() => normalizedCustomerPhoneSchema.parse("+999123456789")).toThrow();
  });
});

describe("customerNameSchema", () => {
  it.each([
    "فاطمه رضایی",
    "John Smith",
    "أحمد محمد",
    "Sara Mohammadi",
    "علی O'Connor",
    "  Sara Mohammadi  ",
  ])("accepts and preserves %s", (name) => {
    expect(customerNameSchema.parse(name)).toBe(name);
  });

  it("keeps the 1-120 character rule and rejects unsafe controls", () => {
    expect(customerNameSchema.parse("A")).toBe("A");
    expect(customerNameSchema.parse("a".repeat(120))).toBe("a".repeat(120));
    expect(customerNameSchema.parse("𐐀".repeat(120))).toBe("𐐀".repeat(120));
    expect(() => customerNameSchema.parse("   ")).toThrow();
    expect(() => customerNameSchema.parse("a".repeat(121))).toThrow();
    expect(() => customerNameSchema.parse("𐐀".repeat(121))).toThrow();
    expect(() => customerNameSchema.parse("Sara\u202e Mohammadi")).toThrow();
    expect(() => customerNameSchema.parse("Sara\u200f Mohammadi")).toThrow();
    expect(() => customerNameSchema.parse("Sara\u061c Mohammadi")).toThrow();
    expect(() => customerNameSchema.parse("Sara\u0085 Mohammadi")).toThrow();
  });
});
