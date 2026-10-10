import { withOutreachError } from "@/lib/outreach/api-error";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { sendCampaignInvitations } from "@/lib/outreach/campaigns";
import { getOutreachSettings } from "@/lib/outreach/settings";

type Params = { params: Promise<{ id: string }> };

/**
 * Deliver a campaign's approved invitations.
 *
 * Only recipients who have already started the bot receive anything. Everyone
 * else stays APPROVED with a reason, for manual outreach through their own
 * public channels.
 */
async function POSTImpl(_req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (await isRateLimited(`outreach-send:${guard.user.id}`, 20, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  triggerRateLimitCleanup();

  const { id } = await params;

  const campaign = await prisma.outreachCampaign.findUnique({
    where: { id },
    select: { id: true, status: true, sendLimit: true },
  });
  if (!campaign) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const settings = await getOutreachSettings();
  const limit = Math.min(campaign.sendLimit ?? settings.dailyInvitationLimit, settings.dailyInvitationLimit);

  const result = await sendCampaignInvitations({ campaignId: id, limit });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ...result, limit });
}

export const POST = withOutreachError(POSTImpl);
