export const ACQUISITION_SEGMENTS = [
  "barbers",
  "salons",
  "beauty",
  "clinics",
] as const;

export type AcquisitionSegment = (typeof ACQUISITION_SEGMENTS)[number];
export type MarketingLocale = "en" | "fa" | "ar";

type SegmentCopy = {
  audience: Record<AcquisitionSegment, string>;
  pageTitle: (audience: string, segment: AcquisitionSegment) => string;
  description: (audience: string) => string;
  heading: (audience: string) => string;
  intro: (audience: string) => string;
  benefits: [string, string, string];
  freePlan: string;
  customersDoNotNeedTelegram: string;
  setupNote: string;
  cta: string;
  medicalNote: string;
};

const COPY: Record<MarketingLocale, SegmentCopy> = {
  en: {
    audience: {
      barbers: "barbershops",
      salons: "hair and beauty salons",
      beauty: "nail, makeup and other independent beauty professionals",
      clinics: "medical practices",
    },
    pageTitle: (audience, segment) =>
      segment === "beauty"
        ? "Online booking for nail & makeup pros | Bookora"
        : `Online booking for ${audience} | Bookora`,
    description: (audience) =>
      `Give clients of ${audience} a simple online booking page. List services, prices and available times; clients choose a slot from a regular web link.`,
    heading: (audience) => `Online appointment booking for ${audience}`,
    intro: (audience) =>
      `Publish your services and available times on one shareable booking page. Clients of ${audience} can choose a service and time without back-and-forth calls or messages.`,
    benefits: [
      "Share one public booking link that opens in a web browser.",
      "Set up your services, prices and working hours in one place.",
      "The free plan includes one business, unlimited services and bookings, with no per-booking fee.",
    ],
    freePlan: "Start with a free booking page",
    customersDoNotNeedTelegram:
      "Your clients book on a regular web page. They do not need a Telegram account or the Bookora app.",
    setupNote:
      "The setup button opens Bookora's Telegram bot for you to start setup. It does not send messages to customers or prospects.",
    cta: "Set up your free booking page",
    medicalNote:
      "For clinics, use Bookora for scheduling only. Do not enter diagnoses, medical histories or other sensitive health details in booking fields.",
  },
  fa: {
    audience: {
      barbers: "آرایشگاه‌های مردانه",
      salons: "سالن‌های مو و زیبایی",
      beauty: "ناخن‌کاران، میکاپ‌آرتیست‌ها و دیگر متخصصان مستقل زیبایی",
      clinics: "مطب‌ها و کلینیک‌ها",
    },
    pageTitle: (audience, segment) =>
      segment === "beauty"
        ? "نوبت‌دهی آنلاین ناخن‌کاران و میکاپ‌آرتیست‌ها | بوکورا"
        : `نوبت‌دهی آنلاین ${audience} | بوکورا`,
    description: (audience) =>
      `برای ${audience} یک صفحه ساده رزرو آنلاین بسازید. خدمات، قیمت و زمان‌های خالی را نمایش دهید تا مشتری از طریق یک لینک وب زمان مناسب را انتخاب کند.`,
    heading: (audience) => `نوبت‌دهی آنلاین برای ${audience}`,
    intro: (audience) =>
      `خدمات و زمان‌های خالی را در یک صفحه رزرو قابل‌اشتراک منتشر کنید. مشتریان ${audience} بدون تماس و پیام‌های رفت‌وبرگشتی، خدمت و زمان مناسب را انتخاب می‌کنند.`,
    benefits: [
      "یک لینک عمومی رزرو بسازید که در مرورگر باز می‌شود.",
      "خدمات، قیمت‌ها و ساعت کاری را در یک جا تنظیم کنید.",
      "پلن رایگان شامل یک کسب‌وکار، خدمات و رزرو نامحدود و بدون کارمزد به‌ازای هر رزرو است.",
    ],
    freePlan: "با یک صفحه رزرو رایگان شروع کنید",
    customersDoNotNeedTelegram:
      "مشتریان از یک صفحه معمولی وب رزرو می‌کنند و به حساب تلگرام یا نصب برنامه بوکورا نیاز ندارند.",
    setupNote:
      "دکمه راه‌اندازی، ربات تلگرام بوکورا را برای شروع کار خودتان باز می‌کند؛ هیچ پیامی برای مشتریان یا مخاطبان احتمالی ارسال نمی‌شود.",
    cta: "ساخت صفحه رزرو رایگان",
    medicalNote:
      "برای مطب‌ها، بوکورا را فقط برای زمان‌بندی نوبت به‌کار ببرید. تشخیص، سابقه پزشکی یا اطلاعات حساس سلامت را در فیلدهای رزرو وارد نکنید.",
  },
  ar: {
    audience: {
      barbers: "صالونات الحلاقة",
      salons: "صالونات الشعر والتجميل",
      beauty: "متخصصات الأظافر والمكياج وغيرهن من مختصات التجميل المستقلات",
      clinics: "العيادات والممارسات الطبية",
    },
    pageTitle: (audience, segment) =>
      segment === "beauty"
        ? "حجز المواعيد عبر الإنترنت للأظافر والمكياج | Bookora"
        : `حجز المواعيد عبر الإنترنت لـ ${audience} | Bookora`,
    description: (audience) =>
      `أنشئ صفحة حجز بسيطة لـ ${audience}. اعرض الخدمات والأسعار والأوقات المتاحة، ليختار العملاء الموعد عبر رابط ويب عادي.`,
    heading: (audience) => `حجز المواعيد عبر الإنترنت لـ ${audience}`,
    intro: (audience) =>
      `انشر خدماتك وأوقاتك المتاحة في صفحة حجز واحدة قابلة للمشاركة. يمكن للعملاء اختيار الخدمة والوقت دون مكالمات أو رسائل متبادلة.`,
    benefits: [
      "شارك رابط حجز عام يفتح في متصفح الويب.",
      "أضف الخدمات والأسعار وساعات العمل في مكان واحد.",
      "تشمل الخطة المجانية نشاطاً واحداً وخدمات وحجوزات غير محدودة، دون رسوم لكل حجز.",
    ],
    freePlan: "ابدأ بصفحة حجز مجانية",
    customersDoNotNeedTelegram:
      "يحجز عملاؤك عبر صفحة ويب عادية، ولا يحتاجون إلى حساب Telegram أو تطبيق Bookora.",
    setupNote:
      "يفتح زر الإعداد روبوت Bookora على Telegram لتبدأ إعدادك بنفسك؛ ولا يرسل أي رسائل إلى العملاء أو العملاء المحتملين.",
    cta: "أنشئ صفحة الحجز المجانية",
    medicalNote:
      "استخدم Bookora في العيادات لجدولة المواعيد فقط. لا تدخل التشخيصات أو السجلات الطبية أو أي بيانات صحية حساسة في حقول الحجز.",
  },
};

export type AcquisitionPageCopy = {
  audience: string;
  pageTitle: string;
  description: string;
  heading: string;
  intro: string;
  benefits: [string, string, string];
  freePlan: string;
  customersDoNotNeedTelegram: string;
  setupNote: string;
  cta: string;
  medicalNote: string | null;
};

export function getAcquisitionPageCopy(
  locale: MarketingLocale,
  segment: AcquisitionSegment
): AcquisitionPageCopy {
  const copy = COPY[locale];
  const audience = copy.audience[segment];

  return {
    audience,
    pageTitle: copy.pageTitle(audience, segment),
    description: copy.description(audience),
    heading: copy.heading(audience),
    intro: copy.intro(audience),
    benefits: copy.benefits,
    freePlan: copy.freePlan,
    customersDoNotNeedTelegram: copy.customersDoNotNeedTelegram,
    setupNote: copy.setupNote,
    cta: copy.cta,
    medicalNote: segment === "clinics" ? copy.medicalNote : null,
  };
}
