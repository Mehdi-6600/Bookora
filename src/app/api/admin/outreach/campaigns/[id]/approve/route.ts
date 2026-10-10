import { withOutreachError } from "@/lib/outreach/api-error";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { approveCampaign } from "@/lib/outreach/campaigns";

type Params = { params: Promise<{ id: string }> };

/**
 * Explicit administrator approval. Requires a dry run first and refuses to
 * approve a campaign that would reach nobody. Approval sends nothing.
 */
async function POSTImpl(_req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (await isRateLimited(`outreach-approve:${guard.user.id}`, 60, 10 * 60 * 1000)) {
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

  const result = await approveCampaign(id, guard.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, plan: result.plan });
}

export const POST = withOutreachError(POSTImpl);
