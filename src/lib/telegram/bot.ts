import { Bot } from "grammy";
import { env } from "@/lib/env";

let bot: Bot | null = null;

export function getBot(): Bot {
  if (!bot) {
    bot = new Bot(env.TELEGRAM_BOT_TOKEN);
  }
  return bot;
}
