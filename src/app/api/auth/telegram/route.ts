import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { validateInitData } from "@/lib/telegram/initData";
import { signSession } from "@/lib/auth/jwt";
import { cookies } from "next/headers";

const bodySchema = z.object({
  initData: z.string().min(1),
});

const SESSION_COOKIE = "bookora_session";
const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

export async function POST(req: NextRequest) {
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
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Unauthorized", reason: message },
      { status: 401 }
    );
  }

  const tg = validated.user;

  const user = await prisma.user.upsert({
    where: { telegramId: String(tg.id) },
    update: {
      telegramUsername: tg.username ?? null,
      firstName: tg.first_name,
      lastName: tg.last_name ?? null,
      languageCode: tg.language_code ?? null,
    },
    create: {
      telegramId: String(tg.id),
      telegramUsername: tg.username ?? null,
      firstName: tg.first_name,
      lastName: tg.last_name ?? null,
      languageCode: tg.language_code ?? null,
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
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
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
