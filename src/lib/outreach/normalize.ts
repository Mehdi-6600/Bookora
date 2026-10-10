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
