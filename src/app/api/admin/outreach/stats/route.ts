import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { getFunnelSummary, FUNNEL_EVENTS, FUNNEL_STEP_LABELS } from "@/lib/funnel";
import { getOutreachSettings } from "@/lib/outreach/settings";
import { getConversionCounts } from "@/lib/outreach/attribution";
import { PROSPECT_STATUSES } from "@/lib/outreach/types";

const DAY = 24 * 60 * 60 * 1000;

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const now = new Date();
  const since7d = new Date(now.getTime() - 7 * DAY);
  const since24h = new Date(now.getTime() - DAY);

  const [statusCounts, funnel, settings, conversions, invitationCounts] =
    await Promise.all([
      prisma.outreachProspect.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      getFunnelSummary({ since: since7d }),
      getOutreachSettings(),
      getConversionCounts(since24h),
      prisma.outreachInvitation.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
    ]);

  const byStatus = Object.fromEntries(
    statusCounts.map((row) => [row.status, row._count._all])
  );
  const byInvitation = Object.fromEntries(
    invitationCounts.map((row) => [row.status, row._count._all])
  );

  const funnelMap = new Map(funnel.map((row) => [row.event, row.count]));

  const steps = FUNNEL_EVENTS.map((event) => ({
    event,
    count: funnelMap.get(event) ?? 0,
    labelEn: FUNNEL_STEP_LABELS[event].en,
    labelFa: FUNNEL_STEP_LABELS[event].fa,
  }));

  const [candidateTotal, candidateNew, lastRun, dueFollowUps] = await Promise.all([
    prisma.discoveryCandidate.count(),
    prisma.discoveryCandidate.count({ where: { status: "NEW" } }),
    prisma.discoveryRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: {
        runDate: true,
        status: true,
        discovered: true,
        matched: true,
        duplicates: true,
        excluded: true,
        invitationsPrepared: true,
        messagesSent: true,
        messagesDelivered: true,
        error: true,
        startedAt: true,
        finishedAt: true,
      },
    }),
    prisma.outreachProspect.count({
      where: { nextFollowUpAt: { lte: now }, status: { notIn: ["DO_NOT_CONTACT", "NOT_INTERESTED"] } },
    }),
  ]);

  return NextResponse.json(
    {
      generatedAt: now.toISOString(),
      funnel: steps,
      prospects: {
        statuses: PROSPECT_STATUSES,
        byStatus,
        dueFollowUps,
      },
      invitations: { byStatus: byInvitation },
      discovery: {
        candidateTotal,
        candidateNew,
        lastRun,
        settings,
      },
      last24h: conversions,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
