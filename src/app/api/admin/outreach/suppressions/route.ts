import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { buildSuppressionIdentifier, normalizeTelegramUsername } from "@/lib/outreach/normalize";

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const suppressions = await prisma.outreachSuppression.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, identifier: true, reason: true, note: true, createdAt: true },
  });

  return NextResponse.json(
    { suppressions },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const createSchema = z.object({
  telegramUsername: z.string().trim().max(64).nullable().optional(),
  publicUrl: z.string().trim().max(500).nullable().optional(),
  telegramId: z.string().trim().max(32).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (await isRateLimited(`outreach-suppress:${guard.user.id}`, 120, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  triggerRateLimitCleanup();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const identifier = buildSuppressionIdentifier({
    telegramUsername: normalizeTelegramUsername(parsed.data.telegramUsername),
    publicUrl: parsed.data.publicUrl ?? null,
    telegramId: parsed.data.telegramId ?? null,
  });

  if (!identifier) {
    return NextResponse.json(
      { error: "Provide a Telegram username, a public URL or a Telegram id." },
      { status: 400 }
    );
  }

  const row = await prisma.outreachSuppression.upsert({
    where: { identifier },
    update: { note: parsed.data.note ?? null, reason: "MANUAL" },
    create: { identifier, reason: "MANUAL", note: parsed.data.note ?? null },
  });

  return NextResponse.json({ suppression: row }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const id = req.nextUrl.searchParams.get("id");
  if (!id || id.length > 100) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await prisma.outreachSuppression.delete({ where: { id } });
  return NextResponse.json({ deleted: true });
}
