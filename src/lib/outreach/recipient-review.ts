/**
 * Pure review logic for the outreach recipient list (critical fix E).
 *
 * `planCampaign()` already returns every matched recipient — blocked ones
 * included — with verification, consent, suppression, quota flags, a
 * plain-language reason and the exact message body. This module is the
 * framework-free half of the reviewer UI: filtering, pagination, counts and
 * state derivation. It has no React, no fetch and no Prisma import, so it can
 * be unit-tested and it can never become a second eligibility implementation.
 *
 * The types here are structural copies of `CampaignRecipient` in
 * `campaigns.ts`. Importing that module (even for a type) would drag the
 * database client into the browser bundle, so the shape is restated instead.
 */

export const REVIEW_DISPOSITIONS = ["ELIGIBLE", "MANUAL_ONLY", "BLOCKED"] as const;
export type ReviewDisposition = (typeof REVIEW_DISPOSITIONS)[number];

/** One recipient exactly as the server plan reports it. */
export type ReviewRecipient = {
  prospectId: string;
  publicName: string;
  city: string | null;
  segment: string | null;
  neighborhood?: string | null;
  language?: string | null;
  disposition: ReviewDisposition;
  verificationStatus: string;
  botConsent: boolean;
  suppressed: boolean;
  reason: string;
  /** Plain-language English explanation from the server. */
  reasonLabel?: string | null;
  /** The same explanation in every supported language, when the server sends it. */
  reasonLabels?: { en?: string; fa?: string; ar?: string } | null;
  checkedAt?: Date | string | null;
  channel?: "TELEGRAM_BOT" | "MANUAL" | string;
  destination?: string | null;
  previewBody?: string | null;
  cta?: string | null;
  withinQuota?: boolean;
  heldOver?: boolean;
};

/* ------------------------------------------------------------------------- */
/* Filtering                                                                  */
/* ------------------------------------------------------------------------- */

export const REVIEW_FILTERS = [
  "all",
  "eligible",
  "manual_only",
  "blocked",
  "held_over",
] as const;
export type ReviewFilter = (typeof REVIEW_FILTERS)[number];

export function isReviewFilter(value: unknown): value is ReviewFilter {
  return (
    typeof value === "string" &&
    (REVIEW_FILTERS as readonly string[]).includes(value)
  );
}

/** The filter a recipient belongs to; the first match wins. */
export function matchesReviewFilter(
  recipient: ReviewRecipient,
  filter: ReviewFilter
): boolean {
  switch (filter) {
    case "eligible":
      return recipient.disposition === "ELIGIBLE";
    case "manual_only":
      return recipient.disposition === "MANUAL_ONLY";
    case "blocked":
      return recipient.disposition === "BLOCKED";
    case "held_over":
      return recipient.heldOver === true;
    case "all":
    default:
      return true;
  }
}

export function filterRecipients(
  recipients: readonly ReviewRecipient[],
  filter: ReviewFilter
): ReviewRecipient[] {
  return recipients.filter((recipient) => matchesReviewFilter(recipient, filter));
}

/* ------------------------------------------------------------------------- */
/* Pagination                                                                 */
/* ------------------------------------------------------------------------- */

export const REVIEW_PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_REVIEW_PAGE_SIZE = 10;

export function normalizePageSize(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_REVIEW_PAGE_SIZE;
  const allowed = REVIEW_PAGE_SIZES.find((size) => size === Math.trunc(parsed));
  return allowed ?? DEFAULT_REVIEW_PAGE_SIZE;
}

/** Never fewer than one page: an empty list still renders "page 1 of 1". */
export function reviewPageCount(total: number, pageSize: number): number {
  const size = normalizePageSize(pageSize);
  if (!Number.isFinite(total) || total <= 0) return 1;
  return Math.max(1, Math.ceil(total / size));
}

export function clampReviewPage(page: number, total: number, pageSize: number): number {
  const pageCount = reviewPageCount(total, pageSize);
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.trunc(page)), pageCount);
}

export type ReviewPage<T> = {
  items: T[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  /** 1-based index of the first item on this page (0 when the page is empty). */
  first: number;
  /** 1-based index of the last item on this page (0 when the page is empty). */
  last: number;
  hasPrevious: boolean;
  hasNext: boolean;
};

/**
 * Page through a recipient list. Blocked recipients are intentionally NOT
 * dropped or separated here — the server decides the order (actionable first,
 * then manual-only, then blocked) and the reviewer must be able to page
 * through every one of them.
 */
export function paginateRecipients<T>(
  recipients: readonly T[],
  page: number,
  pageSize: number
): ReviewPage<T> {
  const size = normalizePageSize(pageSize);
  const total = recipients.length;
  const pageCount = reviewPageCount(total, size);
  const current = clampReviewPage(page, total, size);
  const offset = (current - 1) * size;
  const items = recipients.slice(offset, offset + size);
  return {
    items,
    page: current,
    pageCount,
    pageSize: size,
    total,
    first: items.length === 0 ? 0 : offset + 1,
    last: items.length === 0 ? 0 : offset + items.length,
    hasPrevious: current > 1,
    hasNext: current < pageCount,
  };
}

/* ------------------------------------------------------------------------- */
/* Counts                                                                     */
/* ------------------------------------------------------------------------- */

export type RecipientReviewCounts = {
  /** Every matched recipient, blocked ones included. */
  total: number;
  eligible: number;
  manualOnly: number;
  blocked: number;
  /** Sendable recipients the quota holds back for a later run. */
  heldOver: number;
  /** Recipients this run would genuinely prepare (eligible and inside quota). */
  approvable: number;
};

export function recipientReviewCounts(
  recipients: readonly ReviewRecipient[]
): RecipientReviewCounts {
  return {
    total: recipients.length,
    eligible: recipients.filter((r) => r.disposition === "ELIGIBLE").length,
    manualOnly: recipients.filter((r) => r.disposition === "MANUAL_ONLY").length,
    blocked: recipients.filter((r) => r.disposition === "BLOCKED").length,
    heldOver: recipients.filter((r) => r.heldOver === true).length,
    approvable: recipients.filter(
      (r) => r.disposition === "ELIGIBLE" && r.withinQuota === true
    ).length,
  };
}

/* ------------------------------------------------------------------------- */
/* Per-recipient states                                                       */
/* ------------------------------------------------------------------------- */

export type ConsentState =
  | "granted"
  | "revoked"
  | "expired"
  | "not_started"
  | "no_telegram_id"
  | "none";

/**
 * Consent is only ever `granted` when the plan says so. Every other value is
 * derived from the server's machine-readable reason code, so the UI cannot
 * invent consent.
 */
export function recipientConsentState(recipient: ReviewRecipient): ConsentState {
  if (recipient.botConsent === true) return "granted";
  switch (recipient.reason) {
    case "consent_revoked":
      return "revoked";
    case "consent_expired":
      return "expired";
    case "not_started_bot":
      return "not_started";
    case "no_telegram_id":
      return "no_telegram_id";
    default:
      return "none";
  }
}

export type VerificationState = "verified" | "discovered" | "rejected" | "unknown";

export function recipientVerificationState(
  recipient: ReviewRecipient
): VerificationState {
  switch (recipient.verificationStatus) {
    case "VERIFIED":
      return "verified";
    case "DISCOVERED":
      return "discovered";
    case "REJECTED":
      return "rejected";
    default:
      return "unknown";
  }
}

export type SuppressionState = "suppressed" | "clear" | "unavailable";

export function recipientSuppressionState(
  recipient: ReviewRecipient
): SuppressionState {
  if (recipient.suppressed === true) return "suppressed";
  // Fail-closed: the server blocks the recipient when the do-not-contact list
  // cannot be read. That is not "clear", and the UI must not render it as such.
  if (recipient.reason === "suppression_unavailable") return "unavailable";
  return "clear";
}

export type QuotaState = "within_quota" | "held_over" | "blocked";

export function recipientQuotaState(recipient: ReviewRecipient): QuotaState {
  if (recipient.disposition === "BLOCKED") return "blocked";
  if (recipient.heldOver === true) return "held_over";
  if (recipient.withinQuota === true) return "within_quota";
  return "held_over";
}

/** The channel this recipient would actually be reached through. */
export function recipientChannel(
  recipient: ReviewRecipient
): "TELEGRAM_BOT" | "MANUAL" {
  if (recipient.channel === "TELEGRAM_BOT") return "TELEGRAM_BOT";
  if (recipient.channel === "MANUAL") return "MANUAL";
  return recipient.disposition === "ELIGIBLE" ? "TELEGRAM_BOT" : "MANUAL";
}

/**
 * The plain-language blocking/eligibility reason in the reviewer's language.
 *
 * The server sends `reasonLabels` (en/fa/ar). Older responses only carry the
 * English `reasonLabel`, and the raw `reason` code is the last resort — the UI
 * never silently drops a blocking reason.
 */
export function recipientReasonText(
  recipient: ReviewRecipient,
  locale: string
): string {
  const label = recipient.reasonLabels;
  if (label) {
    if (locale === "fa" && label.fa) return label.fa;
    if (locale === "ar" && label.ar) return label.ar;
    if (label.en) return label.en;
  }
  if (recipient.reasonLabel) return recipient.reasonLabel;
  return recipient.reason;
}

/** Recipients whose exact outgoing message the reviewer can still inspect. */
export function hasMessagePreview(recipient: ReviewRecipient): boolean {
  return typeof recipient.previewBody === "string" && recipient.previewBody.length > 0;
}

/**
 * The exact message body that would be sent, with the CTA appended the way the
 * preview modal does. Returns null when the server rendered no preview (the
 * recipient is blocked, or the template does not validate).
 */
export function exactOutgoingMessage(recipient: ReviewRecipient): string | null {
  if (!hasMessagePreview(recipient)) return null;
  const body = recipient.previewBody as string;
  const cta = recipient.cta?.trim();
  if (!cta) return body;
  return `${body}\n\n${cta}`;
}

export function formatCheckedAt(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
