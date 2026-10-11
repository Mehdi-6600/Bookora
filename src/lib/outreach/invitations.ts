import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildBotDeepLink, buildProspectStartParam } from "@/lib/outreach/deeplink";
import {
  categoryLabel,
  renderTemplate,
  validateTemplateBody,
} from "@/lib/outreach/templates";
import {
  buildSuppressionIdentifier,
  normalizeTelegramUsername,
} from "@/lib/outreach/normalize";
import { ELIGIBILITY_REASONS, isClosedStatus } from "@/lib/outreach/eligibility";
import {
  isProspectCategory,
  normalizeLanguage,
  type OutreachLanguage,
  type ProspectCategory,
} from "@/lib/outreach/types";
import { deliverTelegramMessage } from "@/lib/telegram/notify";
import { evaluateOutreachPolicy } from "@/lib/outreach/policy";
import {
  currentOutreachDeliveryGate,
  getOutreachSettings,
  outreachDeliveryGate,
} from "@/lib/outreach/settings";
import { recordAuditEvent } from "@/lib/outreach/audit";

/**
 * Invitation lifecycle:
 *
 *   prepare -> DRAFT -> (admin approves) -> APPROVED -> (job delivers, only if
 *   the recipient already started the bot) -> SENT/DELIVERED  |  FAILED |
 *   SKIPPED (not eligible: prepare for manual outreach)
 *
 * Nothing is ever sent without an explicit APPROVED state, and nothing is
 * auto-sent to someone who has not started the bot.
 */

const FOLLOW_UP_DAYS = 4;

export type PreparedInvitation = {
  id: string;
  prospectId: string;
  publicName: string;
  language: string;
  body: string;
  deepLink: string;
  startParam: string;
};

export type PrepareResult = {
  prepared: PreparedInvitation[];
  skipped: Array<{ prospectId: string; reason: string }>;
};

function uniqueStartParam(): string {
  // 12 hex chars keeps the Telegram `start` parameter well under 64 chars.
  return buildProspectStartParam(randomUUID().replace(/-/g, "").slice(0, 12));
}

async function pickTemplate(
  language: OutreachLanguage,
  category: ProspectCategory,
  templateId?: string | null,
  db: Prisma.TransactionClient = prisma
) {
  if (templateId) {
    const explicit = await db.invitationTemplate.findUnique({
      where: { id: templateId },
    });
    if (explicit && explicit.active) return explicit;
  }

  const candidates = await db.invitationTemplate.findMany({
    where: { active: true, language },
    orderBy: [{ category: "asc" }, { createdAt: "asc" }],
  });

  if (candidates.length === 0) return null;

  return (
    candidates.find((template: { category: string }) => template.category === category) ??
    candidates.find((template: { category: string }) => template.category === "ALL") ??
    candidates[0]
  );
}

/**
 * Create DRAFT invitations for the best next prospects.
 *
 * Only VERIFIED prospects are ever drafted: discovery hits stay DISCOVERED
 * until an administrator verifies them, and verification is checked again at
 * approval and at delivery time, so an unverified business can never receive
 * an invitation from any path (campaign, generic prepare, or daily cron).
 *
 * Duplicate protection: a prospect that already has an invitation in DRAFT or
 * APPROVED state is skipped, so a retried run can never create a second
 * pending outreach for the same business.
 */
export async function prepareInvitations(options: {
  limit: number;
  actorUserId?: string | null;
  campaignId?: string | null;
  templateId?: string | null;
  prospectIds?: string[];
  db?: Prisma.TransactionClient;
}): Promise<PrepareResult> {
  const db = options.db ?? prisma;
  const limit = Math.max(0, Math.min(100, Math.round(options.limit)));
  if (limit === 0) return { prepared: [], skipped: [] };

  const where: Record<string, unknown> = {
    verificationStatus: "VERIFIED",
    optedOutAt: null,
    // Mirrors the campaign planner's contactable + follow-upable statuses, so
    // a dry-run recipient is never silently dropped at preparation time.
    status: { in: ["NEW", "INTERESTED", "CONTACTED", "STARTED_BOT"] },
  };

  if (options.prospectIds && options.prospectIds.length > 0) {
    where.id = { in: options.prospectIds.slice(0, 200) };
  }
  if (options.campaignId) {
    where.campaignId = options.campaignId;
  }

  const prospects = await db.outreachProspect.findMany({
    where,
    orderBy: [{ nextFollowUpAt: "asc" }, { createdAt: "asc" }],
    take: Math.max(limit * 3, 30),
  });

  // The kill switch is read once per preparation run and re-applied per
  // recipient through the shared policy: preparation is the first step towards
  // an outbound message, so it must never run while outreach is switched off
  // or the settings cannot be read.
  const settings = await getOutreachSettings();
  const gate = outreachDeliveryGate(settings);
  if (!gate.ok) {
    throw new Error(gate.reason);
  }

  const alreadyPending = new Set(
    (
      await db.outreachInvitation.findMany({
        where: { status: { in: ["DRAFT", "APPROVED"] } },
        select: { prospectId: true },
      })
    ).map((row: { prospectId: string }) => row.prospectId)
  );

  const prepared: PreparedInvitation[] = [];
  const skipped: Array<{ prospectId: string; reason: string }> = [];

  for (const prospect of prospects) {
    if (prepared.length >= limit) break;

    if (isClosedStatus(prospect.status)) {
      skipped.push({ prospectId: prospect.id, reason: "closed_status" });
      continue;
    }

    if (alreadyPending.has(prospect.id)) {
      skipped.push({ prospectId: prospect.id, reason: "already_pending" });
      continue;
    }

    // The same policy approval and delivery use. BLOCKED recipients
    // (unverified, opted out, suppressed, closed, outreach paused) are never
    // drafted; MANUAL_ONLY ones are drafted for a human reviewer.
    const policy = await evaluateOutreachPolicy(
      {
        id: prospect.id,
        status: prospect.status,
        verificationStatus: prospect.verificationStatus,
        telegramUsername: prospect.telegramUsername,
        publicUrl: prospect.publicUrl,
        optedOutAt: prospect.optedOutAt,
      },
      { db, settings }
    );

    if (policy.decision === "BLOCKED") {
      skipped.push({ prospectId: prospect.id, reason: policy.reason });
      continue;
    }

    const language = normalizeLanguage(prospect.language);
    const category: ProspectCategory = isProspectCategory(prospect.category)
      ? prospect.category
      : "OTHER";

    const template = await pickTemplate(language, category, options.templateId, db);
    if (!template) {
      skipped.push({ prospectId: prospect.id, reason: "no_template" });
      continue;
    }

    const bodyError = validateTemplateBody(template.body);
    if (bodyError) {
      skipped.push({ prospectId: prospect.id, reason: bodyError });
      continue;
    }

    let startParam = uniqueStartParam();
    // Extremely unlikely collision guard.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const clash = await db.outreachInvitation.findUnique({
        where: { startParam },
        select: { id: true },
      });
      if (!clash) break;
      startParam = uniqueStartParam();
    }

    const deepLink = buildBotDeepLink(startParam);
    const body = renderTemplate(template.body, {
      businessName: prospect.publicName,
      link: deepLink,
      categoryLabel: categoryLabel(category, language),
    });

    const invitation = await db.outreachInvitation.create({
      data: {
        prospectId: prospect.id,
        templateId: template.id,
        campaignId: prospect.campaignId ?? options.campaignId ?? null,
        channel: "TELEGRAM",
        language,
        body,
        deepLink,
        startParam,
        status: "DRAFT",
        createdById: options.actorUserId ?? null,
      },
    });

    alreadyPending.add(prospect.id);
    prepared.push({
      id: invitation.id,
      prospectId: prospect.id,
      publicName: prospect.publicName,
      language,
      body: invitation.body,
      deepLink: invitation.deepLink,
      startParam: invitation.startParam,
    });
  }

  return { prepared, skipped };
}

export type SendOutcome = {
  invitationId: string;
  status: "SENT" | "DELIVERED" | "FAILED" | "SKIPPED";
  reason: string;
};

/**
 * Deliver APPROVED invitations.
 *
 * A message is only sent to a VERIFIED prospect we can prove started the bot.
 * Everyone else is marked SKIPPED with the reason surfaced in the run report
 * so the administrator can do manual, targeted outreach instead — or verify
 * the prospect first. Verification is re-checked here (not just at approval)
 * so a prospect unverified after approval is never messaged.
 */
export async function sendApprovedInvitations(options: {
  limit: number;
  /** Restrict delivery to a single campaign. */
  campaignId?: string | null;
}): Promise<SendOutcome[]> {
  const limit = Math.max(0, Math.min(100, Math.round(options.limit)));

  // Kill switch, checked before the batch starts…
  const startGate = await currentOutreachDeliveryGate();
  if (!startGate.ok) throw new Error(startGate.reason);

  const pending = await prisma.outreachInvitation.findMany({
    where: {
      status: "APPROVED",
      ...(options.campaignId ? { campaignId: options.campaignId } : {}),
    },
    orderBy: { approvedAt: "asc" },
    take: limit,
    include: {
      prospect: {
        select: {
          id: true,
          status: true,
          verificationStatus: true,
          telegramUsername: true,
          publicUrl: true,
          optedOutAt: true,
        },
      },
      campaign: { select: { status: true } },
    },
  });

  const outcomes: SendOutcome[] = [];

  for (const invitation of pending) {
    // …and re-checked, together with every other gate, inside the same
    // transaction that clears (or skips) this specific invitation. Nothing is
    // delivered on the strength of an earlier check in this loop.
    const decision = await prisma.$transaction(async (tx) => {
      const policy = await evaluateOutreachPolicy(
        {
          id: invitation.prospect.id,
          status: invitation.prospect.status,
          verificationStatus: invitation.prospect.verificationStatus,
          telegramUsername: invitation.prospect.telegramUsername,
          publicUrl: invitation.prospect.publicUrl,
          optedOutAt: invitation.prospect.optedOutAt,
        },
        {
          db: tx,
          invitation: {
            id: invitation.id,
            status: invitation.status,
            campaignId: invitation.campaignId,
          },
          campaignStatus: invitation.campaign?.status ?? null,
          allowedInvitationStatuses: ["APPROVED"],
          // A campaign invitation is only delivered while its campaign is
          // approved or actively sending.
          requireApprovedCampaign: Boolean(invitation.campaignId),
          allowedCampaignStatuses: ["APPROVED", "SENDING"],
        }
      );

      if (!policy.canAutoSend) {
        // A paused or unreadable kill switch is a configuration state, not a
        // fact about the recipient: the invitation stays APPROVED so an
        // authorized run can still deliver it. Anything else (opt-out,
        // suppression, revoked consent, lost verification) is terminal for
        // automated delivery and is marked SKIPPED with the reason.
        const paused =
          policy.reason === "outreach_paused" ||
          policy.reason === "settings_unavailable";

        if (!paused) {
          await tx.outreachInvitation.update({
            where: { id: invitation.id },
            data: {
              status: "SKIPPED",
              failureReason: policy.reason,
              reviewedAt: new Date(),
            },
          });
        }

        await recordAuditEvent(
          {
            scope: "invitation",
            entityId: invitation.id,
            action: paused ? "invitation.delivery_paused" : "invitation.skipped",
            detail: `reason=${policy.reason}`,
          },
          tx
        );
        return { ok: false as const, reason: policy.reason };
      }

      return { ok: true as const, telegramUserId: policy.telegramUserId as string };
    });

    if (!decision.ok) {
      outcomes.push({
        invitationId: invitation.id,
        status: "SKIPPED",
        reason: decision.reason,
      });
      continue;
    }

    const telegramUserId = decision.telegramUserId;

    // Final server-side kill-switch read, immediately before the claim and the
    // outbound call: a settings change mid-run stops the remaining recipients.
    const gate = await currentOutreachDeliveryGate();
    if (!gate.ok) {
      outcomes.push({
        invitationId: invitation.id,
        status: "SKIPPED",
        reason: "outreach_paused",
      });
      continue;
    }

    // Claim the invitation with a conditional update so two concurrent workers
    // can never send the same message twice.
    const reserved = await prisma.$transaction(async (tx) => {
      const claimed = await tx.outreachInvitation.updateMany({
        where: {
          id: invitation.id,
          status: "APPROVED",
          prospect: { verificationStatus: "VERIFIED", optedOutAt: null },
        },
        data: { status: "SENDING" },
      });
      if (!claimed.count) return false;
      await recordAuditEvent(
        {
          scope: "invitation",
          entityId: invitation.id,
          action: "invitation.delivery_started",
          detail: `prospect=${invitation.prospect.id}`,
        },
        tx
      );
      return true;
    });
    if (!reserved) {
      outcomes.push({
        invitationId: invitation.id,
        status: "SKIPPED",
        reason: "state_changed",
      });
      continue;
    }

    // An audit failure before this point prevents the external send entirely.
    // SENDING is never retried automatically if the result write fails.
    const result = await deliverTelegramMessage(telegramUserId, invitation.body);
    const now = new Date();

    if (!result.ok) {
      const failure = await prisma.$transaction(async (tx) => {
        await tx.outreachInvitation.update({
          where: { id: invitation.id },
          data: {
            status: "FAILED",
            failureReason: result.error,
            sentAt: now,
          },
        });

        if (result.blocked) {
          await tx.telegramBotOptIn.updateMany({
            where: { telegramId: telegramUserId },
            data: { revokedAt: now },
          });
          await tx.outreachProspect.update({
            where: { id: invitation.prospect.id },
            data: {
              status: "DO_NOT_CONTACT",
              optedOutAt: now,
              notes: "Blocked or unreachable in Telegram (403).",
            },
          });
        }

        await recordAuditEvent(
          {
            scope: "invitation",
            entityId: invitation.id,
            action: "invitation.delivery_failed",
            detail: `code=${result.errorCode ?? "unknown"}`,
          },
          tx
        );
      }).then(
        () => null,
        (error: unknown) => error
      );

      // A failed result write must be surfaced, never reported as success.
      if (failure) throw failure;

      outcomes.push({
        invitationId: invitation.id,
        status: "FAILED",
        reason: result.error,
      });
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await tx.outreachInvitation.update({
        where: { id: invitation.id },
        data: {
          status: "DELIVERED",
          sentAt: now,
          deliveredAt: now,
          failureReason: null,
        },
      });

      await tx.outreachProspect.update({
        where: { id: invitation.prospect.id },
        data: {
          status:
            invitation.prospect.status === "NEW"
              ? "CONTACTED"
              : invitation.prospect.status,
          lastContactedAt: now,
          contactedCount: { increment: 1 },
          nextFollowUpAt: new Date(now.getTime() + FOLLOW_UP_DAYS * 24 * 60 * 60 * 1000),
        },
      });

      await recordAuditEvent(
        {
          scope: "invitation",
          entityId: invitation.id,
          action: "invitation.delivered",
          detail: `prospect=${invitation.prospect.id}`,
        },
        tx
      );
    });
    outcomes.push({
      invitationId: invitation.id,
      status: "DELIVERED",
      reason: ELIGIBILITY_REASONS.OK,
    });
  }

  return outcomes;
}

/**
 * Mark a prospect opted out and add every known identifier to the suppression
 * list.
 *
 * Withdrawing consent is never blocked by an unavailable audit store: the
 * suppression rows and the prospect state are committed first, and an audit
 * failure is then re-thrown so the caller surfaces it (log / admin error)
 * instead of reporting a clean success.
 */
export async function recordOptOut(input: {
  telegramId?: string | null;
  telegramUsername?: string | null;
  publicUrl?: string | null;
  prospectId?: string | null;
  note?: string | null;
  /** Who performed the opt-out, when a human did it from the dashboard. */
  actorUserId?: string | null;
  /** Short, safe provenance tag, e.g. "telegram_stop" or "admin_dashboard". */
  source?: string;
}): Promise<void> {
  const now = new Date();

  const identifiers = [
    input.telegramId ? `user:${input.telegramId}` : null,
    buildSuppressionIdentifier({
      telegramUsername: input.telegramUsername,
      publicUrl: input.publicUrl,
    }),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  await prisma.$transaction(async (tx) => {
    for (const identifier of identifiers) {
      await tx.outreachSuppression.upsert({
        where: { identifier },
        update: { reason: "OPT_OUT", note: input.note ?? null },
        create: { identifier, reason: "OPT_OUT", note: input.note ?? null },
      });
    }

    // Also suppress the username form when only a numeric id was supplied.
    if (input.telegramId) {
      const user = await tx.user.findUnique({
        where: { telegramId: input.telegramId },
        select: { telegramUsername: true },
      });
      const username = normalizeTelegramUsername(user?.telegramUsername ?? null);
      if (username) {
        await tx.outreachSuppression.upsert({
          where: { identifier: `tg:${username}` },
          update: { reason: "OPT_OUT", note: input.note ?? null },
          create: { identifier: `tg:${username}`, reason: "OPT_OUT", note: input.note ?? null },
        });
      }
    }

    if (input.prospectId) {
      await tx.outreachProspect.update({
        where: { id: input.prospectId },
        data: { status: "DO_NOT_CONTACT", optedOutAt: now },
      });
    }
  });

  // Audit after the fact: the withdrawal itself is already durable.
  await recordAuditEvent({
    scope: "prospect",
    entityId: input.prospectId ?? null,
    action: "prospect.opted_out",
    actorUserId: input.actorUserId ?? null,
    detail: `source=${input.source ?? "unknown"} identifiers=${identifiers.length}`,
  });
}
