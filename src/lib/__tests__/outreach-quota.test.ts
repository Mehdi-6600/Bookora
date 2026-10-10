import { describe, expect, it, vi } from "vitest";

// These suites cover pure logic only; keep them runnable without a database.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  clampDiscoveryLimit,
  clampInvitationLimit,
  coerceSettingValue,
  DEFAULT_DAILY_DISCOVERY_LIMIT,
  DEFAULT_DAILY_INVITATION_LIMIT,
  MAX_DAILY_DISCOVERY_LIMIT,
  MAX_DAILY_INVITATION_LIMIT,
  runDateFor,
} from "@/lib/outreach/settings";

describe("daily quota defaults", () => {
  it("uses 50 discovery and 10 invitations by default", () => {
    expect(DEFAULT_DAILY_DISCOVERY_LIMIT).toBe(50);
    expect(DEFAULT_DAILY_INVITATION_LIMIT).toBe(10);
  });
});

describe("setting coercion", () => {
  it("accepts integers inside the guard rails", () => {
    expect(coerceSettingValue("outreach.daily_discovery_limit", 50)).toBe("50");
    expect(coerceSettingValue("outreach.daily_discovery_limit", "0")).toBe("0");
    expect(coerceSettingValue("outreach.daily_invitation_limit", 10)).toBe("10");
  });

  it("refuses to raise a quota above the hard maximum", () => {
    expect(
      coerceSettingValue("outreach.daily_discovery_limit", MAX_DAILY_DISCOVERY_LIMIT + 1)
    ).toBeNull();
    expect(
      coerceSettingValue("outreach.daily_invitation_limit", MAX_DAILY_INVITATION_LIMIT + 1)
    ).toBeNull();
    expect(coerceSettingValue("outreach.daily_discovery_limit", -1)).toBeNull();
  });

  it("rejects non-numeric quota changes", () => {
    expect(coerceSettingValue("outreach.daily_invitation_limit", "abc")).toBeNull();
    expect(coerceSettingValue("outreach.daily_invitation_limit", null)).toBeNull();
    expect(coerceSettingValue("outreach.daily_invitation_limit", {})).toBeNull();
  });

  it("accepts booleans and boolean strings", () => {
    expect(coerceSettingValue("outreach.enabled", true)).toBe("true");
    expect(coerceSettingValue("outreach.enabled", false)).toBe("false");
    expect(coerceSettingValue("outreach.enabled", "true")).toBe("true");
    expect(coerceSettingValue("outreach.enabled", "0")).toBe("false");
    expect(coerceSettingValue("outreach.enabled", "yes")).toBeNull();
  });

  it("validates the run hour", () => {
    expect(coerceSettingValue("outreach.run_local_hour", 0)).toBe("0");
    expect(coerceSettingValue("outreach.run_local_hour", 23)).toBe("23");
    expect(coerceSettingValue("outreach.run_local_hour", 24)).toBeNull();
    expect(coerceSettingValue("outreach.run_local_hour", -1)).toBeNull();
  });

  it("validates the minimum score", () => {
    expect(coerceSettingValue("outreach.min_score", 30)).toBe("30");
    expect(coerceSettingValue("outreach.min_score", 101)).toBeNull();
  });

  it("normalizes and validates the timezone", () => {
    expect(coerceSettingValue("outreach.timezone", "Asia/Tehran")).toBe("Asia/Tehran");
    expect(coerceSettingValue("outreach.timezone", "Not/AZone")).toBeNull();
    expect(coerceSettingValue("outreach.timezone", 123)).toBeNull();
  });

  it("only accepts https feed URLs", () => {
    expect(coerceSettingValue("outreach.feed_url", "https://example.com/feed.json")).toBe(
      "https://example.com/feed.json"
    );
    expect(coerceSettingValue("outreach.feed_url", "http://example.com/feed.json")).toBeNull();
    expect(coerceSettingValue("outreach.feed_url", "")).toBe("");
    expect(coerceSettingValue("outreach.feed_url", "x".repeat(2001))).toBeNull();
  });

  it("rejects unknown setting keys", () => {
    // @ts-expect-error - deliberately testing an invalid key at runtime.
    expect(coerceSettingValue("outreach.delete_everything", true)).toBeNull();
  });
});

describe("quota clamping", () => {
  it("never exceeds the hard maximum", () => {
    expect(clampDiscoveryLimit(10_000)).toBe(MAX_DAILY_DISCOVERY_LIMIT);
    expect(clampInvitationLimit(10_000)).toBe(MAX_DAILY_INVITATION_LIMIT);
  });

  it("never goes below zero", () => {
    expect(clampDiscoveryLimit(-5)).toBe(0);
    expect(clampInvitationLimit(-5)).toBe(0);
  });

  it("falls back to the default for non-numbers", () => {
    expect(clampDiscoveryLimit(Number.NaN)).toBe(DEFAULT_DAILY_DISCOVERY_LIMIT);
    expect(clampInvitationLimit(Number.NaN)).toBe(DEFAULT_DAILY_INVITATION_LIMIT);
  });
});

describe("run date", () => {
  it("computes the calendar date in the configured timezone", () => {
    // 2026-10-10 22:30 UTC is already 2026-10-11 in Tehran (+03:30).
    const now = new Date("2026-10-10T22:30:00.000Z");

    expect(runDateFor("UTC", now)).toBe("2026-10-10");
    expect(runDateFor("Asia/Tehran", now)).toBe("2026-10-11");
  });

  it("falls back to UTC for an invalid timezone", () => {
    const now = new Date("2026-10-10T12:00:00.000Z");
    expect(runDateFor("Not/AZone", now)).toBe("2026-10-10");
  });
});
