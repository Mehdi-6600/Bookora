import { getBot } from "@/lib/telegram/bot";

export async function notifyUser(
  telegramId: string,
  text: string,
  options?: { parseMode?: "HTML" | "Markdown" }
): Promise<void> {
  try {
    const bot = getBot();
    await bot.api.sendMessage(telegramId, text, {
      parse_mode: options?.parseMode,
    });
  } catch (error) {
    const err = error as { error_code?: number; description?: string };
    if (err && err.error_code === 403) {
      console.warn("notifyUser: Telegram user blocked the bot");
    } else {
      console.error(
        "notifyUser failed:",
        error instanceof Error ? error.name : "UnknownError"
      );
    }
  }
}

export type DeliveryResult =
  | { ok: true; messageId: number }
  | { ok: false; errorCode?: number; error: string; blocked: boolean };

/**
 * Send a message and report the outcome instead of swallowing it.
 *
 * Only ever call this for recipients who have an established messaging
 * relationship with the bot (they pressed Start). Telegram rejects messages to
 * everyone else with 403 "bot can't initiate conversation with a user".
 */
export async function deliverTelegramMessage(
  telegramId: string,
  text: string
): Promise<DeliveryResult> {
  try {
    const bot = getBot();
    const message = await bot.api.sendMessage(telegramId, text);
    return { ok: true, messageId: message.message_id };
  } catch (error) {
    const err = error as {
      error_code?: number;
      description?: string;
      name?: string;
    };

    const errorCode = typeof err?.error_code === "number" ? err.error_code : undefined;

    // Log the error class and code only - never the recipient or the body.
    console.error(
      "deliverTelegramMessage failed:",
      err?.name ?? "UnknownError",
      errorCode ?? "-"
    );

    return {
      ok: false,
      errorCode,
      error:
        errorCode === 403
          ? "Recipient has not started the bot or blocked it."
          : errorCode === 429
          ? "Telegram rate limit reached."
          : "Delivery failed.",
      blocked: errorCode === 403,
    };
  }
}
