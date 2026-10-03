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

const bodySchema = z.object({
  initData: z.string().min(1).max(10_000),
});

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  // حداکثر ۲۰ تلاش ورود در ۱۰ دقیقه از هر IP.
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
    // Telegram Web Mini Apps may run in a cross-site iframe, where Lax cookies
    // are omitted. State-changing APIs enforce an exact trusted Origin check.
    sameSite: "none",
    maxAge: THIRTY_DAYS_SECONDS,
    path: "/",
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
