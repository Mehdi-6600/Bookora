import { Bot } from "grammy";
import { Prisma } from "@prisma/client";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { PLANS, parseInvoicePayload } from "@/lib/subscription/plans";

let bot: Bot | null = null;

function registerPaymentHandlers(instance: Bot) {
  instance.on("pre_checkout_query", async (ctx) => {
    const query = ctx.preCheckoutQuery;
    const parsed = parseInvoicePayload(query.invoice_payload);

    if (!parsed) {
      await ctx.answerPreCheckoutQuery(false, "اطلاعات پرداخت نامعتبر است.");
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

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000
    );

    const existing = await prisma.subscription.findFirst({
      where: { providerPaymentId: payment.telegram_payment_charge_id },
      select: { id: true },
    });

    if (existing) {
      await ctx.reply("این پرداخت قبلاً ثبت شده است.");
      return;
    }

    try {
      await prisma.subscription.create({
        data: {
          userId: parsed.userId,
          plan: plan.code,
          status: "ACTIVE",
          provider: "telegram_stars",
          providerPaymentId: payment.telegram_payment_charge_id,
          startedAt: now,
          expiresAt: expiresAt,
        },
      });

      await ctx.reply(
        `پرداخت با موفقیت انجام شد. اشتراک "${plan.titleFa}" شما تا ${expiresAt.toLocaleDateString(
          "fa-IR"
        )} فعال است.`
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
    registerPaymentHandlers(bot);
  }
  return bot;
}
