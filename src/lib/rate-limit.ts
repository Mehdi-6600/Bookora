import { prisma } from "@/lib/prisma";

// جلوگیری از سوءاستفاده روی Endpointهای عمومی (بدون Auth).
// چون سرور Serverless است، شمارش در دیتابیس نگه داشته می‌شود.
// عملیات به شکل اتمیک انجام می‌شود تا race condition رخ ندهد.
export async function isRateLimited(
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  const now = new Date();
  const newExpiresAt = new Date(now.getTime() + windowMs);

  try {
    // مرحله ۱: تلاش برای افزایش اتمیک شمارنده اگر رکورد معتبر و زیر limit است.
    const updated = await prisma.rateLimit.updateMany({
      where: {
        key,
        expiresAt: { gt: now },
        count: { lt: limit },
      },
      data: { count: { increment: 1 } },
    });

    if (updated.count > 0) {
      // شمارنده با موفقیت افزایش یافت — درخواست مجاز است.
      return false;
    }

    // مرحله ۲: رکورد وجود ندارد یا منقضی شده یا به limit رسیده.
    const existing = await prisma.rateLimit.findUnique({ where: { key } });

    if (!existing || existing.expiresAt <= now) {
      // ساخت رکورد جدید یا reset.
      // چون key unique است، upsert اتمیک است.
      await prisma.rateLimit.upsert({
        where: { key },
        create: { key, count: 1, expiresAt: newExpiresAt },
        update: { count: 1, expiresAt: newExpiresAt },
      });
      return false;
    }

    // رکورد وجود دارد، معتبر است، ولی count به limit رسیده.
    return true;
  } catch (error) {
    // در صورت خطای DB (مثلاً P2002 در concurrent upsert)، به‌عنوان fail-open
    // اجازه می‌دهیم — چون از دست دادن rate limit بهتر از از دست دادن درخواست معتبر کاربر است.
    // (نکته: اگر سیاست سختگیرانه‌تر می‌خواهی، این‌جا `return true` بگذار.)
    console.error("isRateLimited failed:", error);
    return false;
  }
}

// پاکسازی رکوردهای منقضی — سبک، احتمال کم، بدون await.
export function triggerRateLimitCleanup(): void {
  if (Math.random() > 0.01) return; // ۱٪ احتمال

  void prisma.rateLimit
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch(() => {
      // silent — cleanup نباید خطای اصلی را تحت تأثیر قرار دهد
    });
}
