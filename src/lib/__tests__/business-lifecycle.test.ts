import { describe, expect, it } from "vitest";
import {
  canActivateBusiness,
  canAdminSoftDeleteBusiness,
  getEffectiveBusinessStatus,
  isBusinessPubliclyActive,
} from "@/lib/business/lifecycle";

const now = new Date("2026-10-13T12:00:00.000Z");

describe("business lifecycle", () => {
  it("keeps drafts private and lets an owner request activation", () => {
    const draft = { status: "DRAFT", createdAt: new Date("2026-10-13T00:00:00Z") };
    expect(isBusinessPubliclyActive(draft, now)).toBe(false);
    expect(canActivateBusiness(draft, now)).toBe(true);
    expect(canAdminSoftDeleteBusiness(draft, now)).toBe(false);
  });

  it("requires a disabled state before an active business can be soft deleted", () => {
    const active = { status: "ACTIVE", expiresAt: null };
    expect(isBusinessPubliclyActive(active, now)).toBe(true);
    expect(canAdminSoftDeleteBusiness(active, now)).toBe(false);
    expect(canActivateBusiness(active, now)).toBe(false);

    const disabled = { status: "DISABLED", expiresAt: null };
    expect(isBusinessPubliclyActive(disabled, now)).toBe(false);
    expect(canAdminSoftDeleteBusiness(disabled, now)).toBe(true);
  });

  it("derives expiration from expiresAt and permits renewal", () => {
    const expired = {
      status: "ACTIVE",
      expiresAt: new Date("2026-10-13T11:59:59.000Z"),
    };
    expect(getEffectiveBusinessStatus(expired, now)).toBe("EXPIRED");
    expect(isBusinessPubliclyActive(expired, now)).toBe(false);
    expect(canActivateBusiness(expired, now)).toBe(true);
    expect(canAdminSoftDeleteBusiness(expired, now)).toBe(true);
  });

  it("allows draft cleanup only after 30 days", () => {
    const oldDraft = {
      status: "DRAFT",
      createdAt: new Date("2026-09-12T11:59:59.000Z"),
    };
    const recentDraft = {
      status: "DRAFT",
      createdAt: new Date("2026-09-13T12:00:01.000Z"),
    };
    expect(canAdminSoftDeleteBusiness(oldDraft, now)).toBe(true);
    expect(canAdminSoftDeleteBusiness(recentDraft, now)).toBe(false);
  });

  it("keeps soft-deleted businesses non-public and not eligible for a second removal", () => {
    const deleted = {
      status: "DISABLED",
      deletedAt: new Date("2026-10-12T00:00:00Z"),
    };
    expect(isBusinessPubliclyActive(deleted, now)).toBe(false);
    expect(canAdminSoftDeleteBusiness(deleted, now)).toBe(false);
    expect(canActivateBusiness(deleted, now)).toBe(false);
  });
});
