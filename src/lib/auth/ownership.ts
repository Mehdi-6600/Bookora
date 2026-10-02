import type { CurrentUser } from "@/lib/auth/session";

/**
 * Helper برای شرط مالکیت Business.
 * - کاربر عادی: فقط کسب‌وکارهای خودش
 * - ادمین: همه‌ی کسب‌وکارها
 */
export function businessOwnerFilter(user: CurrentUser): {
  ownerId?: string;
} {
  if (user.isAdmin) return {};
  return { ownerId: user.id };
}

/**
 * Helper برای شرط مالکیت Service.
 * - کاربر عادی: فقط سرویس‌های کسب‌وکارهای خودش
 * - ادمین: همه‌ی سرویس‌ها
 */
export function serviceOwnerFilter(user: CurrentUser): {
  business?: { ownerId: string };
} {
  if (user.isAdmin) return {};
  return { business: { ownerId: user.id } };
}
