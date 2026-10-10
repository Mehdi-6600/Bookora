/**
 * Shared vocabulary for the Bookora outreach / discovery system.
 *
 * These values are stored as plain strings in PostgreSQL (see
 * `prisma/schema.prisma`) so they must stay stable.
 */

export const PROSPECT_STATUSES = [
  "NEW",
  "CONTACTED",
  "INTERESTED",
  "STARTED_BOT",
  "REGISTERED",
  "ACTIVATED",
  "NOT_INTERESTED",
  "DO_NOT_CONTACT",
] as const;

export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

export function isProspectStatus(value: unknown): value is ProspectStatus {
  return (
    typeof value === "string" &&
    (PROSPECT_STATUSES as readonly string[]).includes(value)
  );
}

export const PROSPECT_CATEGORIES = [
  "BARBER",
  "BEAUTY",
  "MEDICAL",
  "OTHER",
] as const;

export type ProspectCategory = (typeof PROSPECT_CATEGORIES)[number];

export function isProspectCategory(value: unknown): value is ProspectCategory {
  return (
    typeof value === "string" &&
    (PROSPECT_CATEGORIES as readonly string[]).includes(value)
  );
}

export const KEYWORD_GROUPS = ["BARBER", "BEAUTY", "MEDICAL"] as const;

export type KeywordGroup = (typeof KEYWORD_GROUPS)[number];

export function isKeywordGroup(value: unknown): value is KeywordGroup {
  return (
    typeof value === "string" &&
    (KEYWORD_GROUPS as readonly string[]).includes(value)
  );
}

/** Map a keyword group onto the prospect category it produces. */
export function categoryForGroup(group: KeywordGroup): ProspectCategory {
  return group;
}

export const OUTREACH_LANGUAGES = ["en", "fa", "ar"] as const;

export type OutreachLanguage = (typeof OUTREACH_LANGUAGES)[number];

export function isOutreachLanguage(value: unknown): value is OutreachLanguage {
  return (
    typeof value === "string" &&
    (OUTREACH_LANGUAGES as readonly string[]).includes(value)
  );
}

/**
 * Normalize a Telegram `language_code` (or any user-supplied tag) onto one of
 * the supported outreach languages.
 */
export function normalizeLanguage(value: unknown): OutreachLanguage {
  if (typeof value !== "string" || value.length === 0) return "en";
  const lower = value.toLowerCase();
  if (lower.startsWith("fa") || lower.startsWith("pe")) return "fa";
  if (lower.startsWith("ar")) return "ar";
  return "en";
}

export const INVITATION_STATUSES = [
  "DRAFT",
  "APPROVED",
  "SENT",
  "DELIVERED",
  "FAILED",
  "REJECTED",
  "SKIPPED",
] as const;

export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export function isInvitationStatus(value: unknown): value is InvitationStatus {
  return (
    typeof value === "string" &&
    (INVITATION_STATUSES as readonly string[]).includes(value)
  );
}

export const CANDIDATE_STATUSES = [
  "NEW",
  "SHORTLISTED",
  "REJECTED",
  "CONVERTED",
] as const;

export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export function isCandidateStatus(value: unknown): value is CandidateStatus {
  return (
    typeof value === "string" &&
    (CANDIDATE_STATUSES as readonly string[]).includes(value)
  );
}

/** Terminal statuses — never automatically contact these again. */
export const CLOSED_PROSPECT_STATUSES: ProspectStatus[] = [
  "NOT_INTERESTED",
  "DO_NOT_CONTACT",
];

export const STATUS_LABELS: Record<ProspectStatus, { en: string; fa: string }> =
  {
    NEW: { en: "New", fa: "جدید" },
    CONTACTED: { en: "Contacted", fa: "تماس گرفته شده" },
    INTERESTED: { en: "Interested", fa: "علاقه‌مند" },
    STARTED_BOT: { en: "Started Bot", fa: "بات را استارت زد" },
    REGISTERED: { en: "Registered", fa: "ثبت‌نام کرد" },
    ACTIVATED: { en: "Activated", fa: "فعال شد" },
    NOT_INTERESTED: { en: "Not Interested", fa: "علاقه‌ای ندارد" },
    DO_NOT_CONTACT: { en: "Do Not Contact", fa: "عدم تماس" },
  };
