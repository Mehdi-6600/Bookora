import { Bot } from "grammy";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { PLANS, parseInvoicePayload } from "@/lib/subscription/plans";

let bot: Bot | null = null;

function registerPaymentHandlers(instance: Bot) {
  instance.on("pre_checkout_query", async (ctx) => {
    const parsed = parseInvoicePayload(ctx.preCheckoutQuery.invoice_payload);

    if (!parsed) {
      await ctx.answerPreCheckoutQuery(false, "اطلاعات پرداخت نامعتبر است.");
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

    const plan = PLANS[parsed.plan];
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000
    );

    try {
      await prisma.subscription.create({
        data: {
          userId: parsed.userId,
          plan: plan.code,
          status: "ACTIVE",
          provider: "telegram_stars",
          providerPaymentId: payment.telegram_payment_charge_id,
          startedAt: now,
          expiresAt,
        },
      });

      await ctx.reply(
        `پرداخت با موفقیت انجام شد. اشتراک "${plan.titleFa}" شما تا ${expiresAt.toLocaleDateString(
          "fa-IR"
        )} فعال است.`
      );
    } catch (error) {
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
