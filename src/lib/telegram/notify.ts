import { getBot } from "@/lib/telegram/bot";

export async function notifyUser(
  telegramId: string,
  text: string
): Promise<void> {
  try {
    const bot = getBot();
    await bot.api.sendMessage(telegramId, text);
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
