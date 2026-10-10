import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { validateInitData } from "@/lib/telegram/initData";
import { signSession } from "@/lib/auth/jwt";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { cookies } from "next/headers";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";
import { adminTelegramIds, adminTelegramIdsConfigured } from "@/lib/env";
import { recordFunnelEvent } from "@/lib/funnel";
import { recordAttributedStart } from "@/lib/outreach/attribution";

const bodySchema = z.object({
  initData: z.string().min(1).max(10_000),
});

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  if (await isRateLimited(`auth:${ip}`, 20, 10 * 60 * 1000)) {
    return NextResponse.json(
      { error: "درخواست‌های زیاد. کمی صبر کنید." },
      { status: 429 }
    );
  }

  triggerRateLimitCleanup();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  let validated;
  try {
    validated = validateInitData(parsed.data.initData);
  } catch (err) {
    console.warn(
      "Rejected Telegram initData:",
      err instanceof Error ? err.name : "UnknownError"
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tg = validated.user;
  const isConfiguredAdmin = adminTelegramIds.includes(BigInt(tg.id));

  const user = await prisma.user.upsert({
    where: { telegramId: String(tg.id) },
    update: {
      telegramUsername: tg.username ?? null,
      firstName: tg.first_name,
      lastName: tg.last_name ?? null,
      languageCode: tg.language_code ?? null,
      ...(adminTelegramIdsConfigured ? { isAdmin: isConfiguredAdmin } : {}),
    },
    create: {
      telegramId: String(tg.id),
      telegramUsername: tg.username ?? null,
      firstName: tg.first_name,
      lastName: tg.last_name ?? null,
      languageCode: tg.language_code ?? null,
      isAdmin: isConfiguredAdmin,
    },
    include: {
      businesses: {
        select: { id: true, slug: true, name: true, status: true },
      },
    },
  });

  const token = await signSession({
    userId: user.id,
    telegramId: user.telegramId,
    isAdmin: user.isAdmin,
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: THIRTY_DAYS_SECONDS,
    path: "/",
  });

  // Attribution: Telegram puts the deep-link `start` parameter inside the
  // *signed* initData, so reading it here is safe and is what preserves the
  // campaign / prospect attribution through the authentication redirect.
  // Without this the parameter was lost as soon as the Mini App authenticated.
  const startParam = validated.raw.get("start_param") ?? undefined;
  if (startParam) {
    await recordAttributedStart({
      telegramId: String(tg.id),
      startParam,
    });
  }

  // Funnel: registration completed. Server-side so it cannot be spoofed.
  await recordFunnelEvent({
    event: "registration_completed",
    ip: getClientIp(req),
    userAgent: req.headers.get("user-agent") ?? "",
    ref: startParam ?? null,
    campaignId: null,
  });

  return NextResponse.json({
    user: {
      id: user.id,
      telegramId: user.telegramId,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.telegramUsername,
      languageCode: user.languageCode,
      isAdmin: user.isAdmin,
    },
    businesses: user.businesses,
  });
}
