import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import {
  isProspectCategory,
  isProspectStatus,
  isVerificationStatus,
  normalizeLanguage,
} from "@/lib/outreach/types";
import { recordOptOut } from "@/lib/outreach/invitations";
import {
  buildSuppressionIdentifier,
  publicUrlReasonText,
  validatePublicProfileUrl,
} from "@/lib/outreach/normalize";
import { isBusinessSegment, resolveCity } from "@/lib/outreach/cities";

const patchSchema = z.object({
  publicName: z.string().trim().min(1).max(200).optional(),
  category: z.string().refine(isProspectCategory, "invalid category").optional(),
  city: z.string().trim().max(80).nullable().optional(),
  segment: z.string().trim().max(32).nullable().optional(),
  country: z.string().trim().max(80).nullable().optional(),
  language: z.string().trim().max(8).optional(),
  publicUrl: z.string().trim().max(500).nullable().optional(),
  telegramUsername: z.string().trim().max(64).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  status: z.string().refine(isProspectStatus, "invalid status").optional(),
  verificationStatus: z.string().refine(isVerificationStatus, "invalid verification status").optional(),
  verificationConfidence: z.string().trim().max(16).nullable().optional(),
  verificationEvidence: z.string().trim().max(1000).nullable().optional(),
  campaignId: z.string().trim().max(100).nullable().optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const prospect = await prisma.outreachProspect.findUnique({
    where: { id },
    include: {
      campaign: { select: { id: true, code: true, name: true } },
      invitations: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          status: true,
          body: true,
          deepLink: true,
          startParam: true,
          createdAt: true,
          approvedAt: true,
          sentAt: true,
          deliveredAt: true,
          failureReason: true,
        },
      },
      botStarts: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });

  if (!prospect) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(
    { prospect },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (await isRateLimited(`outreach-edit:${guard.user.id}`, 200, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  triggerRateLimitCleanup();

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid update", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const existing = await prisma.outreachProspect.findUnique({
    where: { id },
    select: { id: true, telegramUsername: true, publicUrl: true, verificationStatus: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const data: Record<string, unknown> = { ...parsed.data };

  // City is stored as a registry code only, never as free text.
  if (parsed.data.city !== undefined) {
    if (parsed.data.city === null || parsed.data.city === "") {
      data.city = null;
    } else {
      const resolved = resolveCity(parsed.data.city);
      if (!resolved.city) {
        return NextResponse.json(
          {
            error: "unknown city",
            reason: "unknown city",
            hint: "Use a registry city name or code, e.g. Tehran or TEHRAN.",
          },
          { status: 400 }
        );
      }
      data.city = resolved.city;
    }
  }

  // Segment is an explicit choice from the taxonomy, or cleared.
  if (parsed.data.segment !== undefined) {
    if (parsed.data.segment === null || parsed.data.segment === "") {
      data.segment = null;
    } else {
      const upper = parsed.data.segment.toUpperCase();
      if (!isBusinessSegment(upper)) {
        return NextResponse.json({ error: "unknown segment" }, { status: 400 });
      }
      data.segment = upper;
    }
  }

  if (parsed.data.publicUrl !== undefined) {
    if (parsed.data.publicUrl === null || parsed.data.publicUrl === "") {
      data.publicUrl = null;
    } else {
      const check = validatePublicProfileUrl(parsed.data.publicUrl);
      if (!check.ok) {
        return NextResponse.json(
          { error: "invalid publicUrl", reason: publicUrlReasonText(check.reason) },
          { status: 400 }
        );
      }
      data.publicUrl = check.url;
    }
  }

  if (typeof data.language === "string") {
    data.language = normalizeLanguage(data.language);
  }
  if (data.nextFollowUpAt !== undefined) {
    data.nextFollowUpAt = data.nextFollowUpAt ? new Date(data.nextFollowUpAt as string) : null;
  }

  // Moving a prospect to DO_NOT_CONTACT must also suppress them permanently.
  if (parsed.data.status === "DO_NOT_CONTACT") {
    await recordOptOut({
      telegramUsername: existing.telegramUsername,
      publicUrl: existing.publicUrl,
      prospectId: id,
      note: "Marked Do Not Contact in the admin dashboard",
    });
    delete data.status; // recordOptOut already sets it
  }

  // When verificationStatus changes to VERIFIED, stamp the verification date.
  if (parsed.data.verificationStatus === "VERIFIED" && existing.verificationStatus !== "VERIFIED") {
    data.verificationDate = new Date();
  }

  const prospect = await prisma.outreachProspect.update({
    where: { id },
    data,
  });

  return NextResponse.json({ prospect });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const existing = await prisma.outreachProspect.findUnique({
    where: { id },
    select: { id: true, telegramUsername: true, publicUrl: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Deleting a prospect keeps the do-not-contact guarantee intact by adding a
  // suppression entry unless one already exists for another reason.
  const identifier = buildSuppressionIdentifier({
    telegramUsername: existing.telegramUsername,
    publicUrl: existing.publicUrl,
  });

  if (identifier) {
    await prisma.outreachSuppression.upsert({
      where: { identifier },
      update: { reason: "DELETED" },
      create: { identifier, reason: "DELETED", note: "Prospect deleted" },
    });
  }

  await prisma.outreachProspect.delete({ where: { id } });

  return NextResponse.json({ deleted: true });
}
