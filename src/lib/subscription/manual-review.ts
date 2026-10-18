import { InlineKeyboard } from "grammy";
import { prisma } from "@/lib/prisma";
import { env, getAdminTelegramConfig } from "@/lib/env";
import { formatPrice } from "@/lib/currency";
import { PLANS, isPlanCode } from "@/lib/subscription/plans";
import { lockBusinessSchedule, lockUserSubscriptions } from "@/lib/booking/schedule";
import { nextSubscriptionPeriod } from "@/lib/subscription/entitlement";
import { bookingPageUrl, miniAppUrl } from "@/lib/telegram/onboarding";
import { notifyUser } from "@/lib/telegram/notify";
import { markPaidConversion } from "@/lib/outreach/attribution";

export class SubscriptionNotFoundError extends Error {}
export class ReviewConflictError extends Error {}
export class InvalidManualSubscriptionError extends Error {}

export const REJECTION_PRESETS: Record<string, string> = {
  "1": "کد پیگیری / رهگیری ارسالی نامعتبر یا نادرست است.",
  "2": "مبلغ واریز شده کمتر از هزینه اشتراک انتخابی است.",
  "3": "مبلغ واریزی در حساب بانکی دریافت نشده یا قابل تطبیق نیست.",
  "4": "فیش یا کد رهگیری ارسالی قبلاً استفاده شده و تکراری است.",
};

export async function getAdminTelegramRecipients(): Promise<string[]> {
  const adminConfig = getAdminTelegramConfig();
  const ids = new Set<string>();

  if (adminConfig.configured && adminConfig.ids.length > 0) {
    for (const id of adminConfig.ids) {
      ids.add(id.toString());
    }
  }

  const dbAdmins = await prisma.user.findMany({
    where: { isAdmin: true },
    select: { telegramId: true },
    take: 50,
  });

  for (const admin of dbAdmins) {
    if (/^\d+$/.test(admin.telegramId)) {
      ids.add(admin.telegramId);
    }
  }

  return Array.from(ids);
}

export async function isTelegramUserAdmin(telegramId: string): Promise<boolean> {
  const adminConfig = getAdminTelegramConfig();
  if (adminConfig.configured && /^\d+$/.test(telegramId)) {
    if (adminConfig.ids.includes(BigInt(telegramId))) {
      return true;
    }
  }

  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: { isAdmin: true },
  });

  return Boolean(user?.isAdmin);
}

export function buildAdminReviewKeyboard(subscriptionId: string): InlineKeyboard {
  const adminUrl = `${env.APP_URL.replace(/\/+$/, "")}/fa/admin`;
  return new InlineKeyboard()
    .text("✅ تایید و فعال‌سازی", `sub_app:${subscriptionId}`)
    .text("❌ رد درخواست", `sub_rej:${subscriptionId}`)
    .row()
    .url("🌐 مشاهده در پنل مدیریت", adminUrl);
}

export async function notifyAdminsNewManualSubscription(params: {
  subscriptionId: string;
  userId: string;
  businessId: string;
  plan: string;
  receiptReference: string;
  receiptNote: string | null;
}): Promise<void> {
  try {
    const recipients = await getAdminTelegramRecipients();
    if (recipients.length === 0) return;

    const [buyer, business] = await Promise.all([
      prisma.user.findUnique({
        where: { id: params.userId },
        select: {
          telegramId: true,
          firstName: true,
          lastName: true,
          telegramUsername: true,
        },
      }),
      prisma.business.findUnique({
        where: { id: params.businessId },
        select: { name: true, slug: true },
      }),
    ]);

    const buyerName =
      [buyer?.firstName, buyer?.lastName].filter(Boolean).join(" ") || "نامشخص";
    const buyerUsername = buyer?.telegramUsername ? `@${buyer.telegramUsername}` : "";
    const buyerId = buyer?.telegramId ?? "نامشخص";
    const businessName = business?.name ?? "نامشخص";

    const planDef = isPlanCode(params.plan) ? PLANS[params.plan] : null;
    const planTitle = planDef ? planDef.titleFa : params.plan;
    const priceText = planDef
      ? formatPrice(planDef.manualPriceToman, "IRR")
      : "—";

    const now = new Date();
    const timeFormatted = now.toLocaleDateString("fa-IR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Tehran",
    });

    const text = [
      "🔔 *درخواست جدید خرید اشتراک (کارت‌به‌کارت)*",
      "",
      `👤 *خریدار:* ${buyerName} ${buyerUsername}`.trim(),
      `🆔 *شناسه عددی کاربر:* \`${buyerId}\``,
      `🏪 *کسب‌وکار:* ${businessName}`,
      `📦 *پلن درخواستی:* ${planTitle}`,
      `💰 *مبلغ:* ${priceText}`,
      `🔢 *کد رهگیری:* \`${params.receiptReference}\``,
      `📝 *توضیحات خریدار:* ${
        params.receiptNote?.trim() ? params.receiptNote.trim() : "ثبت نشده"
      }`,
      `🕒 *زمان ثبت:* ${timeFormatted}`,
      "",
      "👇 *جهت بررسی، می‌توانید بدون نیاز به ورود به پنل، مستقیماً از دکمه‌های زیر استفاده کنید:*",
    ].join("\n");

    const keyboard = buildAdminReviewKeyboard(params.subscriptionId);

    await Promise.allSettled(
      recipients.map((recipientId) =>
        notifyUser(recipientId, text, {
          parseMode: "Markdown",
          replyMarkup: keyboard,
        })
      )
    );
  } catch (error) {
    console.error(
      "notifyAdminsNewManualSubscription failed:",
      error instanceof Error ? error.message : "UnknownError"
    );
  }
}

export type ReviewManualResult = {
  status: "ACTIVE" | "REJECTED";
  expiresAt: Date | null;
  alreadyReviewed: boolean;
};

export async function reviewManualSubscription(params: {
  subscriptionId: string;
  action: "approve" | "reject";
  note?: string | null;
  reviewerName?: string;
}): Promise<ReviewManualResult> {
  const { subscriptionId: id, action, note } = params;

  const reference = await prisma.subscription.findUnique({
    where: { id },
    select: { userId: true, businessId: true },
  });
  if (!reference) {
    throw new SubscriptionNotFoundError();
  }

  const result = await prisma.$transaction(async (tx) => {
    if (reference.businessId) {
      await lockBusinessSchedule(tx, reference.businessId);
    }
    await lockUserSubscriptions(tx, reference.userId);

    const subscription = await tx.subscription.findUnique({
      where: { id },
    });

    if (!subscription || subscription.userId !== reference.userId) {
      throw new SubscriptionNotFoundError();
    }

    const [buyer, business] = await Promise.all([
      tx.user.findUnique({
        where: { id: subscription.userId },
        select: { id: true, telegramId: true, languageCode: true, firstName: true },
      }),
      subscription.businessId
        ? tx.business.findFirst({
            where: {
              id: subscription.businessId,
              ownerId: subscription.userId,
              deletedAt: null,
              status: { in: ["DRAFT", "ACTIVE", "EXPIRED"] },
            },
            select: { id: true, name: true, slug: true, status: true, setupCompletedAt: true },
          })
        : null,
    ]);

    if (subscription.status !== "PENDING") {
      const requestedFinalState = action === "approve" ? "ACTIVE" : "REJECTED";
      if (subscription.status === requestedFinalState) {
        return {
          status: subscription.status as "ACTIVE" | "REJECTED",
          expiresAt: subscription.expiresAt,
          alreadyReviewed: true,
          buyer,
          business,
          receiptReference: subscription.receiptReference,
          plan: subscription.plan,
        };
      }
      throw new ReviewConflictError();
    }

    if (subscription.provider !== "MANUAL_IRAN") {
      throw new InvalidManualSubscriptionError();
    }

    const now = new Date();

    if (action === "reject") {
      const updated = await tx.subscription.updateMany({
        where: { id, userId: reference.userId, status: "PENDING" },
        data: {
          status: "REJECTED",
          reviewedAt: now,
          adminNote: note || null,
        },
      });
      if (updated.count !== 1) throw new ReviewConflictError();

      return {
        status: "REJECTED" as const,
        expiresAt: null,
        alreadyReviewed: false,
        buyer,
        business,
        receiptReference: subscription.receiptReference,
        plan: subscription.plan,
      };
    }

    if (!isPlanCode(subscription.plan) || !subscription.receiptReference?.trim()) {
      throw new InvalidManualSubscriptionError();
    }

    const plan = PLANS[subscription.plan];
    const period = await nextSubscriptionPeriod(
      tx,
      subscription.userId,
      plan.durationDays,
      now,
      subscription.businessId ?? undefined
    );

    const updated = await tx.subscription.updateMany({
      where: { id, userId: reference.userId, status: "PENDING" },
      data: {
        status: "ACTIVE",
        startedAt: period.startedAt,
        expiresAt: period.expiresAt,
        reviewedAt: now,
        adminNote: note || null,
      },
    });
    if (updated.count !== 1) throw new ReviewConflictError();

    if (subscription.businessId && business) {
      const [activeServices, enabledDays] = await Promise.all([
        tx.service.count({
          where: { businessId: business.id, active: true },
        }),
        tx.workingHour.count({
          where: { businessId: business.id, enabled: true },
        }),
      ]);

      if (
        (business.status !== "DRAFT" || business.setupCompletedAt) &&
        activeServices > 0 &&
        enabledDays > 0
      ) {
        await tx.business.updateMany({
          where: {
            id: business.id,
            ownerId: subscription.userId,
            deletedAt: null,
            status: { in: ["DRAFT", "ACTIVE", "EXPIRED"] },
          },
          data: {
            status: "ACTIVE",
            expiresAt: period.expiresAt,
            setupCompletedAt: business.setupCompletedAt ?? now,
          },
        });
      }
    }

    return {
      status: "ACTIVE" as const,
      expiresAt: period.expiresAt,
      alreadyReviewed: false,
      buyer,
      business,
      receiptReference: subscription.receiptReference,
      plan: subscription.plan,
    };
  });

  if (!result.alreadyReviewed && result.status === "ACTIVE") {
    await markPaidConversion(reference.userId, reference.businessId);
  }

  if (!result.alreadyReviewed && result.buyer?.telegramId) {
    if (result.status === "ACTIVE") {
      void notifyBuyerApproved({
        telegramId: result.buyer.telegramId,
        businessName: result.business?.name ?? "کسب‌وکار شما",
        businessSlug: result.business?.slug ?? null,
        plan: result.plan,
        expiresAt: result.expiresAt,
      });
    } else if (result.status === "REJECTED") {
      void notifyBuyerRejected({
        telegramId: result.buyer.telegramId,
        businessName: result.business?.name ?? "کسب‌وکار شما",
        receiptReference: result.receiptReference,
        adminNote: note || null,
      });
    }
  }

  return {
    status: result.status,
    expiresAt: result.expiresAt,
    alreadyReviewed: result.alreadyReviewed,
  };
}

export async function notifyBuyerApproved(params: {
  telegramId: string;
  businessName: string;
  businessSlug: string | null;
  plan: string;
  expiresAt: Date | null;
}): Promise<void> {
  try {
    const planDef = isPlanCode(params.plan) ? PLANS[params.plan] : null;
    const planTitle = planDef ? planDef.titleFa : params.plan;

    const expiryText = params.expiresAt
      ? params.expiresAt.toLocaleDateString("fa-IR", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "";

    const bookingUrl = params.businessSlug
      ? bookingPageUrl(params.businessSlug, "fa")
      : null;

    const messageText = [
      "🎉 *پرداخت و اشتراک شما با موفقیت تأیید شد!*",
      "",
      `🏪 *کسب‌وکار:* ${params.businessName}`,
      `📦 *نوع اشتراک:* ${planTitle}`,
      expiryText ? `📅 *اعتبار تا:* ${expiryText}` : "",
      "",
      "هم‌اکنون تمامی قابلیت‌های سیستم برای شما فعال است و صفحه رزرو آنلاین شما آماده پذیرش نوبت‌های مشتریان می‌باشد.",
      ...(bookingUrl ? ["", `🔗 *لینک صفحه رزرو شما:*`, bookingUrl] : []),
    ]
      .filter(Boolean)
      .join("\n");

    const keyboard = new InlineKeyboard().webApp(
      "📱 ورود به پنل مدیریت کسب‌وکار",
      miniAppUrl("fa")
    );

    if (bookingUrl) {
      keyboard.row().url("🌐 مشاهده صفحه رزرو", bookingUrl);
    }

    await notifyUser(params.telegramId, messageText, {
      parseMode: "Markdown",
      replyMarkup: keyboard,
    });
  } catch (error) {
    console.error(
      "notifyBuyerApproved failed:",
      error instanceof Error ? error.message : "UnknownError"
    );
  }
}

export async function notifyBuyerRejected(params: {
  telegramId: string;
  businessName: string;
  receiptReference: string | null;
  adminNote: string | null;
}): Promise<void> {
  try {
    const reasonText =
      params.adminNote?.trim() ||
      "کد پیگیری یا مبلغ واریزی مورد تأیید قرار نگرفت.";

    const messageText = [
      "⚠️ *درخواست خرید اشتراک تأیید نشد*",
      "",
      `🏪 *کسب‌وکار:* ${params.businessName}`,
      params.receiptReference
        ? `🔢 *کد رهگیری ارسالی:* \`${params.receiptReference}\``
        : "",
      "",
      "❌ *علت عدم تأیید:*",
      reasonText,
      "",
      "💡 لطفاً اطلاعات واریزی و فیش خود را مجدداً بررسی فرمایید. جهت ثبت مجدد فیش یا پیگیری، می‌توانید از طریق دکمهٔ زیر وارد پنل شوید.",
    ]
      .filter(Boolean)
      .join("\n");

    const keyboard = new InlineKeyboard().webApp(
      "🔄 ورود به پنل و ثبت مجدد",
      miniAppUrl("fa")
    );

    await notifyUser(params.telegramId, messageText, {
      parseMode: "Markdown",
      replyMarkup: keyboard,
    });
  } catch (error) {
    console.error(
      "notifyBuyerRejected failed:",
      error instanceof Error ? error.message : "UnknownError"
    );
  }
}
