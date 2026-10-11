import { prisma } from "@/lib/prisma";
import {
  evaluateOutreachPolicy,
  isClosedStatus as policyIsClosedStatus,
  isSuppressed as policyIsSuppressed,
  resolveTelegramUserId as policyResolveTelegramUserId,
  type DbClient,
  type OutreachDecision,
  type PolicyResult,
} from "@/lib/outreach/policy";
import type { OutreachSettings } from "@/lib/outreach/settings";
import { CLOSED_PROSPECT_STATUSES } from "@/lib/outreach/types";

/**
 * Delivery eligibility — a thin compatibility layer over the single policy in
 * `policy.ts`.
 *
 * Nothing in this file implements its own rules any more: every call site
 * (campaign planning, preparation, approval, manual transitions, delivery)
 * resolves to `evaluateOutreachPolicy`, so there is no second, weaker check to
 * route around.
 */

export type EligibilityResult = {
  canAutoSend: boolean;
  reason: string;
  /** Full policy result for callers that need the plain-language explanation. */
  policy?: PolicyResult;
  decision?: OutreachDecision;
};

export const ELIGIBILITY_REASONS = {
  OK: "ok",
  NO_TELEGRAM_ID: "no_telegram_id",
  NOT_STARTED_BOT: "not_started_bot",
  OPTED_OUT: "opted_out",
  SUPPRESSED: "suppressed",
  CLOSED_STATUS: "closed_status",
  NOT_VERIFIED: "not_verified",
  CONSENT_REVOKED: "consent_revoked",
  CONSENT_EXPIRED: "consent_expired",
  SETTINGS_UNAVAILABLE: "settings_unavailable",
  OUTREACH_PAUSED: "outreach_paused",
  SUPPRESSION_UNAVAILABLE: "suppression_unavailable",
  DAILY_LIMIT: "daily_limit",
} as const;

export function isClosedStatus(status: string): boolean {
  return policyIsClosedStatus(status) || CLOSED_PROSPECT_STATUSES.includes(status as never);
}

/**
 * Check whether a prospect is on the do-not-contact list.
 * `identifiers` should already be normalized (`buildSuppressionIdentifier`).
 * Fails closed: an unreadable suppression list is treated as "do not contact".
 */
export async function isSuppressed(
  identifiers: Array<string | null | undefined>,
  db: DbClient = prisma
): Promise<boolean> {
  try {
    return await policyIsSuppressed(identifiers, db);
  } catch {
    // Fail closed: if the suppression list cannot be read, do not send.
    return true;
  }
}

export type EligibilityProspect = {
  id: string;
  status: string;
  telegramUsername: string | null;
  publicUrl: string | null;
  /**
   * A numeric Telegram id the caller already resolved, if any. Used only to
   * widen the do-not-contact lookup; consent still comes from the opt-in row.
   */
  telegramUserId?: string | null;
  optedOutAt?: Date | null;
  /** Required by the policy: an absent verification status is not verification. */
  verificationStatus?: string | null;
};

export async function checkEligibility(
  prospect: EligibilityProspect,
  options: {
    db?: DbClient;
    settings?: OutreachSettings;
    /** Enforce the outreach kill switch (default true). */
    enforceSettings?: boolean;
    /** Require an administrator verification (default true). */
    requireVerification?: boolean;
  } = {}
): Promise<EligibilityResult> {
  const policy = await evaluateOutreachPolicy(
    {
      id: prospect.id,
      status: prospect.status,
      verificationStatus: prospect.verificationStatus ?? null,
      telegramUsername: prospect.telegramUsername,
      publicUrl: prospect.publicUrl,
      optedOutAt: prospect.optedOutAt ?? null,
    },
    {
      db: options.db,
      settings: options.settings,
      enforceSettings: options.enforceSettings,
      requireVerification: options.requireVerification,
      knownTelegramUserId: prospect.telegramUserId ?? null,
    }
  );

  return {
    canAutoSend: policy.canAutoSend,
    reason: policy.reason,
    policy,
    decision: policy.decision,
  };
}

/**
 * Resolve a prospect's numeric Telegram id.
 *
 * We never guess this from a username: Telegram offers no public API to turn a
 * username into a user id. It is only filled in once the person actually starts
 * the bot through the attributed deep link.
 */
export async function resolveTelegramUserId(
  prospect: { id: string },
  db: DbClient = prisma
): Promise<string | null> {
  return policyResolveTelegramUserId(prospect, db);
}
