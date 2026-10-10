import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { buildBotDeepLink } from "@/lib/outreach/deeplink";
import {
  categoryLabel,
  renderTemplate,
  validateTemplateBody,
} from "@/lib/outreach/templates";
import { buildSuppressionIdentifier } from "@/lib/outreach/normalize";
import {
  checkEligibility,
  isClosedStatus,
  isSuppressed,
  resolveTelegramUserId,
} from "@/lib/outreach/eligibility";
import {
  isProspectCategory,
  normalizeLanguage,
  type OutreachLanguage,
} from "@/lib/outreach/types";
import {
  APPROVED_CITIES,
  resolveCity,
  CITY_LABELS,
  SEGMENT_LABELS,
  isCityCode,
  isBusinessSegment,
  type CityCode,
  type BusinessSegment,
} from "@/lib/outreach/cities";
import { getOutreachSettings } from "@/lib/outreach/settings";
import {
  prepareInvitations,
  sendApprovedInvitations,
} from "@/lib/outreach/invitations";

/**
 * Campaign management for the four-city acquisition campaign.
 *
 * Hard rules enforced here, in order:
 *
 *  1. Targeting is limited to the four approved cities and two segments.
 *  2. Only VERIFIED prospects are ever eligible. A discovery hit is not a
 *     prospect; a verified prospect is not automatically eligible.
 *  3. A dry run validates everything and writes nothing but a timestamp.
 *  4. Approval is explicit and separate from preparation and from sending.
 *  5. Preparation is idempotent: a prospect with a pending invitation is never
 *     given a second one, so a retry cannot double-send.
 *  6. Sending respects the daily quota and re-checks eligibility per recipient.
 *
 * Nothing in this module sends a message. Delivery goes through
 * `sendApprovedInvitations`, which will only message someone who has already
 * started the bot.
 */

export const CAMPAIGN_STATUSES = [
  "DRAFT",
  "REVIEW",
  "APPROVED",
  "SENDING",
  "COMPLETED",
  "FAILED",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export function isCampaignStatus(value: unknown): value is CampaignStatus {
  return (
    typeof value === "string" &&
    (CAMPAIGN_STATUSES as readonly string[]).includes(value)
  );
}

/** Prospect statuses a campaign may contact. */
const CONTACTABLE_STATUSES = ["NEW", "INTERESTED"];
/** Statuses that permit one follow-up if the follow-up date has passed. */
const FOLLOWUPABLE_STATUSES = ["CONTACTED", "STARTED_BOT"];

export type RecipientDisposition = "ELIGIBLE" | "MANUAL_ONLY" | "BLOCKED";

export type CampaignRecipient = {
  prospectId: string;
  publicName: string;
  city: CityCode | null;
  segment: BusinessSegment | null;
  neighborhood: string | null;
  language: string;
  disposition: RecipientDisposition;
  reason: string;
  channel: "TELEGRAM_BOT" | "MANUAL";
  destination: string;
  previewBody: string | null;
};

export type CampaignPlan = {
  code: string;
  name: string;
  status: string;
  cities: CityCode[];
  segments: BusinessSegment[];
  language: string;
  templateCode: string | null;
  destinationUrl: string;
  sendLimit: number;
  dailyQuota: number;
  matched: number;
  eligible: number;
  manualOnly: number;
  blocked: number;
  blockedBreakdown: Record<string, number>;
  excluded: Array<{
    prospectId: string;
    publicName: string;
    city: CityCode | null;
    segment: BusinessSegment | null;
    reason: string;
  }>;
  byCitySegment: Array<{
    city: CityCode | "UNASSIGNED";
    segment: BusinessSegment | "UNASSIGNED";
    eligible: number;
    manualOnly: number;
    blocked: number;
  }>;
  recipients: CampaignRecipient[];
  warnings: string[];
};

function uniqueStartParam(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

function campaignCode(): string {
  return `cmp_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

export type CampaignLike = {
  id: string;
  code: string;
  name: string;
  status: string;
  cities: string[];
  segments: string[];
  language: string;
  objective: string | null;
  templateId: string | null;
  cta: string | null;
  destinationUrl: string | null;
  followUpPolicy: string;
  channel: string;
  sendLimit: number | null;
};

/** Validate and normalise targeting input from an admin request. */
export function normalizeTargeting(input: {
  cities?: unknown;
  segments?: unknown;
  language?: unknown;
}): { cities: CityCode[]; segments: BusinessSegment[]; language: OutreachLanguage } {
  const rawCities = Array.isArray(input.cities)
    ? input.cities
    : typeof input.cities === "string" && input.cities.length > 0
      ? [input.cities]
      : [];

  const cities: CityCode[] = [];
  for (const value of rawCities) {
    if (typeof value !== "string") continue;
    const upper = value.trim().toUpperCase();
    if (isCityCode(upper)) {
      if (!cities.includes(upper)) cities.push(upper);
      continue;
    }
    // Accept "کرج", "karaj", " مشهد " and fold Persian/Arabic variants.
    const resolved = resolveCity(value);
    if (resolved.city && !cities.includes(resolved.city)) cities.push(resolved.city);
  }

  const rawSegments = Array.isArray(input.segments)
    ? input.segments
    : typeof input.segments === "string" && input.segments.length > 0
      ? [input.segments]
      : [];

  const segments: BusinessSegment[] = [];
  for (const value of rawSegments) {
    if (typeof value !== "string") continue;
    const upper = value.trim().toUpperCase();
    if (isBusinessSegment(upper) && !segments.includes(upper)) segments.push(upper);
  }

  return {
    cities,
    segments,
    language: normalizeLanguage(input.language ?? "fa"),
  };
}

/**
 * Compute exactly who a campaign would reach, and why.
 *
 * Pure with respect to sending: it creates nothing. It is used by the dry-run
 * endpoint and by the approval gate.
 */
export async function planCampaign(
  campaign: CampaignLike,
  options: { now?: Date } = {}
): Promise<CampaignPlan> {
  const now = options.now ?? new Date();
  const settings = await getOutreachSettings();
  const warnings: string[] = [];

  const cities = campaign.cities.filter(isCityCode);
  const segments = campaign.segments.filter(isBusinessSegment);

  if (cities.length === 0) {
    warnings.push(
      "No city selected. Targeting defaults to all four approved cities."
    );
  }
  if (segments.length === 0) {
    warnings.push(
      "No segment selected. Targeting defaults to both men's barbershops and women's salons."
    );
  }
  if (campaign.status === "DRAFT") {
    warnings.push("Campaign is still DRAFT. Run a dry run before approving.");
  }

  const statusFilter =
    campaign.followUpPolicy === "NO_FOLLOWUP"
      ? [...CONTACTABLE_STATUSES]
      : [...CONTACTABLE_STATUSES, ...FOLLOWUPABLE_STATUSES];

  const where: Record<string, unknown> = {
    verificationStatus: "VERIFIED",
    optedOutAt: null,
    status: { in: statusFilter },
  };

  if (cities.length > 0) where.city = { in: cities };
  if (segments.length > 0) where.segment = { in: segments };

  const prospects = await prisma.outreachProspect.findMany({
    where,
    orderBy: [{ city: "asc" }, { segment: "asc" }, { createdAt: "asc" }],
    take: 500,
  });

  // Follow-up policy: only re-approach a contacted prospect once its follow-up
  // date has actually arrived.
  const inWindow = prospects.filter((prospect) => {
    if (CONTACTABLE_STATUSES.includes(prospect.status)) return true;
    if (!prospect.nextFollowUpAt) return false;
    return prospect.nextFollowUpAt.getTime() <= now.getTime();
  });

  const template = campaign.templateId
    ? await prisma.invitationTemplate.findUnique({
        where: { id: campaign.templateId },
      })
    : await prisma.invitationTemplate.findFirst({
        where: { active: true, language: normalizeLanguage(campaign.language) },
        orderBy: { createdAt: "asc" },
      });

  if (!template) {
    warnings.push(
      "No active invitation template matches this campaign language. Prepare a template before sending."
    );
  }

  const bodyError = template ? validateTemplateBody(template.body) : null;
  if (bodyError) warnings.push(`Template rejected: ${bodyError}`);

  const pendingProspectIds = new Set(
    (
      await prisma.outreachInvitation.findMany({
        where: { status: { in: ["DRAFT", "APPROVED"] } },
        select: { prospectId: true },
      })
    ).map((row) => row.prospectId)
  );

  const limit =
    campaign.sendLimit && campaign.sendLimit > 0
      ? Math.min(campaign.sendLimit, settings.dailyInvitationLimit)
      : settings.dailyInvitationLimit;

  const recipients: CampaignRecipient[] = [];
  const excluded: CampaignPlan["excluded"] = [];
  const blockedBreakdown: Record<string, number> = {};
  const matrix = new Map<
    string,
    {
      city: CityCode | "UNASSIGNED";
      segment: BusinessSegment | "UNASSIGNED";
      eligible: number;
      manualOnly: number;
      blocked: number;
    }
  >();

  for (const prospect of inWindow) {
    const city = isCityCode(prospect.city) ? prospect.city : null;
    const segment = isBusinessSegment(prospect.segment) ? prospect.segment : null;
    const key = `${city ?? "UNASSIGNED"}|${segment ?? "UNASSIGNED"}`;
    if (!matrix.has(key)) {
      matrix.set(key, {
        city: city ?? "UNASSIGNED",
        segment: segment ?? "UNASSIGNED",
        eligible: 0,
        manualOnly: 0,
        blocked: 0,
      });
    }
    const cell = matrix.get(key)!;

    let disposition: RecipientDisposition = "BLOCKED";
    let reason = "unknown";

    if (isClosedStatus(prospect.status)) {
      reason = "closed_status";
    } else if (prospect.optedOutAt) {
      reason = "opted_out";
    } else if (
      await isSuppressed([
        buildSuppressionIdentifier({
          telegramUsername: prospect.telegramUsername,
          publicUrl: prospect.publicUrl,
        }),
      ])
    ) {
      reason = "suppressed";
    } else if (pendingProspectIds.has(prospect.id)) {
      reason = "already_pending";
    } else {
      const telegramUserId = await resolveTelegramUserId(prospect);
      const eligibility = await checkEligibility({
        id: prospect.id,
        status: prospect.status,
        telegramUsername: prospect.telegramUsername,
        publicUrl: prospect.publicUrl,
        telegramUserId,
        optedOutAt: prospect.optedOutAt,
      });

      if (eligibility.canAutoSend) {
        disposition = "ELIGIBLE";
        reason = eligibility.reason;
      } else if (
        ["no_telegram_id", "not_started_bot"].includes(eligibility.reason)
      ) {
        // Not blocked — just not reachable by the bot. Prepare it for a human.
        disposition = "MANUAL_ONLY";
        reason = eligibility.reason;
      } else {
        disposition = "BLOCKED";
        reason = eligibility.reason;
      }
    }

    if (disposition === "BLOCKED") {
      blockedBreakdown[reason] = (blockedBreakdown[reason] ?? 0) + 1;
      cell.blocked += 1;
      excluded.push({
        prospectId: prospect.id,
        publicName: prospect.publicName,
        city,
        segment,
        reason,
      });
    } else if (disposition === "MANUAL_ONLY") {
      cell.manualOnly += 1;
    } else {
      cell.eligible += 1;
    }

    // Only render a preview for recipients that would actually be prepared.
    let previewBody: string | null = null;
    if (disposition !== "BLOCKED" && template && !bodyError) {
      previewBody = renderTemplate(template.body, {
        businessName: prospect.publicName,
        link: buildBotDeepLink("PREVIEW"),
        categoryLabel: categoryLabel(
          isProspectCategory(prospect.category) ? prospect.category : "OTHER",
          normalizeLanguage(prospect.language)
        ),
      });
    }

    recipients.push({
      prospectId: prospect.id,
      publicName: prospect.publicName,
      city,
      segment,
      neighborhood: prospect.neighborhood ?? null,
      language: normalizeLanguage(prospect.language),
      disposition,
      reason,
      channel: disposition === "ELIGIBLE" ? "TELEGRAM_BOT" : "MANUAL",
      destination:
        disposition === "ELIGIBLE"
          ? "Telegram (bot, recipient already started it)"
          : (prospect.publicUrl ?? "No public channel recorded"),
      previewBody,
    });
  }

  // Quota: the plan reports what would actually be prepared under the limit.
  const actionable = recipients.filter((r) => r.disposition !== "BLOCKED");
  const withinLimit = actionable.slice(0, limit);
  const heldBack = actionable.slice(limit);
  if (heldBack.length > 0) {
    warnings.push(
      `${heldBack.length} recipient(s) exceed the send limit (${limit}) and will be held for a later run.`
    );
    for (const held of heldBack) {
      excluded.push({
        prospectId: held.prospectId,
        publicName: held.publicName,
        city: held.city,
        segment: held.segment,
        reason: "over_send_limit",
      });
    }
  }

  const countBy = (d: RecipientDisposition) =>
    withinLimit.filter((r) => r.disposition === d).length;

  return {
    code: campaign.code,
    name: campaign.name,
    status: campaign.status,
    cities: cities.length > 0 ? cities : [...APPROVED_CITIES],
    segments: segments.length > 0 ? segments : ["MENS_BARBER", "WOMENS_SALON"],
    language: normalizeLanguage(campaign.language),
    templateCode: template?.code ?? null,
    destinationUrl:
      campaign.destinationUrl ?? buildBotDeepLink(uniqueStartParam()),
    sendLimit: limit,
    dailyQuota: settings.dailyInvitationLimit,
    matched: inWindow.length,
    eligible: countBy("ELIGIBLE"),
    manualOnly: countBy("MANUAL_ONLY"),
    blocked: recipients.filter((r) => r.disposition === "BLOCKED").length,
    blockedBreakdown,
    excluded,
    byCitySegment: [...matrix.values()].sort(
      (a, b) =>
        String(a.city).localeCompare(String(b.city)) ||
        String(a.segment).localeCompare(String(b.segment))
    ),
    recipients: withinLimit,
    warnings,
  };
}

/**
 * Dry run: validate the campaign end to end and report every recipient and the
 * exact message, without creating a single invitation or sending anything.
 */
export async function dryRunCampaign(
  campaignId: string,
  actorUserId?: string | null
): Promise<{ ok: true; plan: CampaignPlan } | { ok: false; error: string }> {
  const campaign = await prisma.outreachCampaign.findUnique({
    where: { id: campaignId },
  });
  if (!campaign) return { ok: false, error: "Campaign not found." };

  const plan = await planCampaign(campaign);

  await prisma.outreachCampaign.update({
    where: { id: campaignId },
    data: {
      lastDryRunAt: new Date(),
      // A dry run moves the campaign forward to REVIEW, never to APPROVED.
      status: campaign.status === "DRAFT" ? "REVIEW" : campaign.status,
      ...(actorUserId ? { requestedById: actorUserId } : {}),
    },
  });

  return { ok: true, plan };
}

/**
 * Explicit administrator approval.
 *
 * Requires a dry run first, and refuses to approve a campaign that would reach
 * nobody. Approval does not send anything.
 */
export async function approveCampaign(
  campaignId: string,
  actorUserId?: string | null
): Promise<
  { ok: true; plan: CampaignPlan } | { ok: false; error: string }
> {
  const campaign = await prisma.outreachCampaign.findUnique({
    where: { id: campaignId },
  });
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (campaign.status === "APPROVED") {
    return { ok: false, error: "Campaign is already approved." };
  }
  if (!campaign.lastDryRunAt) {
    return { ok: false, error: "Run a dry run before approving." };
  }

  const plan = await planCampaign(campaign);

  if (plan.eligible + plan.manualOnly === 0) {
    return {
      ok: false,
      error:
        "No eligible recipients. Nothing to approve — verify prospects first.",
    };
  }
  if (!plan.templateCode) {
    return {
      ok: false,
      error: "No active template for this campaign language.",
    };
  }

  await prisma.outreachCampaign.update({
    where: { id: campaignId },
    data: {
      status: "APPROVED",
      approvedAt: new Date(),
      approvedById: actorUserId ?? null,
    },
  });

  return { ok: true, plan };
}

/**
 * Create DRAFT invitations for an approved campaign.
 *
 * Idempotent by construction: `prepareInvitations` skips any prospect that
 * already has a DRAFT or APPROVED invitation, so re-running this cannot create
 * a duplicate outreach for the same business.
 */
export async function prepareCampaign(
  campaignId: string,
  actorUserId?: string | null
): Promise<
  | { ok: true; prepared: number; skipped: number; reasons: Record<string, number> }
  | { ok: false; error: string }
> {
  const campaign = await prisma.outreachCampaign.findUnique({
    where: { id: campaignId },
  });
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (campaign.status !== "APPROVED") {
    return { ok: false, error: "Campaign must be APPROVED before preparing." };
  }

  const plan = await planCampaign(campaign);
  const prospectIds = plan.recipients.map((r) => r.prospectId);

  if (prospectIds.length === 0) {
    return { ok: false, error: "No recipients to prepare." };
  }

  const result = await prepareInvitations({
    limit: plan.sendLimit,
    actorUserId,
    campaignId,
    templateId: campaign.templateId,
    prospectIds,
  });

  const reasons: Record<string, number> = {};
  for (const skip of result.skipped) {
    reasons[skip.reason] = (reasons[skip.reason] ?? 0) + 1;
  }

  await prisma.outreachCampaign.update({
    where: { id: campaignId },
    data: { lastPreparedAt: new Date() },
  });

  return {
    ok: true,
    prepared: result.prepared.length,
    skipped: result.skipped.length,
    reasons,
  };
}

/** Human-readable targeting summary used by the dashboard and reports. */
export function describeTargeting(plan: CampaignPlan, lang: "en" | "fa" = "en") {
  const cities = plan.cities
    .map((c) => CITY_LABELS[c][lang])
    .join(lang === "fa" ? "، " : ", ");
  const segments = plan.segments
    .map((s) => SEGMENT_LABELS[s][lang])
    .join(lang === "fa" ? "، " : ", ");
  return { cities, segments };
}

/**
 * Approve every DRAFT invitation belonging to a campaign.
 *
 * This is still an explicit administrator action — it is a single button, but
 * it is the approval step, and the campaign must already be APPROVED. It does
 * not send anything; the daily job does, and it re-checks eligibility per
 * recipient before every single message.
 */
export async function approveCampaignInvitations(
  campaignId: string,
  actorUserId?: string | null
): Promise<{ ok: true; approved: number } | { ok: false; error: string }> {
  const campaign = await prisma.outreachCampaign.findUnique({
    where: { id: campaignId },
  });
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (campaign.status !== "APPROVED") {
    return { ok: false, error: "Campaign must be APPROVED first." };
  }

  const result = await prisma.outreachInvitation.updateMany({
    where: { campaignId, status: "DRAFT" },
    data: {
      status: "APPROVED",
      approvedAt: new Date(),
      approvedByUserId: actorUserId ?? null,
      reviewedAt: new Date(),
    },
  });

  return { ok: true, approved: result.count };
}

/**
 * Deliver an approved campaign's invitations.
 *
 * Only recipients who have already started the bot receive anything. Everyone
 * else is left as APPROVED with a reason, for manual outreach.
 */
export async function sendCampaignInvitations(options: {
  campaignId: string;
  limit: number;
}): Promise<
  { ok: true; sent: number; delivered: number; failed: number; skipped: number }
  | { ok: false; error: string }
> {
  const campaign = await prisma.outreachCampaign.findUnique({
    where: { id: options.campaignId },
  });
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (campaign.status !== "APPROVED") {
    return { ok: false, error: "Campaign must be APPROVED before sending." };
  }

  await prisma.outreachCampaign.update({
    where: { id: options.campaignId },
    data: { status: "SENDING" },
  });

  try {
    const outcomes = await sendApprovedInvitations({
      limit: options.limit,
      campaignId: options.campaignId,
    });

    const sent = outcomes.filter((o) =>
      ["SENT", "DELIVERED"].includes(o.status)
    ).length;
    const delivered = outcomes.filter((o) => o.status === "DELIVERED").length;
    const failed = outcomes.filter((o) => o.status === "FAILED").length;
    const skipped = outcomes.filter((o) => o.status === "SKIPPED").length;

    await prisma.outreachCampaign.update({
      where: { id: options.campaignId },
      data: {
        status: failed > 0 && sent === 0 ? "FAILED" : "COMPLETED",
      },
    });

    return { ok: true, sent, delivered, failed, skipped };
  } catch (error) {
    await prisma.outreachCampaign.update({
      where: { id: options.campaignId },
      data: { status: "FAILED" },
    });
    return {
      ok: false,
      error: error instanceof Error ? error.name : "UnknownError",
    };
  }
}
