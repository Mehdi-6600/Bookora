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

export const FUNNEL_EVENTS = [
  "landing_view",
  "start_click",
  "mini_app_launch",
  "auth_success",
  "business_created",
  "service_created",
  "working_hours_configured",
  "booking_link_opened",
  "booking_created",
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
  landing_view: { en: "Landing view", fa: "بازدید صفحه اصلی" },
  start_click: { en: "Start button click", fa: "کلیک روی شروع" },
  mini_app_launch: { en: "Mini App launch", fa: "اجرای مینی‌اپ" },
  auth_success: { en: "Auth success", fa: "ورود موفق" },
  business_created: { en: "Business created", fa: "ساخت کسب‌وکار" },
  service_created: { en: "First service created", fa: "ساخت اولین سرویس" },
  working_hours_configured: { en: "Working hours configured", fa: "تنظیم ساعات کاری" },
  booking_link_opened: { en: "Booking link opened", fa: "باز شدن لینک رزرو" },
  booking_created: { en: "First booking created", fa: "اولین رزرو" },
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
  extra?: { locale?: string | null; ref?: string | null }
): Promise<void> {
  const ip = getClientIp(request as Parameters<typeof getClientIp>[0]);
  const userAgent = request.headers.get("user-agent") ?? "";

  await recordFunnelEvent({
    event,
    ip,
    userAgent,
    locale: extra?.locale ?? null,
    ref: extra?.ref ?? null,
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
