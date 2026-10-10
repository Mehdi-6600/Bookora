import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { getFunnelSummary, FUNNEL_EVENTS, FUNNEL_STEP_LABELS } from "@/lib/funnel";
import { getOutreachSettings } from "@/lib/outreach/settings";
import { getConversionCounts } from "@/lib/outreach/attribution";
import { PROSPECT_STATUSES } from "@/lib/outreach/types";
import {
  aggregateByDimension,
  buildCampaignReport,
  buildFunnelStages,
  type FunnelStageKey,
  type MeasurableCount,
} from "@/lib/outreach/analytics";

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

  // ---- acquisition analytics: real, countable facts only -----------------
  const [
    discoveryTotals,
    candidateByStatus,
    verifiedProspectCount,
    prospectByCampaign,
    invitationByCampaign,
    dimensionProspects,
    dimensionInvitations,
    campaignRows,
    botStartCountAll,
  ] = await Promise.all([
    prisma.discoveryRun.aggregate({
      _sum: {
        discovered: true,
        duplicates: true,
        invitationsPrepared: true,
        messagesSent: true,
        messagesDelivered: true,
        botStarts: true,
        registrations: true,
        activations: true,
        firstBookings: true,
      },
    }),
    prisma.discoveryCandidate.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.outreachProspect.count({ where: { verificationStatus: "VERIFIED" } }),
    prisma.outreachProspect.groupBy({
      by: ["campaignId", "status"],
      _count: { _all: true },
    }),
    prisma.outreachInvitation.groupBy({
      by: ["campaignId", "status"],
      _count: { _all: true },
    }),
    prisma.outreachProspect.findMany({
      select: {
        id: true,
        city: true,
        segment: true,
        language: true,
        status: true,
        verificationStatus: true,
        optedOutAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
    prisma.outreachInvitation.findMany({
      select: { prospectId: true, status: true, campaignId: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
    prisma.outreachCampaign.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        cities: true,
        language: true,
        _count: { select: { botStarts: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.botStart.count(),
  ]);

  const reviewedCandidates = candidateByStatus
    .filter((row) => row.status === "SHORTLISTED" || row.status === "CONVERTED")
    .reduce((total, row) => total + row._count._all, 0);

  const mc = (count: number, source: string): MeasurableCount => ({ count, source });
  const funnelCounts: Partial<Record<FunnelStageKey, MeasurableCount | null>> = {
    discovered: mc(discoveryTotals._sum.discovered ?? 0, "discovery_runs.discovered"),
    duplicateCandidates: mc(discoveryTotals._sum.duplicates ?? 0, "discovery_runs.duplicates"),
    reviewedApproved: mc(verifiedProspectCount, "outreach_prospects.verificationStatus=VERIFIED"),
    invitationsDrafted: mc(
      Object.values(byInvitation).reduce((a, b) => a + b, 0),
      "outreach_invitations (all statuses)"
    ),
    invitationsApproved: mc(
      (byInvitation.APPROVED ?? 0) + (byInvitation.SENT ?? 0) + (byInvitation.DELIVERED ?? 0),
      "outreach_invitations status APPROVED+SENT+DELIVERED"
    ),
    // "prepared" counts invitations actually created by a campaign run.
    invitationsPrepared: mc(discoveryTotals._sum.invitationsPrepared ?? 0, "discovery_runs.invitationsPrepared"),
    deliveryAttempted: mc(discoveryTotals._sum.messagesSent ?? 0, "discovery_runs.messagesSent"),
    deliveryConfirmed: mc(discoveryTotals._sum.messagesDelivered ?? 0, "discovery_runs.messagesDelivered"),
    botStarts: mc(botStartCountAll, "bot_starts"),
    registrations: mc(
      dimensionProspects.filter((p) => p.status === "REGISTERED" || p.status === "ACTIVATED").length,
      "outreach_prospects.status REGISTERED/ACTIVATED"
    ),
    activated: mc(discoveryTotals._sum.activations ?? 0, "discovery_runs.activations (daily-run tally)"),
    firstBookings: mc(discoveryTotals._sum.firstBookings ?? 0, "discovery_runs.firstBookings"),
  };
  const acquisitionStages = buildFunnelStages(funnelCounts);

  const campaignReport = buildCampaignReport(
    campaignRows,
    invitationByCampaign.map((row) => ({
      campaignId: row.campaignId,
      status: row.status,
      count: row._count._all,
    })),
    prospectByCampaign.map((row) => ({
      campaignId: row.campaignId,
      status: row.status,
      count: row._count._all,
    }))
  );

  const dimensionInvitationRows = dimensionInvitations.map((row) => ({
    prospectId: row.prospectId,
    status: row.status,
    campaignId: row.campaignId,
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
      acquisition: {
        note: "Counts come from recorded events only. Prepared ≠ delivered: a message counts as delivered only when the Telegram API accepted it (or the recipient started the bot).",
        stages: acquisitionStages,
        byCampaign: campaignReport,
        byCity: aggregateByDimension(dimensionProspects, dimensionInvitationRows, "city"),
        byLanguage: aggregateByDimension(dimensionProspects, dimensionInvitationRows, "language"),
        bySegment: aggregateByDimension(dimensionProspects, dimensionInvitationRows, "segment"),
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
