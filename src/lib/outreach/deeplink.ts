import { env } from "@/lib/env";

/**
 * Telegram deep-link (`start` parameter) helpers.
 *
 * Telegram only allows `A-Z`, `a-z`, `0-9`, `_` and `-` in a `start` parameter
 * and caps it at 64 characters, so the payload is intentionally tiny: an
 * opaque reference id that is resolved against the database. No personal data
 * ever travels inside the link.
 */

export const START_PARAM_MAX_LENGTH = 64;
const PROSPECT_PREFIX = "p-";
const CAMPAIGN_PREFIX = "c-";
const SAFE_PARAM = /^[A-Za-z0-9_-]{1,64}$/;

export type StartPayload =
  | { kind: "prospect"; id: string }
  | { kind: "campaign"; code: string }
  | { kind: "none" };

/** Build the `start` parameter that identifies one prospect. */
export function buildProspectStartParam(prospectId: string): string {
  const suffix = prospectId.replace(/[^A-Za-z0-9_-]/g, "");
  return `${PROSPECT_PREFIX}${suffix}`.slice(0, START_PARAM_MAX_LENGTH);
}

/** Build the `start` parameter that identifies a campaign without a prospect. */
export function buildCampaignStartParam(campaignCode: string): string {
  const suffix = campaignCode.replace(/[^A-Za-z0-9_-]/g, "");
  return `${CAMPAIGN_PREFIX}${suffix}`.slice(0, START_PARAM_MAX_LENGTH);
}

/** Reject anything that is not a well-formed, length-bounded start parameter. */
export function isValidStartParam(value: unknown): value is string {
  return typeof value === "string" && SAFE_PARAM.test(value);
}

export function parseStartPayload(raw: unknown): StartPayload {
  if (!isValidStartParam(raw)) return { kind: "none" };

  const value = raw.slice();

  if (value.startsWith(PROSPECT_PREFIX) && value.length > PROSPECT_PREFIX.length) {
    return { kind: "prospect", id: value.slice(PROSPECT_PREFIX.length) };
  }

  if (value.startsWith(CAMPAIGN_PREFIX) && value.length > CAMPAIGN_PREFIX.length) {
    return { kind: "campaign", code: value.slice(CAMPAIGN_PREFIX.length) };
  }

  return { kind: "none" };
}

/** `https://t.me/<bot>?start=<param>` */
export function buildBotDeepLink(startParam: string): string {
  const username = env.TELEGRAM_BOT_USERNAME.replace(/^@/, "");
  return `https://t.me/${username}?start=${encodeURIComponent(startParam)}`;
}

/**
 * Build a deep link for the Mini App itself. Telegram forwards the `startapp`
 * parameter to the web app as `start_param` inside `initData`, which lets the
 * same attribution work when the Mini App is opened from a direct link.
 */
export function buildMiniAppDeepLink(startParam: string): string {
  const username = env.TELEGRAM_BOT_USERNAME.replace(/^@/, "");
  return `https://t.me/${username}?startapp=${encodeURIComponent(startParam)}`;
}
