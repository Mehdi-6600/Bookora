import { prisma } from "@/lib/prisma";

// جلوگیری از سوءاستفاده روی Endpointهای عمومی (بدون Auth) مثل ثبت رزرو یا رسید.
// چون سرور Serverless است (نمی‌شود به Memory بین Requestها اعتماد کرد)،
// شمارش در دیتابیس نگه داشته می‌شود تا بین Instanceهای مختلف هم معتبر بماند.
export async function isRateLimited(
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  const now = new Date();

  const existing = await prisma.rateLimit.findUnique({ where: { key } });

  if (!existing || existing.expiresAt < now) {
    await prisma.rateLimit.upsert({
      where: { key },
      create: { key, count: 1, expiresAt: new Date(now.getTime() + windowMs) },
      update: { count: 1, expiresAt: new Date(now.getTime() + windowMs) },
    });
    return false;
  }

  if (existing.count >= limit) {
    return true;
  }

  await prisma.rateLimit.update({
    where: { key },
    data: { count: { increment: 1 } },
  });

  return false;
}
