import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { getOutreachSettings } from "@/lib/outreach/settings";
import {
  collectDiscoveryPreflight,
  runDailyDiscovery,
  type DiscoverySummary,
} from "@/lib/outreach/discovery";

/**
 * Discovery diagnostics and on-demand run.
 *
 * GET  — real pipeline state: switches, limits, what is configured, what is
 *        blocking, and the last run. Never returns secrets (the feed URL is
 *        reported only as configured/not configured) or prospect details.
 * POST — run discovery now through the same pipeline as the daily job. It can
 *        only import public candidates; it never verifies, promotes or sends.
 */

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const settings = await getOutreachSettings();
  const preflight = await collectDiscoveryPreflight(settings);

  const [lastRun, candidateTotal, candidateNew] = await Promise.all([
    prisma.discoveryRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: {
        runDate: true,
        status: true,
        discovered: true,
        matched: true,
        duplicates: true,
        excluded: true,
        error: true,
        startedAt: true,
        finishedAt: true,
      },
    }),
    prisma.discoveryCandidate.count(),
    prisma.discoveryCandidate.count({ where: { status: "NEW" } }),
  ]);

  return NextResponse.json(
    {
      runDate: preflight.runDate,
      timezone: settings.timezone,
      ready: preflight.blockers.length === 0,
      blockers: preflight.blockers,
      switches: {
        discoveryEnabled: settings.enabled,
        feedEnabled: settings.feedEnabled,
        feedConfigured: settings.feedUrl.length > 0,
      },
      limits: {
        dailyDiscoveryLimit: settings.dailyDiscoveryLimit,
        discoveredToday: preflight.discoveredToday,
        remainingToday: preflight.remaining,
        minScore: settings.minScore,
      },
      keywords: {
        source: preflight.keywordSet.source,
        enabled: preflight.keywordSet.keywords.length,
        configured: preflight.keywordSet.configuredCount,
      },
      inputs: {
        manualSeedCandidates: preflight.seed.candidates,
        manualSeedRejected: preflight.seed.rejected,
      },
      candidates: {
        total: candidateTotal,
        new: candidateNew,
      },
      lastRun,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

function httpStatusFor(summary: DiscoverySummary): number {
  switch (summary.status) {
    case "OK":
      return 200;
    case "FAILED":
      return 502;
    default:
      // BLOCKED / SKIPPED: the request was understood but cannot run yet.
      return 409;
  }
}

export async function POST() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (await isRateLimited(`outreach-discovery-run:${guard.user.id}`, 20, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  triggerRateLimitCleanup();

  const settings = await getOutreachSettings();
  const summary = await runDailyDiscovery({ settings, mode: "manual" });

  const body = {
    ok: summary.status === "OK",
    status: summary.status,
    runDate: summary.runDate,
    timezone: summary.timezone,
    discovered: summary.discovered,
    duplicates: summary.duplicates,
    excluded: summary.excluded,
    inputCount: summary.inputCount,
    rejectedInputs: summary.rejectedInputs,
    unknownCity: summary.unknownCity,
    unknownSegment: summary.unknownSegment,
    keywordSource: summary.keywordSource,
    enabledKeywords: summary.enabledKeywords,
    remainingBefore: summary.remainingBefore,
    blockers: summary.blockers,
    sourceIssues: summary.sourceIssues,
    error: summary.status === "FAILED" ? (summary.error ?? "DiscoveryFailed") : null,
  };

  return NextResponse.json(body, {
    status: httpStatusFor(summary),
    headers: { "Cache-Control": "no-store" },
  });
}
