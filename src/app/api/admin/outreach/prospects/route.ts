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
import {
  BUSINESS_SEGMENTS,
  VERIFICATION_STATUSES,
  BOOKING_RELEVANCE,
  isBusinessSegment,
  isVerificationStatus,
  isBookingRelevance,
  resolveCity,
  detectSegment,
  getEffectiveApprovedCities,
} from "@/lib/outreach/cities";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const params = req.nextUrl.searchParams;
  const status = params.get("status");
  const category = params.get("category");
  const city = params.get("city");
  const segment = params.get("segment");
  const verification = params.get("verification");
  const q = (params.get("q") ?? "").trim().slice(0, 100);

  const where: Record<string, unknown> = {};

  if (status && isProspectStatus(status)) {
    where.status = status;
  }
  if (category && isProspectCategory(category)) {
    where.category = category;
  }
  // City is a stable code, never free text, so city reporting can be trusted.
  // Any valid registry code filters (history must stay viewable even for a
  // city that was later disabled).
  const codeFromFilter = resolveCity(city ?? "").city;
  if (codeFromFilter) {
    where.city = codeFromFilter;
  }
  if (segment && isBusinessSegment(segment.toUpperCase())) {
    where.segment = segment.toUpperCase();
  }
  if (verification && isVerificationStatus(verification.toUpperCase())) {
    where.verificationStatus = verification.toUpperCase();
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

  const approvedCities = await getEffectiveApprovedCities();

  return NextResponse.json(
    {
      statuses: PROSPECT_STATUSES,
      cities: approvedCities,
      segments: BUSINESS_SEGMENTS,
      verificationStatuses: VERIFICATION_STATUSES,
      bookingRelevanceLevels: BOOKING_RELEVANCE,
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
        segment: prospect.segment,
        neighborhood: prospect.neighborhood,
        verificationStatus: prospect.verificationStatus,
        verificationDate: prospect.verificationDate,
        verificationConfidence: prospect.verificationConfidence,
        verificationEvidence: prospect.verificationEvidence,
        bookingRelevance: prospect.bookingRelevance,
        outreachEligibility: prospect.outreachEligibility,
        notes: prospect.notes,
        nextFollowUpAt: prospect.nextFollowUpAt,
        lastContactedAt: prospect.lastContactedAt,
        lastInteractionAt: prospect.lastInteractionAt,
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
  /// Accepted as "TEHRAN" | "کرج" | "karaj" etc; stored as a stable code.
  city: z.string().trim().max(80).nullable().optional(),
  segment: z.string().trim().max(32).nullable().optional(),
  neighborhood: z.string().trim().max(120).nullable().optional(),
  verificationStatus: z.string().trim().max(24).nullable().optional(),
  verificationConfidence: z.string().trim().max(16).nullable().optional(),
  verificationEvidence: z.string().trim().max(1000).nullable().optional(),
  bookingRelevance: z.string().trim().max(16).nullable().optional(),
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

  // Resolve the city. A business must be assignable to exactly one registry
  // city; an ambiguous or unknown city is stored as null and reported as
  // UNASSIGNED rather than guessed. We never substitute another city.
  const cityResolution = resolveCity(data.city);
  const cityCode = cityResolution.city;

  // Infer the segment from the business name when the admin did not set one.
  const segmentResolution = detectSegment(data.publicName);
  const segmentValue =
    data.segment && isBusinessSegment(data.segment.trim().toUpperCase())
      ? data.segment.trim().toUpperCase()
      : (segmentResolution.segment ?? null);

  const dedupeKey = buildDedupeKey({
    telegramUsername: username,
    publicUrl: data.publicUrl ?? null,
    publicName: data.publicName,
    city: cityCode ?? (data.city ?? null),
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
      city: cityCode ?? null,
      segment: segmentValue,
      neighborhood: data.neighborhood ?? null,
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
      verificationStatus:
        data.verificationStatus &&
        isVerificationStatus(data.verificationStatus.toUpperCase())
          ? data.verificationStatus.toUpperCase()
          : "DISCOVERED",
      verificationDate:
        data.verificationStatus?.toUpperCase() === "VERIFIED" ? new Date() : null,
      verificationConfidence:
        data.verificationConfidence &&
        ["HIGH", "MEDIUM", "LOW"].includes(data.verificationConfidence.toUpperCase())
          ? data.verificationConfidence.toUpperCase()
          : null,
      verificationEvidence: data.verificationEvidence ?? null,
      bookingRelevance:
        data.bookingRelevance && isBookingRelevance(data.bookingRelevance.toUpperCase())
          ? data.bookingRelevance.toUpperCase()
          : null,
    },
  });

  return NextResponse.json(
    {
      prospect,
      cityResolved: cityResolution.city
        ? {
            city: cityResolution.city,
            confidence: "reason" in cityResolution ? "HIGH" : cityResolution.confidence,
          }
        : { city: null, reason: "reason" in cityResolution ? cityResolution.reason : "NONE" },
    },
    { status: 201 }
  );
}
