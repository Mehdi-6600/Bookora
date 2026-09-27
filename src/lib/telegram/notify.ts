import { getBot } from "@/lib/telegram/bot";

// این تابع هیچ‌وقت نباید باعث Fail شدن عملیات اصلی (مثلاً ثبت Booking) بشود؛
// اگر ارسال پیام تلگرام به هر دلیلی (بلاک‌شدن ربات توسط کاربر، خطای شبکه) شکست
// بخورد، فقط لاگ می‌شود و در سکوت ادامه پیدا می‌کند.
export async function notifyUser(
  telegramId: string,
  text: string
): Promise<void> {
  try {
    const bot = getBot();
    await bot.api.sendMessage(telegramId, text);
  } catch (error) {
    console.error(`notifyUser failed for ${telegramId}:`, error);
  }
}
