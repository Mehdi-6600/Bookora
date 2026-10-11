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
  /**
   * The stored consent could not be read at the moment of sending. The
   * recipient is skipped: an unverifiable consent is never treated as a
   * consent (same fail-closed contract as `SUPPRESSION_UNAVAILABLE`).
   */
  CONSENT_UNAVAILABLE: "consent_unavailable",
  OPTED_OUT: "opted_out",
  SUPPRESSED: "suppressed",
  SUPPRESSION_UNAVAILABLE: "suppression_unavailable",
  CLOSED_STATUS: "closed_status",
  SETTINGS_UNAVAILABLE: "settings_unavailable",
  OUTREACH_PAUSED: "outreach_paused",
  INVALID_INVITATION_STATE: "invalid_invitation_state",
  CAMPAIGN_NOT_APPROVED: "campaign_not_approved",
  /**
   * The campaign row could not be read at the moment of sending. The
   * invitation is not delivered: a campaign state we cannot verify is never
   * treated as a sendable one — the same fail-closed contract as
   * `CONSENT_UNAVAILABLE` and `SUPPRESSION_UNAVAILABLE`.
   *
   * Distinct from `CAMPAIGN_NOT_APPROVED`, which means the row *was* read and
   * really is missing or in a state that forbids delivery. Keeping the two
   * apart is what stops a database outage from being recorded as a decision
   * about the campaign.
   */
  CAMPAIGN_UNAVAILABLE: "campaign_unavailable",
  DAILY_LIMIT: "daily_limit",
  /**
   * The prospect already has a pending invitation, so planning skips it. It is
   * reported with a plain-language label like every other blocking reason so
   * the reviewer never sees a bare code in the recipient list.
   */
  ALREADY_PENDING: "already_pending",
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
  [POLICY_REASONS.CONSENT_UNAVAILABLE]: {
    en: "Blocked: the stored bot consent could not be read, so nothing is sent.",
    fa: "مسدود: رضایت ثبت‌شده قابل خواندن نیست؛ ارسالی انجام نمی‌شود.",
    ar: "محظور: تعذّر قراءة الموافقة المسجلة، لذلك لن يتم الإرسال.",
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
  [POLICY_REASONS.CAMPAIGN_UNAVAILABLE]: {
    en: "Blocked: the campaign could not be read, so nothing is sent.",
    fa: "مسدود: وضعیت کمپین قابل خواندن نیست؛ ارسالی انجام نمی‌شود.",
    ar: "محظور: تعذّر قراءة حالة الحملة، لذلك لن يتم الإرسال.",
  },
  [POLICY_REASONS.DAILY_LIMIT]: {
    en: "Held back: the daily sending limit is already reached.",
    fa: "نگه داشته شد: سقف ارسال روزانه پر شده است.",
    ar: "مؤجّل: تم الوصول إلى حد الإرسال اليومي.",
  },
  [POLICY_REASONS.ALREADY_PENDING]: {
    en: "Skipped: an invitation is already pending for this prospect.",
    fa: "رد شد: یک دعوت‌نامه در انتظار برای این مورد وجود دارد.",
    ar: "تم التخطي: هناك دعوة معلّقة لهذا النشاط بالفعل.",
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
  let consent: {
    telegramId: string;
    startedAt: Date | null;
    revokedAt: Date | null;
  } | null;
  try {
    consent = await db.telegramBotOptIn.findFirst({
      where: { prospectId: prospect.id },
      orderBy: { startedAt: "desc" },
      select: { telegramId: true, startedAt: true, revokedAt: true },
    });
  } catch {
    // Fail-closed, with a reason of its own.
    //
    // The error must not be reported as `NOT_STARTED_BOT`: that reason means
    // "this person never started the bot", which is a fact about the recipient
    // and here is simply unknown. Reporting it would send an administrator
    // looking for a consent that does exist. It must not fall through either —
    // an unreadable consent never reaches step 6, so it can never become
    // `ELIGIBLE` and can never arm automated delivery.
    //
    // The safe outcome is preserved: nothing is sent. What changes is the
    // granularity — the recipient is skipped with a stated reason instead of
    // the read error aborting the whole run. Every other recipient is still
    // evaluated on its own, including its own consent read, so a consent table
    // that is down skips everyone rather than sending to anyone.
    return result(
      "BLOCKED",
      POLICY_REASONS.CONSENT_UNAVAILABLE,
      { verificationStatus },
      checkedAt
    );
  }

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

export type FinalDeliveryGate =
  | { ok: true; telegramUserId: string }
  | { ok: false; reason: PolicyReason | string };

/**
 * The last gate before the outbound Telegram call.
 *
 * `evaluateOutreachPolicy` runs earlier, in its own transaction. Between that
 * check and the HTTP call a recipient can press /stop, and the delivery would
 * then go out to someone who just withdrew permission. This function is run
 * **inside the transaction that claims the invitation**, so the claim and the
 * consent/suppression re-read share one database snapshot.
 *
 * What it deliberately does NOT claim: atomicity across the external call. A
 * database transaction cannot cover an HTTP request to Telegram, so the
 * guarantee is "re-read as late as a transaction allows", not "guaranteed
 * until the message lands". The remaining window is the gap between this
 * transaction committing and `sendMessage` returning — in
 * `sendApprovedInvitations` that is the distance between the end of the claim
 * transaction and the `deliverTelegramMessage` call immediately after it. No
 * I/O happens in between, so the window is very small, but it is not zero: a
 * /stop that commits inside it would still be followed by one outbound message.
 * Closing it needs a conditional pre-send write or an outbox, not another
 * transaction. No test covers this window: the test double has no real
 * transaction boundary to commit across, so a green suite says nothing about it.
 *
 * Campaign state is re-read here too, from the database, when the caller passes
 * `options.campaign`. The status the caller loaded before opening the
 * transaction is treated as a hint only: between that read and this claim the
 * campaign can be completed, paused or deleted, and the row on disk is the only
 * answer that matters at this point.
 *
 * Fail-closed by construction: every read failure (consent, do-not-contact,
 * campaign, settings) resolves to "do not send".
 *
 * The consent lookup intentionally does NOT filter `revokedAt`: it mirrors
 * `evaluateOutreachPolicy` and picks the newest row for the prospect, so a
 * freshly revoked row is seen and rejected instead of being skipped in favour
 * of an older, still-valid one.
 */
export async function finalDeliveryGate(
  prospect: PolicyProspect & {
    /** The id `evaluateOutreachPolicy` resolved, when the caller has one. */
    knownTelegramUserId?: string | null;
  },
  options: {
    db?: DbClient;
    settings?: OutreachSettings;
    /**
     * The invitation's campaign, when it has one. The row is re-read inside the
     * transaction this gate runs in, so a campaign stopped after the caller's
     * earlier eligibility check still blocks the delivery.
     */
    campaign?: { id: string; allowedStatuses?: string[] } | null;
  } = {}
): Promise<FinalDeliveryGate> {
  const db = options.db ?? prisma;

  // 1. Kill switch, re-read here rather than trusting an earlier read.
  const settings = options.settings ?? (await getOutreachSettings());
  if (settings.readError) {
    return { ok: false, reason: POLICY_REASONS.SETTINGS_UNAVAILABLE };
  }
  const gate = outreachDeliveryGate(settings);
  if (!gate.ok) return { ok: false, reason: POLICY_REASONS.OUTREACH_PAUSED };

  // 2. A status that must never be contacted again.
  if (isClosedStatus(prospect.status)) {
    return { ok: false, reason: POLICY_REASONS.CLOSED_STATUS };
  }
  if (prospect.optedOutAt) {
    return { ok: false, reason: POLICY_REASONS.OPTED_OUT };
  }

  const known =
    typeof prospect.knownTelegramUserId === "string" &&
    /^\d+$/.test(prospect.knownTelegramUserId)
      ? prospect.knownTelegramUserId
      : null;

  // 3. Do-not-contact first, so a /stop entry always wins.
  let suppressed: boolean;
  try {
    suppressed = await isSuppressed(
      [
        known ? `user:${known}` : null,
        buildSuppressionIdentifier({
          telegramUsername: prospect.telegramUsername ?? null,
          publicUrl: prospect.publicUrl ?? null,
          telegramId: known,
        }),
      ],
      db
    );
  } catch {
    return { ok: false, reason: POLICY_REASONS.SUPPRESSION_UNAVAILABLE };
  }
  if (suppressed) return { ok: false, reason: POLICY_REASONS.SUPPRESSED };

  // 4. Current, unrevoked, unexpired consent for THIS prospect.
  let consent: { telegramId: string; startedAt: Date | null; revokedAt: Date | null } | null;
  try {
    consent = await db.telegramBotOptIn.findFirst({
      where: { prospectId: prospect.id },
      orderBy: { startedAt: "desc" },
      select: { telegramId: true, startedAt: true, revokedAt: true },
    });
  } catch {
    return { ok: false, reason: POLICY_REASONS.CONSENT_UNAVAILABLE };
  }

  if (!consent || !consent.telegramId) {
    return { ok: false, reason: POLICY_REASONS.NOT_STARTED_BOT };
  }
  if (!/^\d+$/.test(consent.telegramId)) {
    return { ok: false, reason: POLICY_REASONS.NO_TELEGRAM_ID };
  }
  if (consent.revokedAt) {
    return { ok: false, reason: POLICY_REASONS.CONSENT_REVOKED };
  }
  if (
    !consent.startedAt ||
    Date.now() - consent.startedAt.getTime() > BOT_CONSENT_MAX_AGE_MS
  ) {
    return { ok: false, reason: POLICY_REASONS.CONSENT_EXPIRED };
  }
  if (known && known !== consent.telegramId) {
    // The consent row no longer points at the id that was cleared to send.
    return { ok: false, reason: POLICY_REASONS.NOT_STARTED_BOT };
  }

  // 5. Campaign state, read now rather than trusted from before the
  //    transaction. Last on purpose: the recipient-level checks above all
  //    refuse too, and reporting the most specific reason for the recipient is
  //    more useful to an operator than reporting the campaign first.
  if (options.campaign?.id) {
    let campaign: { status: string } | null;
    try {
      campaign = await db.outreachCampaign.findUnique({
        where: { id: options.campaign.id },
        select: { status: true },
      });
    } catch {
      return { ok: false, reason: POLICY_REASONS.CAMPAIGN_UNAVAILABLE };
    }

    // A deleted campaign reads back as null, which is not a sendable state.
    // Reported with the same reason as a stopped one: from the recipient's
    // point of view both mean "this campaign may no longer be delivered", and
    // only the read failure gets its own code.
    if (!campaign) {
      return { ok: false, reason: POLICY_REASONS.CAMPAIGN_NOT_APPROVED };
    }

    const allowed = options.campaign.allowedStatuses ?? ["APPROVED", "SENDING"];
    if (!allowed.includes(campaign.status)) {
      return { ok: false, reason: POLICY_REASONS.CAMPAIGN_NOT_APPROVED };
    }
  }

  return { ok: true, telegramUserId: consent.telegramId };
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
