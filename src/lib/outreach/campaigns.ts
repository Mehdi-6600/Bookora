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
} from "@/lib/outreach/eligibility";
import {
  isProspectCategory,
  normalizeLanguage,
  type OutreachLanguage,
} from "@/lib/outreach/types";
import {
  APPROVED_CITIES,
  cityLabel,
  parseCampaignCities,
  SEGMENT_LABELS,
  isCityCode,
  isBusinessSegment,
  type CityCode,
  type BusinessSegment,
} from "@/lib/outreach/cities";
import {
  currentOutreachDeliveryGate,
  getOutreachSettings,
  outreachDeliveryGate,
} from "@/lib/outreach/settings";
import { policyReasonLabel } from "@/lib/outreach/policy";
import {
  composeCampaignMessage,
  validateDestinationUrl,
  type DestinationSelection,
} from "@/lib/outreach/message";
import { recordAuditEvent } from "@/lib/outreach/audit";
import { approvalPolicy } from "@/lib/outreach/approval-eligibility";
import {
  prepareInvitations,
  sendApprovedInvitations,
} from "@/lib/outreach/invitations";

/**
 * Campaign management for the acquisition campaign.
 *
 * Hard rules enforced here, in order:
 *
 *  1. Targeting is limited to administrator-approved cities (the registry in
 *     `city-registry.ts`, up to 100) and to the two segments.
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

/**
 * The database predicate for "a prospect a campaign may target": verified by an
 * administrator, not opted out, a registry city and a segment assigned, and a
 * contactable status. The follow-up date is applied later by `planCampaign`, so
 * counts built from this predicate are upper-bound estimates.
 */
export function targetableProspectWhere(
  followUpPolicy: string = "ONE_FOLLOWUP"
): Record<string, unknown> {
  const statusFilter =
    followUpPolicy === "NO_FOLLOWUP"
      ? [...CONTACTABLE_STATUSES]
      : [...CONTACTABLE_STATUSES, ...FOLLOWUPABLE_STATUSES];
  return {
    verificationStatus: "VERIFIED",
    optedOutAt: null,
    city: { not: null },
    segment: { not: null },
    status: { in: statusFilter },
  };
}

export type RecipientDisposition = "ELIGIBLE" | "MANUAL_ONLY" | "BLOCKED";

export type CampaignRecipient = {
  prospectId: string;
  publicName: string;
  city: CityCode | null;
  segment: BusinessSegment | null;
  neighborhood: string | null;
  language: string;
  disposition: RecipientDisposition;
  verificationStatus: string;
  botConsent: boolean;
  suppressed: boolean;
  reason: string;
  /** Plain-language explanation of `reason`, for the reviewer. */
  reasonLabel: string | null;
  /**
   * The same explanation in every supported language. The reviewer UI is
   * Persian/Arabic first, so a bare English sentence is not enough to explain a
   * block to the operator who has to act on it.
   */
  reasonLabels: { en: string; fa: string; ar: string };
  /** When this recipient's eligibility was evaluated by the server. */
  checkedAt: Date;
  channel: "TELEGRAM_BOT" | "MANUAL";
  destination: string;
  /** The exact body that would be prepared for this recipient. */
  previewBody: string | null;
  /** Call-to-action shown with the message, when the campaign defines one. */
  cta: string | null;
  /** True when this recipient is inside the remaining send quota. */
  withinQuota: boolean;
  /** True when the recipient is sendable but held back by the quota. */
  heldOver: boolean;
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
  /** Recipients that could be approved right now: eligible and inside the quota. */
  approvable: number;
  /** Recipients held back only because the send quota is full. */
  heldOver: number;
  blockedBreakdown: Record<string, number>;
  /**
   * Every matched recipient, blocked ones included, so the reviewer can see
   * and judge each one instead of only the first few. Kept for compatibility
   * with earlier responses: `excluded` is the blocked subset of `recipients`.
   */
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
  /** Server time of this evaluation. Approval must not use an older plan. */
  generatedAt: Date;
  /** True when the outreach kill switch currently blocks sending. */
  settingsPaused: boolean;
  /** Kill-switch provenance, so the UI can show "not configured" vs "off". */
  settings: {
    enabled: boolean;
    autoSendEnabled: boolean;
    enabledSource: string;
    autoSendEnabledSource: string;
    warnings: string[];
  };
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
  /** Set by the dry run. Approval requires it (see `approveCampaign`). */
  lastDryRunAt?: Date | null;
};

/** Validate and normalise targeting input from an admin request. */
export function normalizeTargeting(input: {
  cities?: unknown;
  segments?: unknown;
  language?: unknown;
}): { cities: CityCode[]; segments: BusinessSegment[]; language: OutreachLanguage } {
  // Registry-wide resolution ("کرج", "karaj", " مشهد ", "ISFAHAN") followed by
  // the approval filter: unapproved or unknown entries are dropped here. The
  // API layer reports them explicitly through `parseCampaignCities`.
  const cities = parseCampaignCities(input.cities).cities;

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
  if (settings.readError) throw new Error(settings.readError);
  const warnings: string[] = [];

  const cities = campaign.cities.filter(isCityCode);
  const segments = campaign.segments.filter(isBusinessSegment);

  if (campaign.cities.length === 0) {
    warnings.push(
      "No city selected. Targeting defaults to the whole verified prospect pool; " +
      "reports show the default approved cities. Select explicit cities to narrow both."
    );
  }
  const invalidStoredCities = campaign.cities.filter((code) => !isCityCode(code));
  if (invalidStoredCities.length > 0) {
    warnings.push(
      `Stored cities not present in the registry are ignored: ${invalidStoredCities.join(", ")}.`
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

  const where: Record<string, unknown> = {
    ...targetableProspectWhere(campaign.followUpPolicy),
    // Narrowing by the campaign's cities/segments is additional to the base rule.
    city: cities.length > 0 ? { in: cities } : { not: null },
    segment: segments.length > 0 ? { in: segments } : { not: null },
  };

  const prospects = await prisma.outreachProspect.findMany({
    where,
    orderBy: [{ city: "asc" }, { segment: "asc" }, { createdAt: "asc" }],
    take: 500,
  });

  // Follow-up policy: only re-approach a contacted prospect once its follow-up
  // date has actually arrived.
  const inWindow = prospects.filter(
    (prospect: { status: string; nextFollowUpAt: Date | null }) => {
    if (CONTACTABLE_STATUSES.includes(prospect.status)) return true;
      if (!prospect.nextFollowUpAt) return false;
      return prospect.nextFollowUpAt.getTime() <= now.getTime();
    }
  );

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
    ).map((row: { prospectId: string }) => row.prospectId)
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
    let eligibilityReasonLabel: string | null = null;

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
      // The one policy, evaluated per recipient with the live settings. The
      // kill switch is reported (not enforced) here so a dry run can still show
      // the plan; approval and delivery enforce it.
      const eligibility = await checkEligibility({
        id: prospect.id,
        status: prospect.status,
        verificationStatus: prospect.verificationStatus,
        telegramUsername: prospect.telegramUsername,
        publicUrl: prospect.publicUrl,
        optedOutAt: prospect.optedOutAt,
      }, { settings, enforceSettings: false });

      disposition =
        eligibility.decision === "ELIGIBLE"
          ? "ELIGIBLE"
          : eligibility.decision === "MANUAL_ONLY"
            ? "MANUAL_ONLY"
            : "BLOCKED";
      reason = eligibility.reason;
      eligibilityReasonLabel = eligibility.policy?.message ?? null;
    }

    if (disposition === "BLOCKED") {
      blockedBreakdown[reason] = (blockedBreakdown[reason] ?? 0) + 1;
      cell.blocked += 1;
      // Recorded in `excluded` by the quota pass below, once, in a stable order.
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
      withinQuota: false,
      heldOver: false,
      prospectId: prospect.id,
      publicName: prospect.publicName,
      city,
      segment,
      neighborhood: prospect.neighborhood ?? null,
      language: normalizeLanguage(prospect.language),
      disposition,
      verificationStatus: prospect.verificationStatus,
      botConsent: disposition === "ELIGIBLE",
      suppressed: reason === "suppressed",
      reason,
      reasonLabel: eligibilityReasonLabel ?? policyReasonLabel(reason).en,
      reasonLabels: policyReasonLabel(reason),
      checkedAt: now,
      channel: disposition === "ELIGIBLE" ? "TELEGRAM_BOT" : "MANUAL",
      destination:
        disposition === "ELIGIBLE"
          ? "Telegram (bot, recipient already started it)"
          : (prospect.publicUrl ?? "No public channel recorded"),
      previewBody,
      cta: campaign.cta ?? null,
    });
  }

  // Quota: every matched recipient stays visible to the reviewer; the quota
  // only decides which ones this run would actually prepare. Sorting puts the
  // actionable ones first so a long list stays reviewable.
  const DISPOSITION_RANK: Record<RecipientDisposition, number> = {
    ELIGIBLE: 0,
    MANUAL_ONLY: 1,
    BLOCKED: 2,
  };
  const ordered = [...recipients].sort(
    (a, b) =>
      DISPOSITION_RANK[a.disposition] - DISPOSITION_RANK[b.disposition] ||
      String(a.city ?? "").localeCompare(String(b.city ?? "")) ||
      String(a.segment ?? "").localeCompare(String(b.segment ?? "")) ||
      a.publicName.localeCompare(b.publicName)
  );

  let quotaUsed = 0;
  for (const recipient of ordered) {
    if (recipient.disposition !== "BLOCKED" && quotaUsed < limit) {
      recipient.withinQuota = true;
      quotaUsed += 1;
    } else if (recipient.disposition !== "BLOCKED") {
      recipient.heldOver = true;
    } else {
      excluded.push({
        prospectId: recipient.prospectId,
        publicName: recipient.publicName,
        city: recipient.city,
        segment: recipient.segment,
        reason: recipient.reason,
      });
    }
  }

  const heldCount = ordered.filter((r) => r.heldOver).length;
  if (heldCount > 0) {
    warnings.push(
      `${heldCount} recipient(s) exceed the send limit (${limit}) and will be held for a later run.`
    );
  }

  const countBy = (d: RecipientDisposition) =>
    ordered.filter((r) => r.disposition === d).length;

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
    blocked: countBy("BLOCKED"),
    approvable: ordered.filter((r) => r.disposition === "ELIGIBLE" && r.withinQuota).length,
    heldOver: heldCount,
    blockedBreakdown,
    excluded,
    byCitySegment: [...matrix.values()].sort(
      (a, b) =>
        String(a.city).localeCompare(String(b.city)) ||
        String(a.segment).localeCompare(String(b.segment))
    ),
    recipients: ordered,
    warnings,
    generatedAt: now,
    settingsPaused: !outreachDeliveryGate(settings).ok,
    settings: {
      enabled: settings.enabled,
      autoSendEnabled: settings.autoSendEnabled,
      enabledSource: settings.sources.enabled,
      autoSendEnabledSource: settings.sources.autoSendEnabled,
      warnings: settings.warnings,
    },
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

  await prisma.$transaction(async (tx) => {
  await tx.outreachCampaign.update({
    where: { id: campaignId },
    data: {
      lastDryRunAt: new Date(),
      // A dry run moves the campaign forward to REVIEW, never to APPROVED.
      status: campaign.status === "DRAFT" ? "REVIEW" : campaign.status,
      ...(actorUserId ? { requestedById: actorUserId } : {}),
    },
  });

  await recordAuditEvent({
    scope: "campaign",
    entityId: campaignId,
    action: "campaign.dry_run",
    actorUserId,
    detail: `eligible=${plan.eligible} manualOnly=${plan.manualOnly} blocked=${plan.blocked}`,
  }, tx);
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
  if (!["DRAFT", "REVIEW"].includes(campaign.status)) {
    return {
      ok: false,
      error: `A campaign in status ${campaign.status} cannot be approved again.`,
    };
  }
  const settings = await getOutreachSettings();
  const gate = outreachDeliveryGate(settings);
  if (!gate.ok) return { ok: false, error: gate.reason };
  if (!campaign.lastDryRunAt) {
    return { ok: false, error: "Run a dry run before approving." };
  }

  // The plan is recomputed here, so approval can never act on a stale or
  // client-supplied eligibility result.
  const plan = await planCampaign(campaign);
  if (!plan.generatedAt || plan.recipients.some((r) => !r.checkedAt)) {
    return {
      ok: false,
      error:
        "Eligibility could not be computed for every recipient. Refresh the plan and retry.",
    };
  }
  if (plan.settingsPaused) {
    return { ok: false, error: "Outreach is paused in settings; approval is blocked." };
  }
  // Every recipient this run would actually prepare has to be ELIGIBLE.
  // Blocked and quota-held-over recipients stay visible for review but do not
  // have to be fixed before the campaign can go ahead.
  const actionable = plan.recipients.filter(
    (r) => r.disposition !== "BLOCKED" && r.withinQuota
  );
  const ineligible = actionable.filter((r) => r.disposition !== "ELIGIBLE");
  if (ineligible.length > 0) {
    const first = ineligible[0];
    return {
      ok: false,
      error:
        `Every recipient inside the send quota must have current bot consent and eligibility before campaign approval. ` +
        `Blocked: ${first.publicName} — ${first.reasonLabel ?? first.reason}.`,
    };
  }

  if (actionable.length === 0) {
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

  await prisma.$transaction(async (tx) => {
  await tx.outreachCampaign.update({
    where: { id: campaignId },
    data: {
      status: "APPROVED",
      approvedAt: new Date(),
      approvedById: actorUserId ?? null,
    },
  });

  await recordAuditEvent({
    scope: "campaign",
    entityId: campaignId,
    action: "campaign.approved",
    actorUserId,
    detail: `eligible=${plan.eligible} manualOnly=${plan.manualOnly}`,
  }, tx);
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
  // Only recipients that are not blocked AND inside the send quota are drafted.
  // The plan lists every matched recipient for review, blocked ones included,
  // so preparation has to filter rather than trust the list as-is. Recipients
  // without bot consent stay MANUAL_ONLY and are still drafted for a human to
  // review; `prepareInvitations` re-checks the policy per recipient anyway.
  const prospectIds = plan.recipients
    .filter((r) => r.disposition !== "BLOCKED" && r.withinQuota)
    .map((r) => r.prospectId);

  if (prospectIds.length === 0) {
    return { ok: false, error: "No recipients to prepare." };
  }

  const result = await prisma.$transaction(async (tx) => {
    const prepared = await prepareInvitations({
      limit: plan.sendLimit, actorUserId, campaignId,
      templateId: campaign.templateId, prospectIds, db: tx,
    });
    await tx.outreachCampaign.update({
      where: { id: campaignId }, data: { lastPreparedAt: new Date() },
    });
    await recordAuditEvent({ scope: "campaign", entityId: campaignId,
      action: "campaign.prepared", actorUserId,
      detail: `prepared=${prepared.prepared.length} skipped=${prepared.skipped.length}` }, tx);
    return prepared;
  });
  const reasons: Record<string, number> = {};
  for (const skip of result.skipped) {
    reasons[skip.reason] = (reasons[skip.reason] ?? 0) + 1;
  }

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
    .map((c) => cityLabel(c, lang))
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

  const settings = await getOutreachSettings();
  const gate = outreachDeliveryGate(settings);
  if (!gate.ok) return { ok: false, error: gate.reason };

  // Bulk approval is all-or-nothing inside ONE transaction:
  //   1. every DRAFT is re-validated against the live policy (verification,
  //      suppression, opt-out, bot consent, kill switch, invitation state),
  //   2. any ineligible recipient aborts the whole batch by throwing, which
  //      rolls back every approval already applied in this transaction,
  //   3. the guarded conditional update makes the approval concurrency-safe:
  //      a concurrent status change makes the count mismatch and rolls back.
  // No partial, "approved what happened to be eligible" batch is ever left
  // behind — the administrator reviews and fixes the blocked recipients.
  try {
    const approved = await prisma.$transaction(async (tx) => {
      const drafts = await tx.outreachInvitation.findMany({
        where: { campaignId, status: "DRAFT" },
        include: { prospect: true },
      });

      if (drafts.length === 0) return 0;

      for (const draft of drafts) {
        const policy = await approvalPolicy(draft.prospect, {
          db: tx,
          settings,
          invitation: {
            id: draft.id,
            status: draft.status,
            campaignId: draft.campaignId,
          },
          campaignStatus: campaign.status,
          allowedInvitationStatuses: ["DRAFT"],
          requireApprovedCampaign: true,
        });
        if (!policy.canApprove) {
          throw new BulkApprovalBlocked(
            `${draft.prospect.publicName}: ${policy.message}`
          );
        }
      }

      const now = new Date();
      let count = 0;
      for (const draft of drafts) {
        // Conditional on the state we just validated: a concurrent change
        // (un-verified, opted out, deleted, already approved elsewhere) makes
        // this update a no-op and the batch is rolled back.
        const updated = await tx.outreachInvitation.updateMany({
          where: {
            id: draft.id,
            status: "DRAFT",
            prospect: { verificationStatus: "VERIFIED", optedOutAt: null },
          },
          data: {
            status: "APPROVED",
            approvedAt: now,
            approvedByUserId: actorUserId ?? null,
            reviewedAt: now,
          },
        });
        if (updated.count !== 1) {
          throw new BulkApprovalBlocked(
            `${draft.prospect.publicName}: state changed during approval; nothing was approved. Refresh and retry.`
          );
        }
        count += 1;
      }

      if (count !== drafts.length) {
        throw new BulkApprovalBlocked(
          "Invitation list changed; refresh and retry approval."
        );
      }

      await recordAuditEvent(
        {
          scope: "invitation",
          entityId: campaignId,
          action: "invitations.approved",
          actorUserId,
          detail: `approved=${count}`,
        },
        tx
      );

      return count;
    });

    return { ok: true, approved };
  } catch (error) {
    if (error instanceof BulkApprovalBlocked) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

/** Aborts (and rolls back) a bulk approval without approving the eligible subset. */
class BulkApprovalBlocked extends Error {}

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

  // Global pause: the same switches the daily job honours must stop a manual
  // send from the admin dashboard too. Outreach disabled or auto-delivery off
  // means NOTHING goes out, from any surface.
  const gate = await currentOutreachDeliveryGate();
  if (!gate.ok) return { ok: false, error: gate.reason };

  await prisma.$transaction(async (tx) => {
    await tx.outreachCampaign.update({ where: { id: options.campaignId }, data: { status: "SENDING" } });
    await recordAuditEvent({ scope: "campaign", entityId: options.campaignId,
      action: "campaign.delivery_started" }, tx);
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

    await prisma.$transaction(async (tx) => {
    await tx.outreachCampaign.update({
      where: { id: options.campaignId },
      data: {
        status: failed > 0 && sent === 0 ? "FAILED" : "COMPLETED",
      },
    });

    await recordAuditEvent({
      scope: "campaign",
      entityId: options.campaignId,
      action: "campaign.delivery",
      detail: `sent=${sent} delivered=${delivered} failed=${failed} skipped=${skipped}`,
    }, tx);
    });

    return { ok: true, sent, delivered, failed, skipped };
  } catch (error) {
    await prisma.$transaction(async (tx) => {
    await tx.outreachCampaign.update({
      where: { id: options.campaignId },
      data: { status: "FAILED" },
    });
    await recordAuditEvent({
      scope: "campaign",
      entityId: options.campaignId,
      action: "campaign.delivery_failed",
      detail: `error=${error instanceof Error ? error.name : "UnknownError"}`,
    }, tx);
    });

    return {
      ok: false,
      error: error instanceof Error ? error.name : "UnknownError",
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Campaign message builder                                                    */
/* -------------------------------------------------------------------------- */

export type CampaignMessageInput = {
  /** Editable invitation text; may use {businessName}, {link}, {category}. */
  message: string;
  language?: unknown;
  cta?: string | null;
  destinations?: Partial<DestinationSelection> | null;
  /**
   * Explicit primary destination (website, wa.me contact link, ...). Validated
   * as an http(s) URL; stored on `campaign.destinationUrl`.
   */
  destinationUrl?: string | null;
  /** Attach an existing template instead of the campaign-scoped one. */
  templateId?: string | null;
};

export type CampaignMessageSaveResult =
  | {
      ok: true;
      campaignId: string;
      templateId: string;
      /** The exact body stored for preparation. */
      body: string;
      /** Destinations that will appear in the final message. */
      links: Array<{ kind: string; value: string }>;
      /** Rendered preview with a sample business name and link. */
      preview: string;
    }
  | { ok: false; errors: string[] };

function campaignTemplateCode(campaignCode: string): string {
  return `msg_${campaignCode.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase()}`;
}

/**
 * Save a campaign's edited message as its own invitation template and point
 * the campaign at it.
 *
 * Deliberately reuses the existing `invitation_templates` table — no schema
 * change, and preparation stays idempotent because the campaign's `templateId`
 * is what `prepareInvitations` renders. Allowed ONLY while the campaign is
 * DRAFT or REVIEW: after approval the message is frozen, exactly like
 * targeting, so what was approved is what gets prepared.
 */
export async function saveCampaignMessage(
  campaignId: string,
  input: CampaignMessageInput,
  actorUserId?: string | null
): Promise<CampaignMessageSaveResult> {
  const campaign = await prisma.outreachCampaign.findUnique({
    where: { id: campaignId },
  });
  if (!campaign) return { ok: false, errors: ["campaign.notFound"] };
  if (campaign.status !== "DRAFT" && campaign.status !== "REVIEW") {
    return { ok: false, errors: ["campaign.locked"] };
  }

  const settings = await getOutreachSettings();
  const language = normalizeLanguage(input.language ?? campaign.language ?? "fa");

  let destinationUrl: string | null = null;
  if (typeof input.destinationUrl === "string" && input.destinationUrl.trim().length > 0) {
    const valid = validateDestinationUrl(input.destinationUrl);
    if (!valid.ok) return { ok: false, errors: [`destinationUrl.${valid.reason}`] };
    destinationUrl = valid.url;
  }

  const composed = composeCampaignMessage({
    message: input.message,
    cta: input.cta ?? null,
    destinations: input.destinations ?? null,
    channelUrl: settings.channelUrl,
    otherUrl: destinationUrl ?? campaign.destinationUrl ?? null,
  });

  if (composed.errors.length > 0) return { ok: false, errors: composed.errors };

  const bodyError = validateTemplateBody(composed.body);
  if (bodyError) return { ok: false, errors: [bodyError] };

  const templateCode = campaignTemplateCode(campaign.code);
  const existing = await prisma.invitationTemplate.findUnique({
    where: { code: templateCode },
    select: { id: true },
  });

  const template = await prisma.$transaction(async (tx) => {
  const template = existing
    ? await tx.invitationTemplate.update({
        where: { id: existing.id },
        data: { body: composed.body, language, active: true },
      })
    : await tx.invitationTemplate.create({
        data: {
          code: templateCode,
          language,
          category: "ALL",
          body: composed.body,
          active: true,
        },
      });

  await tx.outreachCampaign.update({
    where: { id: campaignId },
    data: {
      language,
      templateId: template.id,
      cta:
        typeof input.cta === "string" && input.cta.trim().length > 0
          ? input.cta.trim().slice(0, 120)
          : null,
      destinationUrl,
    },
  });

  await recordAuditEvent({
    scope: "message",
    entityId: campaignId,
    action: "campaign.message_saved",
    actorUserId,
    detail: `language=${language} destinations=${composed.links.map((l) => l.kind).join("+") || "none"} length=${composed.body.length}`,
  }, tx);
  return template;
  });

  const preview = renderTemplate(composed.body, {
    businessName: campaign.name,
    link: buildBotDeepLink(`preview_${campaign.code.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40)}`),
    categoryLabel: categoryLabel("BARBER", language),
  });

  return {
    ok: true,
    campaignId,
    templateId: template.id,
    body: composed.body,
    links: composed.links,
    preview,
  };
}
