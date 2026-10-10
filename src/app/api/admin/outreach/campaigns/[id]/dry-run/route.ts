import { withOutreachError } from "@/lib/outreach/api-error";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { dryRunCampaign } from "@/lib/outreach/campaigns";

type Params = { params: Promise<{ id: string }> };

/**
 * Dry run: validate the campaign end to end and report every recipient, the
 * exact message and the delivery channel — without creating an invitation or
 * sending anything.
 */
async function POSTImpl(_req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (await isRateLimited(`outreach-dryrun:${guard.user.id}`, 60, 10 * 60 * 1000)) {
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

  const result = await dryRunCampaign(id, guard.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(
    { ok: true, plan: result.plan },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export const POST = withOutreachError(POSTImpl);
