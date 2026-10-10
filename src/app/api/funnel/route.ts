import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isFunnelEvent } from "@/lib/funnel";
import { recordFunnelEvent } from "@/lib/funnel";
import { getClientIp } from "@/lib/get-client-ip";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";

const bodySchema = z.object({
  event: z.string().refine(isFunnelEvent, "unknown funnel event"),
  locale: z.string().trim().max(8).nullable().optional(),
  ref: z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/)
    .nullable()
    .optional(),
});

/**
 * Privacy-conscious funnel beacon.
 *
 * Accepts only an event name, a locale and a non-personal attribution code.
 * The visitor identifier is a daily-rotating salted hash computed server-side;
 * no IP address, user agent or personal data is persisted.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  if (await isRateLimited(`funnel:${ip}`, 120, 10 * 60 * 1000)) {
    // Silent success: analytics must not surface rate limiting to visitors.
    return NextResponse.json(
      { ok: true },
      { status: 202, headers: { "Cache-Control": "no-store" } }
    );
  }
  triggerRateLimitCleanup();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  await recordFunnelEvent({
    event: parsed.data.event,
    ip,
    userAgent: req.headers.get("user-agent") ?? "",
    locale: parsed.data.locale ?? null,
    ref: parsed.data.ref ?? null,
  });

  return NextResponse.json(
    { ok: true },
    { status: 202, headers: { "Cache-Control": "no-store" } }
  );
}
