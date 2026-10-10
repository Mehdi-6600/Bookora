import { createHash } from "crypto";

/**
 * Identity normalization + deduplication helpers.
 *
 * Everything here is pure and side-effect free so it can be unit tested
 * without a database (see `src/lib/__tests__/outreach-dedupe.test.ts`).
 */

const ARABIC_TO_PERSIAN: Array<[RegExp, string]> = [
  [/[\u064B-\u065F\u0670]/g, ""], // Arabic diacritics
  [/\u0640/g, ""], // tatweel
  [/\u064A/g, "\u06CC"], // Arabic yeh -> Persian yeh
  [/\u0643/g, "\u06A9"], // Arabic kaf -> Persian keheh
  [/\u06C0/g, "\u06CC"], // heh with yeh above -> yeh
  [/\u0649/g, "\u06CC"], // alef maksura -> yeh
  [/\u0629/g, "\u0647"], // teh marbuta -> heh
];

/**
 * Fold a display string into a comparable key: lowercase, unify Arabic and
 * Persian letter forms, strip accents, punctuation and whitespace.
 */
export function foldText(value: string): string {
  if (!value) return "";
  let out = value;
  for (const [pattern, replacement] of ARABIC_TO_PERSIAN) {
    out = out.replace(pattern, replacement);
  }
  out = out.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return out
    .toLowerCase()
    .replace(/[\s\u200c\u200d\u00a0]+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** Lowercase a Telegram username and strip any leading `@` or URL prefix. */
export function normalizeTelegramUsername(value: string | null | undefined): string | null {
  if (!value) return null;
  let raw = value.trim();
  if (raw.length === 0) return null;

  raw = raw.replace(/^https?:\/\//i, "");
  raw = raw.replace(/^(www\.)?(t\.me|telegram\.me)\//i, "");
  raw = raw.replace(/^@/, "");
  raw = raw.split(/[/?#]/)[0];

  // Telegram usernames: 4-32 chars of a-z, 0-9 and underscore.
  if (!/^[a-z0-9_]{4,32}$/i.test(raw)) return null;
  return raw.toLowerCase();
}

/**
 * Reduce a public URL to a comparable identity: lowercased host without
 * `www.`, path without trailing slash, query and fragment removed.
 */
export function normalizePublicUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;

    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${path}`;
  } catch {
    return null;
  }
}

/**
 * Build the stable identity used to deduplicate prospects and candidates.
 *
 * Priority: Telegram username > normalized public URL > folded business name
 * (with city when known). Falls back to a hash of the raw input so the unique
 * index is never violated by an empty key.
 */
export function buildDedupeKey(input: {
  telegramUsername?: string | null;
  publicUrl?: string | null;
  publicName?: string | null;
  city?: string | null;
}): string {
  const username = normalizeTelegramUsername(input.telegramUsername);
  if (username) return `tg:${username}`;

  const url = normalizePublicUrl(input.publicUrl);
  if (url) return `url:${url}`;

  const name = foldText(input.publicName ?? "");
  if (name.length > 0) {
    const city = foldText(input.city ?? "");
    return `name:${name}${city.length > 0 ? `@${city}` : ""}`;
  }

  return `hash:${sha256(
    [input.telegramUsername, input.publicUrl, input.publicName, input.city]
      .map((part) => part ?? "")
      .join("|")
  ).slice(0, 32)}`;
}

/** Suppression-list identifier. Defaults to the Telegram identity when present. */
export function buildSuppressionIdentifier(input: {
  telegramUsername?: string | null;
  publicUrl?: string | null;
  telegramId?: string | number | null;
}): string | null {
  const username = normalizeTelegramUsername(input.telegramUsername);
  if (username) return `tg:${username}`;

  if (input.telegramId !== null && input.telegramId !== undefined) {
    const id = String(input.telegramId);
    if (/^\d+$/.test(id)) return `user:${id}`;
  }

  const url = normalizePublicUrl(input.publicUrl);
  if (url) return `url:${url}`;

  return null;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Turn an arbitrary public profile URL into a `t.me/<username>` URL when it is
 * a Telegram address; otherwise return the URL unchanged.
 */
export function toTelegramProfileUrl(username: string): string {
  return `https://t.me/${normalizeTelegramUsername(username) ?? username.replace(/^@/, "")}`;
}

export const PUBLIC_URL_MAX_LENGTH = 500;

export type PublicUrlCheck =
  | { ok: true; url: string }
  | { ok: false; reason: "empty" | "too_long" | "invalid" | "scheme" | "credentials" | "host" };

/**
 * Validate a public profile / business page URL before it is stored.
 *
 * Only plain http(s) pages on a public-looking hostname are accepted. Anything
 * that could execute (`javascript:`, `data:`), smuggle credentials
 * (`https://user:pass@host`) or point at a local host is rejected. The URL is
 * stored, never fetched, so this is a hygiene check, not an SSRF defence.
 */
export function validatePublicProfileUrl(value: unknown): PublicUrlCheck {
  if (typeof value !== "string") return { ok: false, reason: "empty" };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };
  if (trimmed.length > PUBLIC_URL_MAX_LENGTH) return { ok: false, reason: "too_long" };
  if (/\s/.test(trimmed)) return { ok: false, reason: "invalid" };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "scheme" };
  }
  if (url.username || url.password) return { ok: false, reason: "credentials" };

  const host = url.hostname.toLowerCase();
  const looksPublic =
    host.includes(".") &&
    !host.endsWith(".local") &&
    !host.endsWith(".internal") &&
    !/^[0-9.]+$/.test(host) &&
    !host.startsWith("[");
  if (!looksPublic) return { ok: false, reason: "host" };

  return { ok: true, url: url.toString() };
}

/** Human-readable reason for a rejected URL (English; the UI maps codes to translations). */
export function publicUrlReasonText(reason: Exclude<PublicUrlCheck, { ok: true }>["reason"]): string {
  switch (reason) {
    case "empty":
      return "URL is empty.";
    case "too_long":
      return `URL must be at most ${PUBLIC_URL_MAX_LENGTH} characters.`;
    case "scheme":
      return "Only http:// or https:// links are allowed.";
    case "credentials":
      return "URLs must not contain a username or password.";
    case "host":
      return "URL must point to a public website or profile (for example instagram.com/name).";
    default:
      return "URL is not valid.";
  }
}
