import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { prepareInvitations } from "@/lib/outreach/invitations";
import { getOutreachSettings } from "@/lib/outreach/settings";
import type { InvitationStatus } from "@/lib/outreach/types";

const STATUSES: InvitationStatus[] = [
  "DRAFT",
  "APPROVED",
  "SENT",
  "DELIVERED",
  "FAILED",
  "REJECTED",
  "SKIPPED",
];

export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const status = req.nextUrl.searchParams.get("status");
  const where =
    status && STATUSES.includes(status as InvitationStatus) ? { status } : {};

  const invitations = await prisma.outreachInvitation.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      prospect: {
        select: {
          id: true,
          publicName: true,
          category: true,
          city: true,
          language: true,
          telegramUsername: true,
          publicUrl: true,
          status: true,
        },
      },
      template: { select: { id: true, code: true } },
    },
  });

  return NextResponse.json(
    { statuses: STATUSES, invitations },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const prepareSchema = z.object({
  count: z.coerce.number().int().min(1).max(100).optional(),
  campaignId: z.string().trim().max(100).nullable().optional(),
  templateId: z.string().trim().max(100).nullable().optional(),
  prospectIds: z.array(z.string().trim().max(100)).max(200).optional(),
});

/**
 * Prepare (never send) invitations for admin review.
 *
 * Creates DRAFT rows only. Sending requires a separate explicit approval step.
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (await isRateLimited(`outreach-invite:${guard.user.id}`, 40, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  triggerRateLimitCleanup();

  let body: unknown;
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    body = {};
  }

  const parsed = prepareSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const settings = await getOutreachSettings();

  const result = await prepareInvitations({
    limit: parsed.data.count ?? settings.dailyInvitationLimit,
    actorUserId: guard.user.id,
    campaignId: parsed.data.campaignId ?? null,
    templateId: parsed.data.templateId ?? null,
    prospectIds: parsed.data.prospectIds,
  });

  return NextResponse.json(
    {
      prepared: result.prepared,
      skipped: result.skipped,
      note:
        "Drafts only. Review and approve each invitation; delivery happens only for recipients who already started the bot.",
    },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
}
