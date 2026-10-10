import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasValidCronAuthorization, isCronSecretConfigured } from "@/lib/security/cron-auth";
import {
  getOutreachSettings,
  runDateFor,
} from "@/lib/outreach/settings";
import { runDailyDiscovery } from "@/lib/outreach/discovery";
import { prepareInvitations, sendApprovedInvitations } from "@/lib/outreach/invitations";
import { getConversionCounts } from "@/lib/outreach/attribution";
import { sendDailyReport, type DailyReport } from "@/lib/outreach/report";

/**
 * Daily growth job: discover -> prepare -> deliver -> report.
 *
 * Scheduled once per day by Vercel Cron (see `vercel.json`). Hobby projects are
 * limited to two daily cron entries per project and this is the second one, so
 * all growth work is deliberately fanned out from this single endpoint.
 *
 * Safety properties:
 *  - Protected by `CRON_SECRET` (same pattern as `/api/cron/expire-pending`).
 *  - `discovery_runs.runDate` is unique, so a retry cannot run twice.
 *  - Preparation only creates DRAFT invitations; nothing is sent unless an
 *    administrator approved it AND the recipient already started the bot.
 */

export async function GET(req: NextRequest) {
  if (!isCronSecretConfigured(process.env.CRON_SECRET)) {
    return NextResponse.json(
      { error: "Cron authentication is not configured." },
      { status: 503 }
    );
  }

  if (!hasValidCronAuthorization(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getOutreachSettings();
  const now = new Date();
  const runDate = runDateFor(settings.timezone, now);

  // Duplicate-execution guard: one successful or failed run per date.
  const existing = await prisma.discoveryRun.findUnique({
    where: { runDate },
    select: { id: true, status: true },
  });

  if (existing && existing.status !== "RUNNING") {
    return NextResponse.json({
      skipped: true,
      runDate,
      reason: "already executed",
      status: existing.status,
    });
  }

  if (!settings.enabled) {
    return NextResponse.json({
      skipped: true,
      runDate,
      reason: "outreach disabled",
    });
  }

  const errors: string[] = [];
  let discoveryBlocked = false;
  let discovered = 0;
  let matched = 0;
  let duplicates = 0;
  let excluded = 0;
  let invitationsPrepared = 0;
  let messagesSent = 0;
  let messagesDelivered = 0;

  const discovery = await runDailyDiscovery({ settings, now, mode: "scheduled" });

  if (discovery.status === "FAILED") {
    errors.push(`discovery: ${discovery.error ?? "unknown error"}`);
  } else if (discovery.status === "BLOCKED") {
    // Not a failure, but nothing was imported: keep the run marked BLOCKED so
    // the dashboard shows the next action instead of a silent success.
    discoveryBlocked = true;
  } else {
    discovered = discovery.discovered;
    matched = discovery.matched;
    duplicates = discovery.duplicates;
    excluded = discovery.excluded;
  }

  try {
    const prepared = await prepareInvitations({
      limit: settings.dailyInvitationLimit,
    });
    invitationsPrepared = prepared.prepared.length;
  } catch (error) {
    errors.push(
      `prepare: ${error instanceof Error ? error.name : "UnknownError"}`
    );
  }

  if (settings.autoSendEnabled) {
    try {
      const outcomes = await sendApprovedInvitations({
        limit: settings.dailyInvitationLimit,
      });
      messagesSent = outcomes.filter((outcome) =>
        ["SENT", "DELIVERED"].includes(outcome.status)
      ).length;
      messagesDelivered = outcomes.filter(
        (outcome) => outcome.status === "DELIVERED"
      ).length;

      for (const outcome of outcomes) {
        if (outcome.status === "FAILED") {
          errors.push(`delivery: ${outcome.reason}`);
        }
      }
    } catch (error) {
      errors.push(
        `delivery: ${error instanceof Error ? error.name : "UnknownError"}`
      );
    }
  }

  let conversions = { botStarts: 0, registrations: 0, activations: 0, firstBookings: 0 };
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    conversions = await getConversionCounts(since);
  } catch {
    errors.push("conversion counts unavailable");
  }

  let pendingReview = 0;
  try {
    pendingReview = await prisma.outreachInvitation.count({
      where: { status: { in: ["DRAFT", "APPROVED"] } },
    });
  } catch {
    // Non-fatal.
  }

  await prisma.discoveryRun.update({
    where: { runDate },
    data: {
      status: errors.length > 0 ? "FAILED" : discoveryBlocked ? "BLOCKED" : "OK",
      timezone: settings.timezone,
      discovered,
      matched,
      duplicates,
      excluded,
      invitationsPrepared,
      messagesSent,
      messagesDelivered,
      botStarts: conversions.botStarts,
      registrations: conversions.registrations,
      activations: conversions.activations,
      firstBookings: conversions.firstBookings,
      error: errors.length > 0 ? errors.join(" | ").slice(0, 900) : null,
      finishedAt: new Date(),
    },
  });

  const report: DailyReport = {
    runDate,
    timezone: settings.timezone,
    discovered,
    matched,
    duplicates,
    excluded,
    invitationsPrepared,
    messagesSent,
    messagesDelivered,
    botStarts: conversions.botStarts,
    registrations: conversions.registrations,
    activations: conversions.activations,
    firstBookings: conversions.firstBookings,
    pendingReview,
    errors,
  };

  const reportsSent = await sendDailyReport(report);

  return NextResponse.json({
    ok: true,
    runDate,
    timezone: settings.timezone,
    discovery: {
      discovered,
      matched,
      duplicates,
      excluded,
    },
    invitationsPrepared,
    messagesSent,
    messagesDelivered,
    conversions,
    pendingReview,
    reportsSent,
    discoveryBlockers: discovery.blockers,
    errors,
  });
}
