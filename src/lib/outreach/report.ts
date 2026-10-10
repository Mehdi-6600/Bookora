import { adminTelegramIds, adminTelegramIdsConfigured } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { normalizeTimeZone } from "@/lib/booking/time";
import { runDateFor } from "@/lib/outreach/settings";

export type DailyReport = {
  runDate: string;
  timezone: string;
  discovered: number;
  matched: number;
  duplicates: number;
  excluded: number;
  invitationsPrepared: number;
  messagesSent: number;
  messagesDelivered: number;
  botStarts: number;
  registrations: number;
  activations: number;
  firstBookings: number;
  pendingReview: number;
  errors: string[];
};

/** Recipients of the daily report: configured admin ids, else DB admins. */
async function reportRecipients(): Promise<string[]> {
  if (adminTelegramIdsConfigured && adminTelegramIds.length > 0) {
    return adminTelegramIds.map((id) => id.toString());
  }

  const admins = await prisma.user.findMany({
    where: { isAdmin: true },
    select: { telegramId: true },
    take: 10,
  });

  return admins
    .map((admin) => admin.telegramId)
    .filter((id) => /^\d+$/.test(id));
}

export function formatDailyReport(report: DailyReport): string {
  const lines = [
    `📊 Bookora — daily growth report (${report.runDate}, ${safeTz(report.timezone)})`,
    "",
    `🔎 Discovered: ${report.discovered} (matched ${report.matched}, duplicates ${report.duplicates}, excluded ${report.excluded})`,
    `✉️ Invitations prepared: ${report.invitationsPrepared}`,
    `📤 Sent: ${report.messagesSent} · confirmed delivered: ${report.messagesDelivered}`,
    `▶️ Bot starts: ${report.botStarts}`,
    `🏪 Registrations: ${report.registrations} · activations: ${report.activations}`,
    `🎉 First bookings: ${report.firstBookings}`,
    `⏳ Awaiting your review: ${report.pendingReview}`,
  ];

  if (report.errors.length > 0) {
    lines.push("", "⚠️ Needs attention:");
    for (const error of report.errors.slice(0, 5)) {
      lines.push(`- ${error}`);
    }
  }

  lines.push("", "Review & approve: /admin → Outreach");

  return lines.join("\n");
}

function safeTz(value: string): string {
  return normalizeTimeZone(value) ?? "UTC";
}

export async function sendDailyReport(report: DailyReport): Promise<number> {
  const recipients = await reportRecipients();
  if (recipients.length === 0) return 0;

  const text = formatDailyReport(report);
  let sent = 0;

  for (const recipient of recipients) {
    try {
      const { deliverTelegramMessage } = await import("@/lib/telegram/notify");
      const result = await deliverTelegramMessage(recipient, text);
      if (result.ok) sent += 1;
    } catch {
      // Reporting failures must not fail the run.
    }
  }

  return sent;
}

export function currentRunDate(timezone: string, now = new Date()): string {
  return runDateFor(timezone, now);
}
