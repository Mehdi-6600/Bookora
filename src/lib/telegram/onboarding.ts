import { InlineKeyboard } from "grammy";
import { env } from "@/lib/env";
import { normalizeLanguage, type OutreachLanguage } from "@/lib/outreach/types";

/**
 * Localized onboarding copy for the Telegram bot.
 *
 * The bot is the front door for every invited business owner, so the copy has
 * to explain Bookora in one or two sentences and then give a single, obvious
 * next action: open the Mini App and create the business.
 */

export function miniAppUrl(language: OutreachLanguage = "en"): string {
  const base = env.APP_URL.replace(/\/+$/, "");
  // next-intl uses `localePrefix: "as-needed"`, so English has no prefix.
  return language === "en" ? `${base}/app` : `${base}/${language}/app`;
}

export function bookingPageUrl(slug: string, language: OutreachLanguage = "en"): string {
  const base = env.APP_URL.replace(/\/+$/, "");
  return language === "en"
    ? `${base}/book/${slug}`
    : `${base}/${language}/book/${slug}`;
}

export const WELCOME: Record<OutreachLanguage, string> = {
  en: [
    "Welcome to Bookora 👋",
    "",
    "Bookora gives your business a booking page: your customers pick a service and a free time, and the booking lands in your dashboard.",
    "",
    "Free for one business. Setup takes about 2 minutes:",
    "1️⃣ Create your business",
    "2️⃣ Add a service and its price",
    "3️⃣ Set your working hours",
    "4️⃣ Share your booking link",
  ].join("\n"),
  fa: [
    "به بوکورا خوش آمدید 👋",
    "",
    "بوکورا یک صفحه‌ی رزرو آنلاین به کسب‌وکار شما می‌ده: مشتری‌هاتون سرویس و زمان خالی رو انتخاب می‌کنن و رزرو مستقیم توی پنل شما ثبت می‌شه.",
    "",
    "برای یک کسب‌وکار رایگانه و راه‌اندازیش حدود دو دقیقه طول می‌کشه:",
    "۱️⃣ ساخت کسب‌وکار",
    "۲️⃣ افزودن سرویس و قیمت",
    "۳️⃣ تنظیم ساعات کاری",
    "۴️⃣ اشتراک لینک رزرو",
  ].join("\n"),
  ar: [
    "مرحباً بك في Bookora 👋",
    "",
    "يمنحك Bookora صفحة حجز: يختار عملاؤك الخدمة والوقت المناسب، ويصل الحجز مباشرة إلى لوحتك.",
    "",
    "مجاني لنشاط واحد، والإعداد يستغرق حوالي دقيقتين:",
    "1️⃣ أنشئ نشاطك",
    "2️⃣ أضف خدمة وسعرها",
    "3️⃣ حدد ساعات العمل",
    "4️⃣ شارك رابط الحجز",
  ].join("\n"),
};

export const START_BUTTON: Record<OutreachLanguage, string> = {
  en: "Start setup",
  fa: "شروع راه‌اندازی",
  ar: "ابدأ الإعداد",
};

export const HELP: Record<OutreachLanguage, string> = {
  en: [
    "Bookora — online booking for small service businesses.",
    "",
    "/start — open your panel and continue setup",
    "/help — this message",
    "/stop — stop receiving messages from Bookora",
    "",
    "Your booking link is shown in the panel after you create a business.",
  ].join("\n"),
  fa: [
    "بوکورا — رزرو آنلاین برای کسب‌وکارهای خدماتی کوچک.",
    "",
    "/start — باز کردن پنل و ادامه‌ی راه‌اندازی",
    "/help — همین راهنما",
    "/stop — توقف دریافت پیام از بوکورا",
    "",
    "لینک رزرو بعد از ساخت کسب‌وکار در پنل نمایش داده می‌شه.",
  ].join("\n"),
  ar: [
    "Bookora — حجز عبر الإنترنت للأنشطة الخدمية الصغيرة.",
    "",
    "/start — فتح اللوحة ومتابعة الإعداد",
    "/help — هذه الرسالة",
    "/stop — إيقاف استلام الرسائل من Bookora",
    "",
    "سيظهر رابط الحجز في اللوحة بعد إنشاء النشاط.",
  ].join("\n"),
};

export const STOPPED: Record<OutreachLanguage, string> = {
  en: "You're unsubscribed. Bookora won't message you again. Send /start any time to come back.",
  fa: "اشتراک پیام شما لغو شد. بوکورا دیگه پیامی نمی‌فرسته. هر وقت خواستید با /start برگردید.",
  ar: "تم إلغاء اشتراكك في الرسائل. لن يرسل لك Bookora رسائل مرة أخرى. أرسل /start في أي وقت للعودة.",
};

export function welcomeKeyboard(language: OutreachLanguage): InlineKeyboard {
  return new InlineKeyboard().webApp(START_BUTTON[language], miniAppUrl(language));
}

export function languageFor(languageCode: string | undefined): OutreachLanguage {
  return normalizeLanguage(languageCode);
}
