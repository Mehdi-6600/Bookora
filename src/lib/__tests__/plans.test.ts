import { describe, it, expect } from "vitest";
import {
  isPlanCode,
  buildInvoicePayload,
  parseInvoicePayload,
} from "@/lib/subscription/plans";

describe("plans", () => {
  it("isPlanCode accepts PRO_MONTHLY and PRO_YEARLY", () => {
    expect(isPlanCode("PRO_MONTHLY")).toBe(true);
    expect(isPlanCode("PRO_YEARLY")).toBe(true);
    expect(isPlanCode("FREE")).toBe(false);
  });

  it("buildInvoicePayload formats correctly", () => {
    const payload = buildInvoicePayload(
      "PRO_MONTHLY",
      "clx123456789 );
    expect(payload).toBe("sub:PRO_MONTHLY:clx1234567890abcdefghij");
  });

  it("parseInvoicePayload accepts valid payloads", () => {
    const result = parseInvoicePayload(
      "sub:PRO_MONTHLY:clx1234567890abcdefghij"
    );
    expect(result).not.toBeNull();
    expect(result?.plan).toBe("PRO_MONTHLY");
    expect(result?.userId).toBe("clx1234567890abcdefghij");
  });

  it("parseInvoicePayload rejects forged payloads", () => {
    expect(parseInvoicePayload("sub:FAKE:clx1234567890abcdefghij")).toBeNull();
    expect(parseInvoicePayload("sub:PRO_MONTHLY:short")).toBeNull();
    expect(parseInvoicePayload("random")).toBeNull();
    expect(parseInvoicePayload("")).toBeNull();
  });
});
