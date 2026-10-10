import { Bot, InlineKeyboard } from "grammy";
import { Prisma } from "@prisma/client";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { PLANS, parseInvoicePayload } from "@/lib/subscription/plans";
import { parseStartPayload } from "@/lib/outreach/deeplink";
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

let bot: Bot | null = null;

/**
 * Record a bot start for attribution.
 *
 * Stores the numeric Telegram id, the resolved user id and the start
 * parameter. No message content and no personal profile data are stored.
 */
async function recordBotStart(input: {
  telegramId: string;
  startParam: string | undefined;
}): Promise<void> {
  try {
    const payload = parseStartPayload(input.startParam);

    const user = await prisma.user.findUnique({
      where: { telegramId: input.telegramId },
      select: { id: true },
    });

    let prospectId: string | null = null;
    let campaignId: string | null = null;

    if (payload.kind === "prospect") {
      const invitation = await prisma.outreachInvitation.findUnique({
        where: { startParam: input.startParam ?? "" },
        select: { id: true, prospectId: true, campaignId: true },
      });

      if (invitation) {
        prospectId = invitation.prospectId;
        campaignId = invitation.campaignId;

        await prisma.outreachProspect.update({
          where: { id: invitation.prospectId },
          data: {
            status: "STARTED_BOT",
            convertedUserId: user?.id ?? null,
          },
        });

        await prisma.outreachInvitation.update({
          where: { id: invitation.id },
          data: { deliveredAt: new Date() },
        });
      }
    } else if (payload.kind === "campaign") {
      const campaign = await prisma.outreachCampaign.findUnique({
        where: { code: payload.code },
        select: { id: true },
      });
      campaignId = campaign?.id ?? null;
    }

    await prisma.botStart.create({
      data: {
        telegramId: input.telegramId,
        userId: user?.id ?? null,
        startParam: input.startParam ?? null,
        prospectId,
        campaignId,
        wasExistingUser: Boolean(user),
      },
    });
  } catch (error) {
    // Attribution must never break the /start response.
    console.error(
      "recordBotStart failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
  }
}

function registerOnboardingHandlers(instance: Bot) {
  instance.command("start", async (ctx) => {
    if (ctx.chat.type !== "private") return;

    const language = languageFor(ctx.from?.language_code);
    const startParam = ctx.match && ctx.match.length > 0 ? ctx.match.trim() : undefined;

    if (ctx.from) {
      // Awaited: on serverless the invocation can end as soon as the response
      // is returned, which would drop the attribution write.
      await recordBotStart({
        telegramId: String(ctx.from.id),
        startParam,
      });
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
      await recordOptOut({
        telegramId: String(ctx.from.id),
        telegramUsername: ctx.from.username ?? null,
        note: "Opted out via /stop",
      });
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
