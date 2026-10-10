import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { getClientIp } from "@/lib/get-client-ip";

/**
 * Privacy-conscious acquisition funnel.
 *
 * Design rules:
 *  - No raw IP address, no user-agent string, no cookies and no Telegram
 *    payload is ever persisted.
 *  - `anonId` is a salted hash of (IP + user-agent + date). The salt rotates
 *    daily, so the same visitor has a different id tomorrow and cannot be
 *    tracked across days.
 *  - Only the 9 funnnel steps required to measure onboarding are recorded.
 */

/**
 * The 11 activation milestones tracked by the acquisition campaign.
 *
 * Order matters: this is the funnel an owner walks from first hearing about
 * Bookora through to their first real customer booking and, later, a paid
 * conversion.
 */
export const FUNNEL_EVENTS = [
  "landing_view", // 1. Landing page visit
  "campaign_view", // 2. Campaign-specific visit (attributed link)
  "signup_cta_click", // 3. Signup CTA click
  "signup_started", // 4. Signup started (bot /start or Mini App open)
  "registration_completed", // 5. Registration completed
  "business_created", // 6. Business profile created
  "service_created", // 7. At least one service configured
  "working_hours_configured", // 8. At least one available slot configured
  "booking_link_opened", // 9. Public booking page published / opened
  "booking_created", // 10. First real customer booking completed
  "paid_conversion", // 11. Paid conversion (verified only)
] as const;

export type FunnelEventName = (typeof FUNNEL_EVENTS)[number];

export function isFunnelEvent(value: unknown): value is FunnelEventName {
  return (
    typeof value === "string" &&
    (FUNNEL_EVENTS as readonly string[]).includes(value)
  );
}

/** Ordered funnel used by the admin dashboard. */
export const FUNNEL_STEP_LABELS: Record<
  FunnelEventName,
  { en: string; fa: string }
> = {
  landing_view: { en: "1. Landing page visit", fa: "۱. بازدید صفحه اصلی" },
  campaign_view: { en: "2. Campaign visit", fa: "۲. بازدید از کمپین" },
  signup_cta_click: { en: "3. Signup CTA click", fa: "۳. کلیک روی دکمه ثبت‌نام" },
  signup_started: { en: "4. Signup started", fa: "۴. شروع ثبت‌نام" },
  registration_completed: { en: "5. Registration completed", fa: "۵. تکمیل ثبت‌نام" },
  business_created: { en: "6. Business profile created", fa: "۶. ساخت پروفایل کسب‌وکار" },
  service_created: { en: "7. First service configured", fa: "۷. تعریف اولین سرویس" },
  working_hours_configured: { en: "8. Available slots configured", fa: "۸. تنظیم زمان‌های آزاد" },
  booking_link_opened: { en: "9. Booking page published", fa: "۹. انتشار صفحه رزرو" },
  booking_created: { en: "10. First real booking", fa: "۱۰. اولین رزرو واقعی" },
  paid_conversion: { en: "11. Paid conversion", fa: "۱۱. تبدیل به پرداخت" },
};

const SALT_SECRET =
  process.env.JWT_SECRET ?? "bookora-funnel-local-salt-not-for-production";

/**
 * Non-reversible, daily-rotating visitor identifier.
 * Exported for tests only - never log or return it to a client.
 */
export function buildAnonId(input: {
  ip: string;
  userAgent: string;
  date: string;
}): string {
  const dailySalt = createHash("sha256")
    .update(`${SALT_SECRET}:${input.date}`)
    .digest("hex");

  return createHash("sha256")
    .update(`${dailySalt}|${input.ip}|${input.userAgent}`)
    .digest("hex")
    .slice(0, 32);
}

export type RecordFunnelInput = {
  event: FunnelEventName;
  ip: string;
  userAgent: string;
  locale?: string | null;
  ref?: string | null;
  /** Campaign code, when the visit came from an attributed campaign link. */
  campaignId?: string | null;
  now?: Date;
};

export async function recordFunnelEvent(
  input: RecordFunnelInput
): Promise<void> {
  const now = input.now ?? new Date();
  const date = now.toISOString().slice(0, 10);

  const anonId = buildAnonId({
    ip: input.ip,
    userAgent: input.userAgent,
    date,
  });

  try {
    await prisma.funnelEvent.create({
      data: {
        event: input.event,
        anonId,
        locale: input.locale ? input.locale.slice(0, 8) : null,
        ref: input.ref ? input.ref.slice(0, 64) : null,
        campaignId: input.campaignId ? input.campaignId.slice(0, 64) : null,
      },
    });
  } catch (error) {
    // Analytics must never break a user-facing request.
    console.error(
      "recordFunnelEvent failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
  }
}

/** Convenience wrapper for Next.js route handlers. */
export async function trackFromRequest(
  request: { headers: Headers; url?: string },
  event: FunnelEventName,
  extra?: { locale?: string | null; ref?: string | null; campaignId?: string | null }
): Promise<void> {
  const ip = getClientIp(request as Parameters<typeof getClientIp>[0]);
  const userAgent = request.headers.get("user-agent") ?? "";

  await recordFunnelEvent({
    event,
    ip,
    userAgent,
    locale: extra?.locale ?? null,
    ref: extra?.ref ?? null,
    campaignId: extra?.campaignId ?? null,
  });
}

export async function getFunnelSummary(options: {
  since: Date;
}): Promise<Array<{ event: string; count: number }>> {
  const rows = await prisma.funnelEvent.groupBy({
    by: ["event"],
    where: { createdAt: { gte: options.since } },
    _count: { _all: true },
  });

  return rows.map((row) => ({ event: row.event, count: row._count._all }));
}
