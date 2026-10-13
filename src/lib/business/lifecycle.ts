export type BusinessLifecycleStatus =
  | "DRAFT"
  | "ACTIVE"
  | "EXPIRED"
  | "DISABLED"
  | "ARCHIVED"
  | string;

export type BusinessLifecycleRecord = {
  status: string;
  expiresAt?: Date | null;
  deletedAt?: Date | null;
  createdAt?: Date;
};

export const DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function isBusinessPubliclyActive(
  business: BusinessLifecycleRecord,
  now = new Date()
): boolean {
  return (
    business.status === "ACTIVE" &&
    !business.deletedAt &&
    (!business.expiresAt || business.expiresAt.getTime() > now.getTime())
  );
}

export function getEffectiveBusinessStatus(
  business: BusinessLifecycleRecord,
  now = new Date()
): BusinessLifecycleStatus {
  if (business.status === "ACTIVE" && business.expiresAt && business.expiresAt <= now) {
    return "EXPIRED";
  }
  return business.status;
}

export function canAdminSoftDeleteBusiness(
  business: BusinessLifecycleRecord,
  now = new Date()
): boolean {
  if (business.deletedAt) return false;

  const status = getEffectiveBusinessStatus(business, now);
  if (["EXPIRED", "DISABLED", "ARCHIVED"].includes(status)) return true;
  if (status !== "DRAFT" || !business.createdAt) return false;

  return business.createdAt.getTime() < now.getTime() - DRAFT_RETENTION_MS;
}

export function canActivateBusiness(
  business: BusinessLifecycleRecord,
  now = new Date()
): boolean {
  if (business.deletedAt || ["DISABLED", "ARCHIVED"].includes(business.status)) {
    return false;
  }

  return (
    business.status === "DRAFT" ||
    business.status === "EXPIRED" ||
    (business.status === "ACTIVE" &&
      Boolean(business.expiresAt && business.expiresAt <= now))
  );
}
