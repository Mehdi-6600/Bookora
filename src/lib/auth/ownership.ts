import type { CurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

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

/**
 * چک می‌کند که آیا این ویرایش باید محدود به «فقط تغییر price» باشد یا نه.
 * این محدودیت فقط برای زمانی است که یک ادمین دارد سرویسِ متعلق به یک صاحب
 * کسب‌وکار *دیگر* را ویرایش می‌کند (مثلاً برای اصلاح دستی قیمت اشتباه).
 * اگر ادمین دارد سرویس کسب‌وکار خودش را ویرایش می‌کند، این محدودیت اعمال
 * نمی‌شود و او مثل هر صاحب کسب‌وکار دیگری دسترسی کامل دارد.
 */
export async function isPriceOnlyAdminEdit(
  user: CurrentUser,
  serviceId: string
): Promise<boolean> {
  if (!user.isAdmin) return false;

  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { business: { select: { ownerId: true } } },
  });

  if (!service) return false;

  return service.business.ownerId !== user.id;
}
