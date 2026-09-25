import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { validateInitData } from "@/lib/telegram/initData";

const bodySchema = z.object({
  initData: z.string().min(1),
});

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
    where: { telegramId: BigInt(tg.id) },
    update: {
      telegramUsername: tg.username ?? null,
      firstName: tg.first_name,
      lastName: tg.last_name ?? null,
      languageCode: tg.language_code ?? null,
    },
    create: {
      telegramId: BigInt(tg.id),
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

  return NextResponse.json({
    user: {
      id: user.id,
      telegramId: user.telegramId.toString(),
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.telegramUsername,
      languageCode: user.languageCode,
      isAdmin: user.isAdmin,
    },
    businesses: user.businesses,
  });
}
