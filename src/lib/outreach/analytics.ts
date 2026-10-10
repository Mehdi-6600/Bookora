/**
 * Acquisition analytics — pure calculations over counted facts.
 *
 * The golden rule of this module: a number is only shown as a number when a
 * table actually recorded it. Anything not measurable in the current schema
 * (e.g. "Telegram read receipts") is reported with `measured: false` and a
 * reason, never as an estimate dressed up as data. A prepared message is a
 * DRAFT/APPROVED invitation, never "delivered": `deliveredAt` is only set when
 * the Telegram API confirmed the send (or the recipient started the bot), so
 * `prepared`, `attempted` and `delivered` are separate stages here exactly as
 * they are separate in the database.
 */

export type MeasurableCount = {
  count: number;
  /** Which table/field the count came from, for the "how is this measured?" tooltip. */
  source: string;
};

export const UNMEASURABLE = (source: string): MeasurableCount => ({
  count: 0,
  source,
});

export type FunnelStageKey =
  | "discovered"
  | "duplicateCandidates"
  | "reviewedApproved"
  | "invitationsDrafted"
  | "invitationsApproved"
  | "invitationsPrepared"
  | "deliveryAttempted"
  | "deliveryConfirmed"
  | "botStarts"
  | "registrations"
  | "activated"
  | "firstBookings";

export const FUNNEL_STAGE_LABELS: Record<FunnelStageKey, { en: string; fa: string }> = {
  discovered: { en: "Prospects discovered", fa: "مشتریان کشف‌شده" },
  duplicateCandidates: { en: "Duplicate candidates", fa: "موارد تکراری" },
  reviewedApproved: { en: "Reviewed & verified", fa: "بازبینی و تأییدشده" },
  invitationsDrafted: { en: "Invitations drafted", fa: "دعوت‌نامه‌های پیش‌نویس" },
  invitationsApproved: { en: "Invitations approved", fa: "دعوت‌نامه‌های تأییدشده" },
  invitationsPrepared: { en: "Invitations prepared", fa: "دعوت‌نامه‌های آماده‌شده" },
  deliveryAttempted: { en: "Delivery attempts", fa: "تلاش برای ارسال" },
  deliveryConfirmed: { en: "Confirmed delivered", fa: "تحویل تأییدشده" },
  botStarts: { en: "Telegram bot starts", fa: "شروع ربات تلگرام" },
  registrations: { en: "Registrations", fa: "ثبت‌نام‌ها" },
  activated: { en: "Businesses activated", fa: "کسب‌وکارهای فعال‌شده" },
  firstBookings: { en: "First bookings", fa: "اولین رزروها" },
};

export const FUNNEL_STAGE_ORDER: FunnelStageKey[] = [
  "discovered",
  "duplicateCandidates",
  "reviewedApproved",
  "invitationsDrafted",
  "invitationsApproved",
  "invitationsPrepared",
  "deliveryAttempted",
  "deliveryConfirmed",
  "botStarts",
  "registrations",
  "activated",
  "firstBookings",
];

export type FunnelStageReport = {
  key: FunnelStageKey;
  count: number | null;
  measured: boolean;
  source: string;
  /** Conversion against the previous measured stage; null when not computable. */
  conversionFromPrev: number | null;
};

/**
 * Build the stage list with honest conversion rates.
 *
 * `counts[key] === null` marks a stage with no data source at all — it stays
 * `measured: false` instead of showing a misleading zero.
 */
export function buildFunnelStages(
  counts: Partial<Record<FunnelStageKey, MeasurableCount | null>>
): FunnelStageReport[] {
  const stages: FunnelStageReport[] = [];
  let prev: MeasurableCount | null = null;

  for (const key of FUNNEL_STAGE_ORDER) {
    const entry = counts[key] ?? null;
    if (!entry) {
      stages.push({
        key,
        count: null,
        measured: false,
        source: "no data source available",
        conversionFromPrev: null,
      });
      prev = null;
      continue;
    }
    const conversion =
      prev && prev.count > 0 ? roundRate(entry.count / prev.count) : null;
    stages.push({
      key,
      count: entry.count,
      measured: true,
      source: entry.source,
      conversionFromPrev: conversion,
    });
    if (entry.count > 0) prev = entry;
  }
  return stages;
}

/** Overall conversion between two funnel counts, or null when undefined. */
export function conversionRate(from: number, to: number): number | null {
  if (!Number.isFinite(from) || from <= 0) return null;
  return roundRate(to / from);
}

function roundRate(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/* -------------------------------------------------------------------------- */
/* Grouping by campaign / city / language / segment                            */
/* -------------------------------------------------------------------------- */

export type ProspectDimensionRow = {
  id: string;
  city: string | null;
  segment: string | null;
  language: string | null;
  status: string;
  verificationStatus: string;
  optedOutAt: unknown;
};

export type InvitationDimensionRow = {
  prospectId: string;
  status: string;
  campaignId: string | null;
};

export type DimensionTotals = {
  key: string;
  discovered: number;
  verified: number;
  drafted: number;
  approved: number;
  delivered: number;
  optedOut: number;
};

/**
 * Aggregate invitation outcomes onto prospect dimensions (city, segment or
 * language) in memory. Small, bounded and deterministic: the caller passes at
 * most a few thousand rows (see the stats route caps) — no SQL joins needed,
 * no DB-specific behaviour, and easily unit-testable.
 */
export function aggregateByDimension(
  prospects: ProspectDimensionRow[],
  invitations: InvitationDimensionRow[],
  dimension: "city" | "segment" | "language"
): DimensionTotals[] {
  const byProspect = new Map<string, ProspectDimensionRow>();
  for (const prospect of prospects) byProspect.set(prospect.id, prospect);

  const groups = new Map<string, DimensionTotals>();
  const group = (key: string): DimensionTotals => {
    let row = groups.get(key);
    if (!row) {
      row = {
        key,
        discovered: 0,
        verified: 0,
        drafted: 0,
        approved: 0,
        delivered: 0,
        optedOut: 0,
      };
      groups.set(key, row);
    }
    return row;
  };

  for (const prospect of prospects) {
    const row = group(prospect[dimension] ?? "UNASSIGNED");
    row.discovered += 1;
    if (prospect.verificationStatus === "VERIFIED") row.verified += 1;
    if (prospect.optedOutAt) row.optedOut += 1;
  }

  for (const invitation of invitations) {
    const prospect = byProspect.get(invitation.prospectId);
    if (!prospect) continue;
    const row = group(prospect[dimension] ?? "UNASSIGNED");
    if (["DRAFT", "APPROVED", "SENT", "DELIVERED", "SKIPPED", "FAILED"].includes(invitation.status)) {
      row.drafted += 1;
    }
    if (["APPROVED", "SENT", "DELIVERED"].includes(invitation.status)) row.approved += 1;
    if (invitation.status === "DELIVERED") row.delivered += 1;
  }

  return [...groups.values()].sort(
    (a, b) => b.discovered - a.discovered || a.key.localeCompare(b.key)
  );
}

export type CampaignRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  cities: string[];
  language: string | null;
};

export type CampaignTotals = {
  id: string;
  code: string;
  name: string;
  status: string;
  cities: string[];
  language: string;
  prospects: number;
  invitationsDrafted: number;
  invitationsApproved: number;
  invitationsDelivered: number;
  botStarts: number;
  registrations: number;
  activationRate: number | null;
};

/**
 * Per-campaign conversion table from plain group-by counts. `botStarts` is
 * measured (bot_starts rows); `registrations` counts invited prospects that
 * reached REGISTERED/ACTIVATED through attribution, and activationRate is
 * delivered→botStarts — null when delivery was never measured.
 */
export function buildCampaignReport(
  campaigns: Array<
    CampaignRow & {
      _count?: { prospects?: number; invitations?: number; botStarts?: number };
    }
  >,
  invitationStatuses: Array<{ campaignId: string | null; status: string; count: number }>,
  prospectStatuses: Array<{
    campaignId: string | null;
    status: string;
    count: number;
  }>
): CampaignTotals[] {
  return campaigns.map((campaign) => {
    const statuses = invitationStatuses.filter(
      (row) => row.campaignId === campaign.id
    );
    const sum = (predicate: (status: string) => boolean) =>
      statuses.reduce(
        (total, row) => (predicate(row.status) ? total + row.count : total),
        0
      );

    const drafted = sum(() => true);
    const approved = sum((status) => ["APPROVED", "SENT", "DELIVERED"].includes(status));
    const delivered = sum((status) => status === "DELIVERED");

    const prospects = prospectStatuses.filter(
      (row) => row.campaignId === campaign.id
    );
    const prospectCount = prospects.reduce((total, row) => total + row.count, 0);
    const registrations = prospects.reduce(
      (total, row) =>
        ["REGISTERED", "ACTIVATED"].includes(row.status) ? total + row.count : total,
      0
    );

    return {
      id: campaign.id,
      code: campaign.code,
      name: campaign.name,
      status: campaign.status,
      cities: campaign.cities,
      language: campaign.language ?? "fa",
      prospects: prospectCount,
      invitationsDrafted: drafted,
      invitationsApproved: approved,
      invitationsDelivered: delivered,
      botStarts: campaign._count?.botStarts ?? 0,
      registrations,
      activationRate: delivered > 0 ? roundRate((campaign._count?.botStarts ?? 0) / delivered) : null,
    };
  });
}
