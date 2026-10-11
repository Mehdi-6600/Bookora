import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { BOT_CONSENT_MAX_AGE_MS } from "@/lib/outreach/bot-consent";
import { buildSuppressionIdentifier } from "@/lib/outreach/normalize";
import {
  CLOSED_PROSPECT_STATUSES,
  type ProspectStatus,
} from "@/lib/outreach/types";
import {
  getOutreachSettings,
  outreachDeliveryGate,
  type OutreachSettings,
} from "@/lib/outreach/settings";

/**
 * The ONE outreach eligibility policy.
 *
 * Every surface that can move an invitation towards an outbound message —
 * campaign planning, preparation, individual approval, bulk approval, manual
 * status transitions and delivery itself — calls `evaluateOutreachPolicy`
 * (directly or through the thin wrappers in `eligibility.ts` /
 * `approval-eligibility.ts`). There is deliberately no second implementation:
 * a divergent check would be a way around the consent rules.
 *
 * Ordering matters and is fail-closed at every step:
 *
 *   1. effective outreach settings (unreadable or switched off => blocked),
 *   2. terminal prospect status / opt-out,
 *   3. do-not-contact suppression list (unreadable => blocked),
 *   4. administrator verification,
 *   5. a current, unrevoked, unexpired private bot /start for THIS prospect,
 *   6. invitation and campaign state, when they are known.
 *
 * A `User` row, a Mini App login, a public Telegram username or prospect
 * verification are never treated as permission to send: only step 5 grants it.
 */

export const OUTREACH_DECISIONS = ["ELIGIBLE", "MANUAL_ONLY", "BLOCKED"] as const;
export type OutreachDecision = (typeof OUTREACH_DECISIONS)[number];

/** Stable, machine-readable reason codes. */
export const POLICY_REASONS = {
  OK: "ok",
  NOT_VERIFIED: "not_verified",
  NO_TELEGRAM_ID: "no_telegram_id",
  NOT_STARTED_BOT: "not_started_bot",
  CONSENT_REVOKED: "consent_revoked",
  CONSENT_EXPIRED: "consent_expired",
  OPTED_OUT: "opted_out",
  SUPPRESSED: "suppressed",
  SUPPRESSION_UNAVAILABLE: "suppression_unavailable",
  CLOSED_STATUS: "closed_status",
  SETTINGS_UNAVAILABLE: "settings_unavailable",
  OUTREACH_PAUSED: "outreach_paused",
  INVALID_INVITATION_STATE: "invalid_invitation_state",
  CAMPAIGN_NOT_APPROVED: "campaign_not_approved",
  DAILY_LIMIT: "daily_limit",
} as const;

export type PolicyReason =
  (typeof POLICY_REASONS)[keyof typeof POLICY_REASONS];

/** Plain-language explanation shown to the administrator next to the code. */
export const POLICY_REASON_LABELS: Record<
  string,
  { en: string; fa: string; ar: string }
> = {
  [POLICY_REASONS.OK]: {
    en: "Eligible: verified, consented and not suppressed.",
    fa: "واجد شرایط: تأیید شده، دارای رضایت و خارج از فهرست عدم تماس.",
    ar: "مؤهل: تم التحقق، لديه موافقة وليس في قائمة الحظر.",
  },
  [POLICY_REASONS.NOT_VERIFIED]: {
    en: "Blocked: the prospect is not verified by an administrator.",
    fa: "مسدود: این کسب‌وکار توسط مدیر تأیید نشده است.",
    ar: "محظور: لم يتم التحقق من هذا النشاط من قبل المسؤول.",
  },
  [POLICY_REASONS.NO_TELEGRAM_ID]: {
    en: "Manual only: no Telegram user id is bound to this prospect.",
    fa: "فقط دستی: هیچ شناسه تلگرامی به این مورد متصل نیست.",
    ar: "يدوي فقط: لا يوجد معرّف تلغرام مرتبط بهذا النشاط.",
  },
  [POLICY_REASONS.NOT_STARTED_BOT]: {
    en: "Manual only: this person has not started the bot, so the bot may not message them.",
    fa: "فقط دستی: این فرد بات را استارت نزده است؛ ارسال پیام خودکار مجاز نیست.",
    ar: "يدوي فقط: لم يبدأ هذا الشخص تشغيل البوت، لذا لا يمكن للبوت مراسلته.",
  },
  [POLICY_REASONS.CONSENT_REVOKED]: {
    en: "Blocked: the recipient withdrew bot permission.",
    fa: "مسدود: گیرنده اجازه ارسال پیام را پس گرفته است.",
    ar: "محظور: سحب المستلم إذن المراسلة.",
  },
  [POLICY_REASONS.CONSENT_EXPIRED]: {
    en: "Manual only: the stored bot consent is older than 90 days.",
    fa: "فقط دستی: رضایت ثبت‌شده قدیمی‌تر از ۹۰ روز است.",
    ar: "يدوي فقط: الموافقة المسجلة أقدم من 90 يوماً.",
  },
  [POLICY_REASONS.OPTED_OUT]: {
    en: "Blocked: this prospect opted out.",
    fa: "مسدود: این مورد درخواست عدم دریافت پیام داده است.",
    ar: "محظور: طلب هذا النشاط عدم التواصل.",
  },
  [POLICY_REASONS.SUPPRESSED]: {
    en: "Blocked: this contact is on the do-not-contact list.",
    fa: "مسدود: این مخاطب در فهرست عدم تماس است.",
    ar: "محظور: جهة الاتصال في قائمة عدم الاتصال.",
  },
  [POLICY_REASONS.SUPPRESSION_UNAVAILABLE]: {
    en: "Blocked: the do-not-contact list could not be read, so nothing is sent.",
    fa: "مسدود: فهرست عدم تماس قابل خواندن نیست؛ ارسالی انجام نمی‌شود.",
    ar: "محظور: تعذّر قراءة قائمة عدم الاتصال، لذلك لن يتم الإرسال.",
  },
  [POLICY_REASONS.CLOSED_STATUS]: {
    en: "Blocked: the prospect is closed (not interested / do not contact).",
    fa: "مسدود: وضعیت این مورد بسته شده است.",
    ar: "محظور: حالة هذا النشاط مغلقة.",
  },
  [POLICY_REASONS.SETTINGS_UNAVAILABLE]: {
    en: "Blocked: outreach settings could not be read.",
    fa: "مسدود: تنظیمات ارسال قابل خواندن نیست.",
    ar: "محظور: تعذّر قراءة إعدادات الإرسال.",
  },
  [POLICY_REASONS.OUTREACH_PAUSED]: {
    en: "Blocked: outreach is paused in settings.",
    fa: "مسدود: ارسال در تنظیمات متوقف شده است.",
    ar: "محظور: الإرسال موقوف في الإعدادات.",
  },
  [POLICY_REASONS.INVALID_INVITATION_STATE]: {
    en: "Blocked: the invitation is not in a state that allows this action.",
    fa: "مسدود: وضعیت دعوت‌نامه اجازه این عملیات را نمی‌دهد.",
    ar: "محظور: حالة الدعوة لا تسمح بهذا الإجراء.",
  },
  [POLICY_REASONS.CAMPAIGN_NOT_APPROVED]: {
    en: "Blocked: the campaign is not approved.",
    fa: "مسدود: کمپین تأیید نشده است.",
    ar: "محظور: الحملة غير معتمدة.",
  },
  [POLICY_REASONS.DAILY_LIMIT]: {
    en: "Held back: the daily sending limit is already reached.",
    fa: "نگه داشته شد: سقف ارسال روزانه پر شده است.",
    ar: "مؤجّل: تم الوصول إلى حد الإرسال اليومي.",
  },
};

export function policyReasonLabel(reason: string) {
  return (
    POLICY_REASON_LABELS[reason] ?? {
      en: `Blocked (${reason}).`,
      fa: `مسدود (${reason}).`,
      ar: `محظور (${reason}).`,
    }
  );
}

export type DbClient = Prisma.TransactionClient;

export function isClosedStatus(status: ProspectStatus | string): boolean {
  return CLOSED_PROSPECT_STATUSES.includes(status as ProspectStatus);
}

/**
 * Do-not-contact lookup.
 *
 * Fails closed: if the suppression table cannot be read the answer is "do not
 * contact", never "not found".
 */
export async function isSuppressed(
  identifiers: Array<string | null | undefined>,
  db: DbClient = prisma
): Promise<boolean> {
  const clean = identifiers.filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );

  if (clean.length === 0) return false;

  const found = await db.outreachSuppression.findFirst({
    where: { identifier: { in: clean } },
    select: { id: true },
  });

  return Boolean(found);
}

/** The prospect fields the policy needs. Extra fields are ignored. */
export type PolicyProspect = {
  id: string;
  status: string;
  verificationStatus?: string | null;
  telegramUsername?: string | null;
  publicUrl?: string | null;
  optedOutAt?: Date | null;
};

export type PolicyOptions = {
  /** Run the checks inside an open transaction so the answer is not stale. */
  db?: DbClient;
  /** Already-loaded settings. Re-read when omitted. */
  settings?: OutreachSettings;
  /**
   * Enforce the kill switch (default true). Planning and dry runs pass `false`
   * so the plan can still be rendered while `settingsPaused` is reported.
   */
  enforceSettings?: boolean;
  /** Require `verificationStatus === "VERIFIED"` (default true). */
  requireVerification?: boolean;
  /**
   * A numeric Telegram id the caller already knows for this prospect (for
   * example from an earlier resolution). It is only used to widen the
   * do-not-contact lookup — never as evidence of consent.
   */
  knownTelegramUserId?: string | null;
  /**
   * Invitation state, when the caller knows it. Approval must only be possible
   * from DRAFT and delivery only from APPROVED.
   */
  invitation?: { id?: string; status: string; campaignId?: string | null } | null;
  /** Campaign state for the invitation above. */
  campaignStatus?: string | null;
  /** Expected invitation states for this operation; anything else is blocked. */
  allowedInvitationStatuses?: string[];
  /** Require the invitation's campaign to be in a sendable state. */
  requireApprovedCampaign?: boolean;
  /** Campaign states accepted when `requireApprovedCampaign` is set. */
  allowedCampaignStatuses?: string[];
};

export type PolicyResult = {
  decision: OutreachDecision;
  reason: PolicyReason | string;
  /** Plain-language explanation (English) for API responses. */
  message: string;
  label: { en: string; fa: string; ar: string };
  /** True only when every gate passed: the bot may be asked to deliver. */
  canAutoSend: boolean;
  /** Approval arms automated delivery, so it uses the same gate. */
  canApprove: boolean;
  /** The kill switch blocks sending (settings read error or switched off). */
  settingsPaused: boolean;
  botConsent: boolean;
  suppressed: boolean;
  telegramUserId: string | null;
  verificationStatus: string | null;
  /** When the decision was computed, so a stale plan can never be approved. */
  checkedAt: Date;
};

function result(
  decision: OutreachDecision,
  reason: string,
  extra: Partial<PolicyResult> = {},
  checkedAt: Date
): PolicyResult {
  const label = policyReasonLabel(reason);
  return {
    decision,
    reason,
    message: label.en,
    label,
    canAutoSend: decision === "ELIGIBLE",
    canApprove: decision === "ELIGIBLE",
    settingsPaused: reason === POLICY_REASONS.OUTREACH_PAUSED,
    botConsent: false,
    suppressed: false,
    telegramUserId: null,
    verificationStatus: null,
    checkedAt,
    ...extra,
  };
}

/**
 * Evaluate every outreach rule for one prospect.
 *
 * Always call it as close as possible to the state change it authorises — and
 * inside the transaction that performs it, when there is one — so a concurrent
 * verification change, opt-out or consent revocation cannot slip through.
 */
export async function evaluateOutreachPolicy(
  prospect: PolicyProspect,
  options: PolicyOptions = {}
): Promise<PolicyResult> {
  const db = options.db ?? prisma;
  const checkedAt = new Date();
  const enforceSettings = options.enforceSettings !== false;
  const requireVerification = options.requireVerification !== false;

  // 1. Effective settings. Read failures and the kill switch both block.
  const settings = options.settings ?? (await getOutreachSettings());
  if (settings.readError) {
    return result("BLOCKED", POLICY_REASONS.SETTINGS_UNAVAILABLE, {
      settingsPaused: true,
      verificationStatus: prospect.verificationStatus ?? null,
    }, checkedAt);
  }
  if (enforceSettings) {
    const gate = outreachDeliveryGate(settings);
    if (!gate.ok) {
      return result("BLOCKED", POLICY_REASONS.OUTREACH_PAUSED, {
        settingsPaused: true,
        message: gate.reason,
        verificationStatus: prospect.verificationStatus ?? null,
      }, checkedAt);
    }
  }

  const verificationStatus = prospect.verificationStatus ?? null;

  // 2/3. Terminal states and opt-out.
  if (isClosedStatus(prospect.status)) {
    return result("BLOCKED", POLICY_REASONS.CLOSED_STATUS, { verificationStatus }, checkedAt);
  }
  if (prospect.optedOutAt) {
    return result("BLOCKED", POLICY_REASONS.OPTED_OUT, { verificationStatus }, checkedAt);
  }

  // 4. Administrator verification. An unknown status is not verification.
  if (requireVerification && verificationStatus !== "VERIFIED") {
    return result("BLOCKED", POLICY_REASONS.NOT_VERIFIED, { verificationStatus }, checkedAt);
  }

  // 5. Consent: a current, unrevoked private bot /start bound to this prospect.
  const consent = await db.telegramBotOptIn.findFirst({
    where: { prospectId: prospect.id },
    orderBy: { startedAt: "desc" },
    select: { telegramId: true, startedAt: true, revokedAt: true },
  });

  const buildSuppressed = () =>
    result("BLOCKED", POLICY_REASONS.SUPPRESSED, { verificationStatus }, checkedAt);

  // The suppression list is checked before consent so a do-not-contact entry
  // always wins, including for a prospect that once started the bot.
  let suppressed: boolean;
  try {
    suppressed = await isSuppressed(
      [
        buildSuppressionIdentifier({
          telegramUsername: prospect.telegramUsername ?? null,
          publicUrl: prospect.publicUrl ?? null,
          telegramId: consent?.telegramId ?? null,
        }),
        consent?.telegramId ? `user:${consent.telegramId}` : null,
        options.knownTelegramUserId ? `user:${options.knownTelegramUserId}` : null,
      ],
      db
    );
  } catch {
    return result("BLOCKED", POLICY_REASONS.SUPPRESSION_UNAVAILABLE, {
      verificationStatus,
    }, checkedAt);
  }
  if (suppressed) return buildSuppressed();

  if (!consent || !consent.telegramId) {
    return result("MANUAL_ONLY", POLICY_REASONS.NOT_STARTED_BOT, { verificationStatus }, checkedAt);
  }
  if (!/^\d+$/.test(consent.telegramId)) {
    return result("BLOCKED", POLICY_REASONS.NO_TELEGRAM_ID, { verificationStatus }, checkedAt);
  }
  if (consent.revokedAt) {
    return result("BLOCKED", POLICY_REASONS.CONSENT_REVOKED, { verificationStatus }, checkedAt);
  }
  if (
    !consent.startedAt ||
    Date.now() - consent.startedAt.getTime() > BOT_CONSENT_MAX_AGE_MS
  ) {
    return result("MANUAL_ONLY", POLICY_REASONS.CONSENT_EXPIRED, {
      verificationStatus,
      telegramUserId: consent.telegramId,
    }, checkedAt);
  }

  // 6. Invitation and campaign state, when the caller supplies them.
  if (options.invitation) {
    if (
      options.allowedInvitationStatuses &&
      !options.allowedInvitationStatuses.includes(options.invitation.status)
    ) {
      return result("BLOCKED", POLICY_REASONS.INVALID_INVITATION_STATE, {
        verificationStatus,
        telegramUserId: consent.telegramId,
        botConsent: true,
      }, checkedAt);
    }
    if (
      options.requireApprovedCampaign &&
      !(options.allowedCampaignStatuses ?? ["APPROVED"]).includes(
        options.campaignStatus ?? ""
      )
    ) {
      return result("BLOCKED", POLICY_REASONS.CAMPAIGN_NOT_APPROVED, {
        verificationStatus,
        telegramUserId: consent.telegramId,
        botConsent: true,
      }, checkedAt);
    }
  }

  return result("ELIGIBLE", POLICY_REASONS.OK, {
    verificationStatus,
    telegramUserId: consent.telegramId,
    botConsent: true,
  }, checkedAt);
}

/**
 * Resolve the numeric Telegram id a message would be sent to.
 *
 * It is never guessed from a username: Telegram exposes no public API to turn a
 * username into a user id. The value only exists once the person started the
 * bot through an attributed deep link.
 */
export async function resolveTelegramUserId(
  prospect: { id: string },
  db: DbClient = prisma
): Promise<string | null> {
  const consent = await db.telegramBotOptIn.findFirst({
    where: {
      prospectId: prospect.id,
      revokedAt: null,
      startedAt: { gte: new Date(Date.now() - BOT_CONSENT_MAX_AGE_MS) },
    },
    orderBy: { startedAt: "desc" },
    select: { telegramId: true },
  });
  return consent?.telegramId ?? null;
}

/** Current, unrevoked bot consent for a prospect (transaction-aware). */
export async function currentBotConsent(
  prospectId: string,
  db: DbClient = prisma
) {
  return db.telegramBotOptIn.findFirst({
    where: {
      prospectId,
      startedAt: { gte: new Date(Date.now() - BOT_CONSENT_MAX_AGE_MS) },
      revokedAt: null,
    },
    orderBy: { startedAt: "desc" },
    select: { telegramId: true, startedAt: true },
  });
}
