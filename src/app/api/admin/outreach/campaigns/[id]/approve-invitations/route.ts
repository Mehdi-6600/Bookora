import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { approveCampaignInvitations } from "@/lib/outreach/campaigns";

type Params = { params: Promise<{ id: string }> };

/**
 * Approve every DRAFT invitation in a campaign.
 *
 * Still an explicit administrator action, and it does not send anything — the
 * daily job does, and it re-checks eligibility per recipient first.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (await isRateLimited(`outreach-approve-inv:${guard.user.id}`, 60, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  triggerRateLimitCleanup();

  const { id } = await params;

  const exists = await prisma.outreachCampaign.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!exists) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const result = await approveCampaignInvitations(id, guard.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
}
