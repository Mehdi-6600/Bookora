import type { ProspectCategory } from "@/lib/outreach/types";

/**
 * Invitation templates.
 *
 * A template is a plain-text body with `{businessName}`, `{link}` and
 * `{category}` placeholders. The rendered result is what an administrator
 * reviews and approves before any outreach happens.
 */

export const TEMPLATE_PLACEHOLDERS = [
  "{businessName}",
  "{link}",
  "{category}",
] as const;

export type TemplateVariables = {
  businessName: string;
  link: string;
  categoryLabel: string;
};

/** Replace known placeholders and drop any unknown `{...}` token. */
export function renderTemplate(body: string, vars: TemplateVariables): string {
  return body
    .replace(/\{businessName\}/g, vars.businessName)
    .replace(/\{link\}/g, vars.link)
    .replace(/\{category\}/g, vars.categoryLabel)
    .replace(/\{[a-zA-Z]+\}/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Reject an invitation that carries no link at all — an invitation without a
 * link cannot convert. `{link}` (the per-recipient bot deep link) or an
 * explicit http(s) URL baked into the body both count; a channel/contact-only
 * message prepared by the campaign builder is legitimate.
 */
export function validateTemplateBody(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed.length === 0) return "template.empty";
  if (trimmed.length > 1500) return "template.tooLong";
  if (trimmed.includes("{link}")) return null;
  if (/https?:\/\/\S+/i.test(trimmed)) return null;
  return "template.missingLink";
}

export const CATEGORY_LABELS: Record<ProspectCategory, { en: string; fa: string; ar: string }> = {
  BARBER: { en: "barbershop", fa: "آرایشگاه مردانه", ar: "صالون حلاقة" },
  BEAUTY: { en: "beauty salon", fa: "سالن زیبایی", ar: "صالون تجميل" },
  MEDICAL: { en: "clinic", fa: "کلینیک", ar: "عيادة" },
  OTHER: { en: "business", fa: "کسب‌وکار", ar: "نشاط تجاري" },
};

export function categoryLabel(
  category: ProspectCategory,
  language: "en" | "fa" | "ar"
): string {
  return CATEGORY_LABELS[category]?.[language] ?? CATEGORY_LABELS.OTHER[language] ?? "";
}

export const DEFAULT_TEMPLATES: Array<{
  code: string;
  language: "en" | "fa" | "ar";
  category: ProspectCategory | "ALL";
  body: string;
}> = [
  {
    code: "invite_en_default",
    language: "en",
    category: "ALL",
    body: [
      "Hi {businessName} 👋",
      "",
      "I'm building Bookora — a simple online booking page for {category} owners. Your customers pick a service and a free time, and you get the booking on your phone.",
      "",
      "It's free for one business. Setup takes about 2 minutes and you get a shareable link you can put in your bio.",
      "",
      "Open it here 👉 {link}",
      "",
      "Reply STOP any time and I won't message you again.",
    ].join("\n"),
  },
  {
    code: "invite_fa_default",
    language: "fa",
    category: "ALL",
    body: [
      "سلام {businessName} عزیز 👋",
      "",
      "من بوکورا (Bookora) رو می‌سازم؛ یک صفحه‌ی رزرو آنلاین ساده برای {category}. مشتری‌هاتون سرویس و زمان خالی رو انتخاب می‌کنن و رزرو مستقیم براتون پیام میاد.",
      "",
      "برای یک کسب‌وکار کاملاً رایگانه و راه‌اندازیش حدود دو دقیقه طول می‌کشه. آخرش یک لینک می‌گیرید که می‌تونید توی بیو یا کانال بذارید.",
      "",
      "از این لینک وارد بشید 👉 {link}",
      "",
      "هر وقت نخواستید، با فرستادن STOP دیگه پیامی براتون نمی‌فرستم.",
    ].join("\n"),
  },
  {
    code: "invite_ar_default",
    language: "ar",
    category: "ALL",
    body: [
      "مرحباً {businessName} 👋",
      "",
      "أبني Bookora — صفحة حجز بسيطة عبر الإنترنت لأصحاب {category}. يختار عملاؤك الخدمة والوقت المناسب، ويصلك الحجز مباشرة.",
      "",
      "مجاني لنشاط واحد، والإعداد يستغرق حوالي دقيقتين، وستحصل على رابط تشاركه في حسابك.",
      "",
      "افتح الرابط من هنا 👉 {link}",
      "",
      "أرسل STOP في أي وقت ولن أراسلك مرة أخرى.",
    ].join("\n"),
  },
  {
    code: "followup_en_default",
    language: "en",
    category: "ALL",
    body: [
      "Hi {businessName} — just following up on my last message.",
      "",
      "Bookora gives you a booking link your customers can use any time, and it's free for one {category}. If it's not a fit, no problem at all — just say so and I'll stop.",
      "",
      "{link}",
      "",
      "Reply STOP to opt out.",
    ].join("\n"),
  },
  {
    code: "followup_fa_default",
    language: "fa",
    category: "ALL",
    body: [
      "سلام {businessName} — پیام قبلی رو پیگیری می‌کنم.",
      "",
      "با بوکورا یک لینک رزرو دارید که مشتری‌هاتون هر ساعتی می‌تونن استفاده کنن، و برای یک {category} رایگانه. اگه مناسب‌تون نیست مشکلی نیست؛ بگید تا دیگه مزاحم نشم.",
      "",
      "{link}",
      "",
      "برای لغو، STOP رو بفرستید.",
    ].join("\n"),
  },
];
