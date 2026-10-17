import { Bot, InlineKeyboard } from "grammy";
import { Prisma } from "@prisma/client";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { recordAttributedStart } from "@/lib/outreach/attribution";
import { PLANS, parseInvoicePayload } from "@/lib/subscription/plans";
import { nextSubscriptionPeriod } from "@/lib/subscription/entitlement";
import {
  HELP,
  START_BUTTON,
  STOPPED,
  WELCOME,
  languageFor,
  miniAppUrl,
  welcomeKeyboard,
} from "@/lib/telegram/onboarding";
import { recordOptOut } from "@/lib/outreach/invitations";
import { recordBotStartConsent, revokeBotConsent } from "@/lib/outreach/bot-consent";
import { recordAuditEvent } from "@/lib/outreach/audit";
import {
  lockBusinessSchedule,
  lockUserSubscriptions,
} from "@/lib/booking/schedule";
import { isBusinessPubliclyActive } from "@/lib/business/lifecycle";
import {
  REJECTION_PRESETS,
  buildAdminReviewKeyboard,
  isTelegramUserAdmin,
  reviewManualSubscription,
} from "@/lib/subscription/manual-review";

let bot: Bot | null = null;

type PendingAdminRejection = {
  subscriptionId: string;
  chatId?: number;
  messageId?: number;
  originalText?: string;
  createdAt: number;
};

const pendingAdminRejections = new Map<string, PendingAdminRejection>();

export function setPendingAdminRejection(
  adminTelegramId: string,
  data: Omit<PendingAdminRejection, "createdAt">
) {
  pendingAdminRejections.set(adminTelegramId, {
    ...data,
    createdAt: Date.now(),
  });
}

export function getPendingAdminRejection(
  adminTelegramId: string
): PendingAdminRejection | null {
  const item = pendingAdminRejections.get(adminTelegramId);
  if (!item) return null;
  if (Date.now() - item.createdAt > 30 * 60 * 1000) {
    pendingAdminRejections.delete(adminTelegramId);
    return null;
  }
  return item;
}

export function clearPendingAdminRejection(adminTelegramId: string) {
  pendingAdminRejections.delete(adminTelegramId);
}

function registerOnboardingHandlers(instance: Bot) {
  instance.command("start", async (ctx) => {
    if (ctx.chat.type !== "private") return;

    if (ctx.from) {
      clearPendingAdminRejection(String(ctx.from.id));
    }

    const language = languageFor(ctx.from?.language_code);
    const startParam = ctx.match && ctx.match.length > 0 ? ctx.match.trim() : undefined;

    if (ctx.from) {
      // Awaited: on serverless the invocation can end as soon as the response
      // is returned, which would drop the attribution write.
      // Only a private 1:1 chat proves a messaging relationship: a group
      // /start or a mismatched chat id never records outreach consent.
      if (String(ctx.chat.id) !== String(ctx.from.id)) return;
      const consent = await recordBotStartConsent({
        telegramId: String(ctx.from.id), chatId: String(ctx.chat.id),
        updateId: ctx.update.update_id, startParam,
      });
      await recordAttributedStart({
        telegramId: String(ctx.from.id), startParam,
        // Makes the attribution write idempotent per Telegram update. This is
        // the only dedupe key available for a /start without a startParam,
        // which `bot_starts_telegramId_startParam_key` cannot cover.
        updateId: ctx.update.update_id,
      });
      // Consent is durable in `telegram_bot_opt_ins`; the audit line is the
      // operator-facing evidence and is best-effort only. A failure here is
      // logged, never silently dropped.
      try {
        await recordAuditEvent({
          scope: "prospect",
          entityId: consent.prospectId,
          action: "prospect.bot_consent_recorded",
          detail: `source=telegram_webhook update=${ctx.update.update_id}`,
        });
      } catch (error) {
        console.error(
          "bot consent audit failed:",
          error instanceof Error ? error.name : "UnknownError"
        );
      }
    }

    await ctx.reply(WELCOME[language], {
      reply_markup: welcomeKeyboard(language),
    });
  });

  instance.command("help", async (ctx) => {
    if (ctx.chat.type !== "private") return;

    const language = languageFor(ctx.from?.language_code);
    await ctx.reply(HELP[language], {
      reply_markup: new InlineKeyboard().webApp(
        START_BUTTON[language],
        miniAppUrl(language)
      ),
    });
  });

  /**
   * Opt-out. Required for every outbound message we send, and it must work
   * even for someone who never received an invitation.
   */
  instance.command("stop", async (ctx) => {
    if (ctx.chat.type !== "private") return;

    const language = languageFor(ctx.from?.language_code);

    if (ctx.from) {
      await revokeBotConsent(String(ctx.from.id), ctx.update.update_id);
      try {
        await recordOptOut({
          telegramId: String(ctx.from.id),
          telegramUsername: ctx.from.username ?? null,
          note: "Opted out via /stop",
          source: "telegram_stop",
        });
      } catch (error) {
        // The withdrawal itself is already persisted by `recordOptOut`; only a
        // failure to *audit* it lands here. Never swallow it silently — the
        // operator must know the audit trail is incomplete.
        console.error(
          "recordOptOut audit failed:",
          error instanceof Error ? error.name : "UnknownError"
        );
      }
    }

    await ctx.reply(STOPPED[language]);
  });

  /**
   * Any other private text: check for pending admin rejection prompt, otherwise
   * remind the owner how to open the panel instead of staying silent.
   */
  instance.on("message:text", async (ctx) => {
    if (ctx.chat.type !== "private") return;

    if (ctx.from) {
      const fromId = String(ctx.from.id);
      const pending = getPendingAdminRejection(fromId);
      if (pending) {
        if (ctx.message.text.trim() === "/cancel") {
          clearPendingAdminRejection(fromId);
          await ctx.reply("عملیات رد درخواست لغو شد.");
          return;
        }

        const reasonText = ctx.message.text.trim();
        clearPendingAdminRejection(fromId);

        const adminName = ctx.from.first_name
          ? `${ctx.from.first_name} ${ctx.from.last_name ?? ""}`.trim()
          : ctx.from.username
          ? `@${ctx.from.username}`
          : "مدیر";

        try {
          const result = await reviewManualSubscription({
            subscriptionId: pending.subscriptionId,
            action: "reject",
            note: reasonText,
            reviewerName: adminName,
          });

          if (result.alreadyReviewed) {
            await ctx.reply("این درخواست قبلاً تعیین تکلیف شده بود.");
            return;
          }

          await ctx.reply(
            "❌ درخواست با موفقیت رد شد و پیام علت عدم تایید برای خریدار در ربات ارسال گردید."
          );

          if (pending.messageId && pending.chatId) {
            try {
              const adminUrl = `${env.APP_URL.replace(/\/+$/, "")}/fa/admin`;
              await ctx.api.editMessageText(
                pending.chatId,
                pending.messageId,
                `${pending.originalText}\n\n❌ وضعیت: توسط ${adminName} رد شد.\nعلت رد: ${reasonText}`,
                {
                  reply_markup: new InlineKeyboard().url(
                    "🌐 مشاهده در پنل مدیریت",
                    adminUrl
                  ),
                }
              );
            } catch {
              // Best effort update
            }
          }
          return;
        } catch (error) {
          console.error("Admin custom rejection failed:", error);
          await ctx.reply("خطا در رد درخواست. لطفاً از پنل وب اقدام فرمایید.");
          return;
        }
      }
    }

    const language = languageFor(ctx.from?.language_code);
    await ctx.reply(WELCOME[language], {
      reply_markup: welcomeKeyboard(language),
    });
  });
}

function registerPaymentHandlers(instance: Bot) {
  instance.on("pre_checkout_query", async (ctx) => {
    const query = ctx.preCheckoutQuery;
    const parsed = parseInvoicePayload(query.invoice_payload);

    if (!parsed) {
      await ctx.answerPreCheckoutQuery(false, "اطلاعات پرداخت نامعتبر است.");
      return;
    }
    if (!parsed.businessId) {
      await ctx.answerPreCheckoutQuery(
        false,
        "این لینک پرداخت به پنل مشخصی متصل نیست؛ از داخل همان پنل دوباره اقدام کنید."
      );
      return;
    }

    const plan = PLANS[parsed.plan];
    if (
      query.currency !== "XTR" ||
      query.total_amount !== plan.starsPrice
    ) {
      await ctx.answerPreCheckoutQuery(false, "مبلغ یا ارز پرداخت معتبر نیست.");
      return;
    }

    const fromId = ctx.from?.id;
    if (!fromId) {
      await ctx.answerPreCheckoutQuery(false, "کاربر نامعتبر است.");
      return;
    }

    const payer = await prisma.user.findUnique({
      where: { telegramId: String(fromId) },
      select: { id: true },
    });

    if (!payer || payer.id !== parsed.userId) {
      console.error("pre_checkout_query userId mismatch", {
        fromId: fromId,
        payloadUserId: parsed.userId,
      });
      await ctx.answerPreCheckoutQuery(
        false,
        "این پرداخت برای شما صادر نشده است."
      );
      return;
    }

    if (parsed.businessId) {
      const business = await prisma.business.findFirst({
        where: {
          id: parsed.businessId,
          ownerId: payer.id,
          deletedAt: null,
          status: { in: ["DRAFT", "ACTIVE", "EXPIRED"] },
        },
        select: {
          id: true,
          status: true,
          expiresAt: true,
          setupCompletedAt: true,
        },
      });
      if (
        !business ||
        (!isBusinessPubliclyActive(business) && !business.setupCompletedAt)
      ) {
        await ctx.answerPreCheckoutQuery(
          false,
          "این کسب‌وکار برای حساب شما قابل فعال‌سازی نیست."
        );
        return;
      }

      const [activeServices, enabledDays] = await Promise.all([
        prisma.service.count({
          where: { businessId: business.id, active: true },
        }),
        prisma.workingHour.count({
          where: { businessId: business.id, enabled: true },
        }),
      ]);
      if (activeServices < 1 || enabledDays < 1) {
        const errorMessage =
          activeServices < 1 && enabledDays < 1
            ? "برای ادامه دست‌کم یک سرویس فعال و یک روز کاری فعال ثبت کنید."
            : activeServices < 1
            ? "برای ادامه دست‌کم یک سرویس فعال ثبت کنید."
            : "برای ادامه دست‌کم یک روز کاری فعال ثبت کنید.";
        await ctx.answerPreCheckoutQuery(false, errorMessage);
        return;
      }
    }

    await ctx.answerPreCheckoutQuery(true);
  });

  instance.on("message:successful_payment", async (ctx) => {
    const payment = ctx.message.successful_payment;
    const parsed = parseInvoicePayload(payment.invoice_payload);

    if (!parsed) {
      console.error(
        "successful_payment with unparseable payload:",
        payment.invoice_payload
      );
      return;
    }

    const fromId = ctx.from?.id;
    if (!fromId) return;

    const payer = await prisma.user.findUnique({
      where: { telegramId: String(fromId) },
      select: { id: true },
    });

    if (!payer || payer.id !== parsed.userId) {
      console.error("successful_payment userId mismatch", {
        fromId: fromId,
        payloadUserId: parsed.userId,
      });
      return;
    }

    const plan = PLANS[parsed.plan];
    if (!plan) {
      console.error("Unknown plan in payload:", parsed.plan);
      return;
    }
    if (
      payment.currency !== "XTR" ||
      payment.total_amount !== plan.starsPrice
    ) {
      console.error("successful_payment amount or currency mismatch", {
        currency: payment.currency,
        amount: payment.total_amount,
        expectedAmount: plan.starsPrice,
      });
      return;
    }

    const now = new Date();

    try {
      const result = await prisma.$transaction(async (tx) => {
        if (parsed.businessId) {
          await lockBusinessSchedule(tx, parsed.businessId);
        }
        await lockUserSubscriptions(tx, payer.id);

        const existing = await tx.subscription.findFirst({
          where: { providerPaymentId: payment.telegram_payment_charge_id },
          select: { id: true },
        });
        if (existing) {
          return { duplicate: true, expiresAt: null, businessActivated: false };
        }

        const business = parsed.businessId
          ? await tx.business.findFirst({
              where: { id: parsed.businessId, ownerId: payer.id },
              select: {
                id: true,
                status: true,
                deletedAt: true,
                setupCompletedAt: true,
              },
            })
          : null;
        const scopedBusinessId = business?.id ?? null;
        const period = await nextSubscriptionPeriod(
          tx,
          payer.id,
          plan.durationDays,
          now,
          scopedBusinessId ?? undefined
        );

        await tx.subscription.create({
          data: {
            userId: payer.id,
            businessId: scopedBusinessId,
            plan: plan.code,
            status: "ACTIVE",
            provider: "telegram_stars",
            providerPaymentId: payment.telegram_payment_charge_id,
            startedAt: period.startedAt,
            expiresAt: period.expiresAt,
          },
        });

        let businessActivated = false;
        if (
          business &&
          !business.deletedAt &&
          ["DRAFT", "ACTIVE", "EXPIRED"].includes(business.status)
        ) {
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
            const updated = await tx.business.updateMany({
              where: {
                id: business.id,
                ownerId: payer.id,
                deletedAt: null,
                status: { in: ["DRAFT", "ACTIVE", "EXPIRED"] },
              },
              data: {
                status: "ACTIVE",
                expiresAt: period.expiresAt,
                setupCompletedAt: business.setupCompletedAt ?? now,
              },
            });
            businessActivated = updated.count === 1;
          }
        }

        return {
          duplicate: false,
          expiresAt: period.expiresAt,
          businessActivated,
        };
      });

      if (result.duplicate) {
        await ctx.reply("این پرداخت قبلاً ثبت شده است.");
        return;
      }

      const expiryText = result.expiresAt
        ? result.expiresAt.toLocaleDateString("fa-IR")
        : "";
      await ctx.reply(
        result.businessActivated
          ? `پرداخت با موفقیت انجام شد. اشتراک "${plan.titleFa}" شما تا ${expiryText} فعال است و کسب‌وکار فعال شد.`
          : `پرداخت با موفقیت ثبت شد. اشتراک "${plan.titleFa}" شما تا ${expiryText} فعال است.`
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        console.warn(
          "Duplicate subscription (idempotent) for providerPaymentId:",
          payment.telegram_payment_charge_id
        );
        await ctx.reply("این پرداخت قبلاً ثبت شده است.");
        return;
      }

      console.error("Failed to record subscription after payment:", error);
    }
  });
}

function registerAdminReviewHandlers(instance: Bot) {
  instance.callbackQuery(/^sub_app:(.+)$/, async (ctx) => {
    const fromId = ctx.from ? String(ctx.from.id) : null;
    if (!fromId) return;

    const isAdmin = await isTelegramUserAdmin(fromId);
    if (!isAdmin) {
      await ctx.answerCallbackQuery({
        text: "شما به این عملیات دسترسی ندارید.",
        show_alert: true,
      });
      return;
    }

    const subscriptionId = ctx.match[1];
    const adminName = ctx.from.first_name
      ? `${ctx.from.first_name} ${ctx.from.last_name ?? ""}`.trim()
      : ctx.from.username
      ? `@${ctx.from.username}`
      : "مدیر";

    try {
      const result = await reviewManualSubscription({
        subscriptionId,
        action: "approve",
        note: `تأیید شده از طریق ربات توسط ${adminName}`,
        reviewerName: adminName,
      });

      if (result.alreadyReviewed) {
        await ctx.answerCallbackQuery({
          text: "این درخواست قبلاً بررسی و تعیین وضعیت شده است.",
          show_alert: true,
        });
        return;
      }

      await ctx.answerCallbackQuery({
        text: "✅ اشتراک با موفقیت تأیید و فعال شد.",
      });

      const baseText =
        ctx.callbackQuery.message && "text" in ctx.callbackQuery.message
          ? ctx.callbackQuery.message.text
          : "";
      const updatedText = `${baseText}\n\n✅ *وضعیت:* این درخواست توسط ${adminName} تأیید شد و اشتراک فعال گردید.`;
      const adminUrl = `${env.APP_URL.replace(/\/+$/, "")}/fa/admin`;

      try {
        await ctx.editMessageText(updatedText, {
          parse_mode: "Markdown",
          reply_markup: new InlineKeyboard().url(
            "🌐 مشاهده در پنل مدیریت",
            adminUrl
          ),
        });
      } catch {
        await ctx.editMessageText(
          `${baseText}\n\n✅ وضعیت: این درخواست توسط ${adminName} تأیید شد و اشتراک فعال گردید.`,
          {
            reply_markup: new InlineKeyboard().url(
              "🌐 مشاهده در پنل مدیریت",
              adminUrl
            ),
          }
        );
      }
    } catch (err) {
      console.error("sub_app callback failed:", err);
      await ctx.answerCallbackQuery({
        text: "خطا در تأیید اشتراک. لطفاً مجدداً تلاش کنید یا از پنل وب اقدام نمایید.",
        show_alert: true,
      });
    }
  });

  instance.callbackQuery(/^sub_rej:(.+)$/, async (ctx) => {
    const fromId = ctx.from ? String(ctx.from.id) : null;
    if (!fromId) return;

    const isAdmin = await isTelegramUserAdmin(fromId);
    if (!isAdmin) {
      await ctx.answerCallbackQuery({
        text: "شما به این عملیات دسترسی ندارید.",
        show_alert: true,
      });
      return;
    }

    const subscriptionId = ctx.match[1];
    const keyboard = new InlineKeyboard()
      .text("❌ کد پیگیری نادرست است", `sub_rn:${subscriptionId}:1`)
      .row()
      .text("❌ مبلغ واریزی ناقص است", `sub_rn:${subscriptionId}:2`)
      .row()
      .text("❌ واریزی به حساب ننشسته است", `sub_rn:${subscriptionId}:3`)
      .row()
      .text("❌ فیش یا تراکنش تکراری است", `sub_rn:${subscriptionId}:4`)
      .row()
      .text("✍️ تایپ علت دلخواه در چت", `sub_rn:${subscriptionId}:custom`)
      .row()
      .text("🔙 انصراف و بازگشت", `sub_rn:${subscriptionId}:back`);

    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
  });

  instance.callbackQuery(/^sub_rn:(.+?):(.+)$/, async (ctx) => {
    const fromId = ctx.from ? String(ctx.from.id) : null;
    if (!fromId) return;

    const isAdmin = await isTelegramUserAdmin(fromId);
    if (!isAdmin) {
      await ctx.answerCallbackQuery({
        text: "شما به این عملیات دسترسی ندارید.",
        show_alert: true,
      });
      return;
    }

    const subscriptionId = ctx.match[1];
    const codeOrAction = ctx.match[2];

    if (codeOrAction === "back") {
      await ctx.answerCallbackQuery();
      await ctx.editMessageReplyMarkup({
        reply_markup: buildAdminReviewKeyboard(subscriptionId),
      });
      return;
    }

    if (codeOrAction === "custom") {
      setPendingAdminRejection(fromId, {
        subscriptionId,
        chatId: ctx.chat?.id,
        messageId: ctx.callbackQuery.message?.message_id,
        originalText:
          ctx.callbackQuery.message && "text" in ctx.callbackQuery.message
            ? ctx.callbackQuery.message.text
            : "",
      });
      await ctx.answerCallbackQuery();
      await ctx.reply(
        "✍️ لطفاً علت رد درخواست را در پاسخ تایپ و ارسال کنید (این متن مستقیماً برای خریدار ارسال خواهد شد):\n\nبرای لغو /cancel را ارسال کنید."
      );
      return;
    }

    const reasonText =
      REJECTION_PRESETS[codeOrAction] ??
      "کد پیگیری یا اطلاعات واریز مورد تأیید قرار نگرفت.";
    const adminName = ctx.from.first_name
      ? `${ctx.from.first_name} ${ctx.from.last_name ?? ""}`.trim()
      : ctx.from.username
      ? `@${ctx.from.username}`
      : "مدیر";

    try {
      const result = await reviewManualSubscription({
        subscriptionId,
        action: "reject",
        note: reasonText,
        reviewerName: adminName,
      });

      if (result.alreadyReviewed) {
        await ctx.answerCallbackQuery({
          text: "این درخواست قبلاً بررسی و تعیین وضعیت شده است.",
          show_alert: true,
        });
        return;
      }

      await ctx.answerCallbackQuery({
        text: "❌ درخواست رد شد و پیام علت برای خریدار ارسال گردید.",
      });

      const baseText =
        ctx.callbackQuery.message && "text" in ctx.callbackQuery.message
          ? ctx.callbackQuery.message.text
          : "";
      const adminUrl = `${env.APP_URL.replace(/\/+$/, "")}/fa/admin`;

      try {
        await ctx.editMessageText(
          `${baseText}\n\n❌ *وضعیت:* این درخواست توسط ${adminName} رد شد.\n*علت رد:* ${reasonText}`,
          {
            parse_mode: "Markdown",
            reply_markup: new InlineKeyboard().url(
              "🌐 مشاهده در پنل مدیریت",
              adminUrl
            ),
          }
        );
      } catch {
        await ctx.editMessageText(
          `${baseText}\n\n❌ وضعیت: این درخواست توسط ${adminName} رد شد.\nعلت رد: ${reasonText}`,
          {
            reply_markup: new InlineKeyboard().url(
              "🌐 مشاهده در پنل مدیریت",
              adminUrl
            ),
          }
        );
      }
    } catch (err) {
      console.error("sub_rn callback failed:", err);
      await ctx.answerCallbackQuery({
        text: "خطا در رد درخواست. لطفاً مجدداً تلاش کنید.",
        show_alert: true,
      });
    }
  });
}

export function getBot(): Bot {
  if (!bot) {
    bot = new Bot(env.TELEGRAM_BOT_TOKEN);
    registerOnboardingHandlers(bot);
    registerPaymentHandlers(bot);
    registerAdminReviewHandlers(bot);
  }
  return bot;
}

/** Commands shown in the Telegram command menu. */
export const BOT_COMMANDS = [
  { command: "start", description: "Open Bookora and continue setup" },
  { command: "help", description: "How Bookora works" },
  { command: "stop", description: "Stop messages from Bookora" },
] as const;
