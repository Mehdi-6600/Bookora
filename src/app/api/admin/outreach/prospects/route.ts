import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import {
  buildDedupeKey,
  normalizeTelegramUsername,
  toTelegramProfileUrl,
} from "@/lib/outreach/normalize";
import { buildBotDeepLink, buildProspectStartParam } from "@/lib/outreach/deeplink";
import {
  isProspectCategory,
  isProspectStatus,
  normalizeLanguage,
  PROSPECT_STATUSES,
} from "@/lib/outreach/types";
import { isSuppressed } from "@/lib/outreach/eligibility";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const params = req.nextUrl.searchParams;
  const status = params.get("status");
  const category = params.get("category");
  const q = (params.get("q") ?? "").trim().slice(0, 100);

  const where: Record<string, unknown> = {};

  if (status && isProspectStatus(status)) {
    where.status = status;
  }
  if (category && isProspectCategory(category)) {
    where.category = category;
  }
  if (q) {
    where.OR = [
      { publicName: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
      { telegramUsername: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
    ];
  }

  const prospects = await prisma.outreachProspect.findMany({
    where,
    orderBy: [{ nextFollowUpAt: "asc" }, { createdAt: "desc" }],
    take: 200,
    include: {
      campaign: { select: { id: true, code: true, name: true } },
      invitations: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          deepLink: true,
          startParam: true,
          createdAt: true,
          deliveredAt: true,
          failureReason: true,
        },
      },
      botStarts: { select: { id: true } },
    },
  });

  return NextResponse.json(
    {
      statuses: PROSPECT_STATUSES,
      prospects: prospects.map((prospect) => ({
        id: prospect.id,
        publicName: prospect.publicName,
        category: prospect.category,
        city: prospect.city,
        country: prospect.country,
        language: prospect.language,
        publicUrl: prospect.publicUrl,
        telegramUsername: prospect.telegramUsername,
        telegramUrl: prospect.telegramUsername
          ? toTelegramProfileUrl(prospect.telegramUsername)
          : null,
        sourceUrl: prospect.sourceUrl,
        sourceName: prospect.sourceName,
        status: prospect.status,
        notes: prospect.notes,
        nextFollowUpAt: prospect.nextFollowUpAt,
        lastContactedAt: prospect.lastContactedAt,
        contactedCount: prospect.contactedCount,
        optedOutAt: prospect.optedOutAt,
        convertedBusinessId: prospect.convertedBusinessId,
        activatedAt: prospect.activatedAt,
        createdAt: prospect.createdAt,
        campaign: prospect.campaign,
        // Fallback deep link for manual outreach when no invitation exists yet.
        manualDeepLink: buildBotDeepLink(buildProspectStartParam(prospect.id)),
        lastInvitation: prospect.invitations[0] ?? null,
        botStartCount: prospect.botStarts.length,
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const createSchema = z.object({
  publicName: z.string().trim().min(1).max(200),
  category: z.string().refine(isProspectCategory, "invalid category").default("OTHER"),
  city: z.string().trim().max(80).nullable().optional(),
  country: z.string().trim().max(80).nullable().optional(),
  language: z.string().trim().max(8).optional(),
  publicUrl: z.string().trim().max(500).nullable().optional(),
  telegramUsername: z.string().trim().max(64).nullable().optional(),
  sourceUrl: z.string().trim().max(500).nullable().optional(),
  sourceName: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  campaignId: z.string().trim().max(100).nullable().optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (await isRateLimited(`outreach-prospect:${guard.user.id}`, 120, 10 * 60 * 1000)) {
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
      { error: "invalid prospect", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const username = normalizeTelegramUsername(data.telegramUsername);

  if (data.telegramUsername && !username) {
    return NextResponse.json(
      { error: "invalid telegram username" },
      { status: 400 }
    );
  }

  const dedupeKey = buildDedupeKey({
    telegramUsername: username,
    publicUrl: data.publicUrl ?? null,
    publicName: data.publicName,
    city: data.city ?? null,
  });

  const existing = await prisma.outreachProspect.findUnique({
    where: { dedupeKey },
    select: { id: true, publicName: true, status: true },
  });

  if (existing) {
    return NextResponse.json(
      { error: "duplicate prospect", existing },
      { status: 409 }
    );
  }

  const suppressed = await isSuppressed([`tg:${username}`]);
  if (suppressed) {
    return NextResponse.json(
      { error: "This contact is on the do-not-contact list." },
      { status: 409 }
    );
  }

  const prospect = await prisma.outreachProspect.create({
    data: {
      publicName: data.publicName,
      category: data.category,
      city: data.city ?? null,
      country: data.country ?? null,
      language: normalizeLanguage(data.language),
      publicUrl: data.publicUrl ?? null,
      telegramUsername: username,
      sourceUrl: data.sourceUrl ?? null,
      sourceName: data.sourceName ?? "manual",
      notes: data.notes ?? null,
      campaignId: data.campaignId ?? null,
      nextFollowUpAt: data.nextFollowUpAt ? new Date(data.nextFollowUpAt) : null,
      dedupeKey,
      status: "NEW",
    },
  });

  return NextResponse.json({ prospect }, { status: 201 });
}
