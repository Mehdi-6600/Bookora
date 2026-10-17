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

let bot: Bot | null = null;

function registerOnboardingHandlers(instance: Bot) {
  instance.command("start", async (ctx) => {
    if (ctx.chat.type !== "private") return;

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
   * Any other private text: remind the owner how to open the panel instead of
   * staying silent. This is the difference between "the bot is broken" and
   * "the bot works".
   */
  instance.on("message:text", async (ctx) => {
    if (ctx.chat.type !== "private") return;
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

export function getBot(): Bot {
  if (!bot) {
    bot = new Bot(env.TELEGRAM_BOT_TOKEN);
    registerOnboardingHandlers(bot);
    registerPaymentHandlers(bot);
  }
  return bot;
}

/** Commands shown in the Telegram command menu. */
export const BOT_COMMANDS = [
  { command: "start", description: "Open Bookora and continue setup" },
  { command: "help", description: "How Bookora works" },
  { command: "stop", description: "Stop messages from Bookora" },
] as const;
