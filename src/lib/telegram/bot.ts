import { Bot } from "grammy";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { PLANS, parseInvoicePayload } from "@/lib/subscription/plans";
import { lockUserSubscriptions } from "@/lib/booking/schedule";
import { nextSubscriptionPeriod } from "@/lib/subscription/entitlement";

let bot: Bot | null = null;

function registerPaymentHandlers(instance: Bot) {
  instance.on("pre_checkout_query", async (ctx) => {
    const query = ctx.preCheckoutQuery;
    const parsed = parseInvoicePayload(query.invoice_payload);
    if (!parsed) {
      await ctx.answerPreCheckoutQuery(false, "اطلاعات پرداخت نامعتبر است.");
      return;
    }

    const plan = PLANS[parsed.plan];
    if (query.currency !== "XTR" || query.total_amount !== plan.starsPrice) {
      console.warn("Rejected Telegram pre-checkout: amount or currency mismatch.");
      await ctx.answerPreCheckoutQuery(false, "مبلغ یا واحد پرداخت معتبر نیست.");
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
      console.warn("Rejected Telegram pre-checkout: payload user mismatch.");
      await ctx.answerPreCheckoutQuery(false, "این پرداخت برای شما صادر نشده است.");
      return;
    }

    await ctx.answerPreCheckoutQuery(true);
  });

  instance.on("message:successful_payment", async (ctx) => {
    const payment = ctx.message.successful_payment;
    const parsed = parseInvoicePayload(payment.invoice_payload);
    if (!parsed) {
      console.error("successful_payment with unparseable payload");
      return;
    }

    const plan = PLANS[parsed.plan];
    if (
      !plan ||
      payment.currency !== "XTR" ||
      payment.total_amount !== plan.starsPrice ||
      !payment.telegram_payment_charge_id
    ) {
      console.error("Telegram successful payment validation failed.");
      return;
    }

    const fromId = ctx.from?.id;
    if (!fromId) return;

    const payer = await prisma.user.findUnique({
      where: { telegramId: String(fromId) },
      select: { id: true },
    });
    if (!payer || payer.id !== parsed.userId) {
      console.error("Telegram successful payment user mismatch.");
      return;
    }

    const now = new Date();
    const registration = await prisma.$transaction(async (tx) => {
      await lockUserSubscriptions(tx, parsed.userId);
      const existing = await tx.subscription.findUnique({
        where: { providerPaymentId: payment.telegram_payment_charge_id },
        select: { id: true, userId: true, plan: true },
      });

      if (existing) {
        return {
          duplicate: true,
          samePayment: existing.userId === parsed.userId && existing.plan === plan.code,
        };
      }

      const period = await nextSubscriptionPeriod(
        tx,
        parsed.userId,
        plan.durationDays,
        now
      );
      await tx.subscription.create({
        data: {
          userId: parsed.userId,
          plan: plan.code,
          status: "ACTIVE",
          provider: "telegram_stars",
          providerPaymentId: payment.telegram_payment_charge_id,
          startedAt: period.startedAt,
          expiresAt: period.expiresAt,
        },
      });
      return {
        duplicate: false,
        samePayment: true,
        expiresAt: period.expiresAt,
      };
    });

    if (!registration.samePayment) {
      console.error("Telegram charge is already linked to a different subscription.");
      return;
    }

    if (registration.duplicate) {
      await ctx.reply("این پرداخت قبلاً ثبت شده است.");
      return;
    }

    const expiryLabel = registration.expiresAt
      ? registration.expiresAt.toLocaleDateString("fa-IR")
      : "نامحدود";
    await ctx.reply(
      `پرداخت با موفقیت انجام شد. اشتراک "${plan.titleFa}" شما تا ${expiryLabel} فعال است.`
    );
  });
}

export function getBot(): Bot {
  if (!bot) {
    bot = new Bot(env.TELEGRAM_BOT_TOKEN);
    registerPaymentHandlers(bot);
  }
  return bot;
}
