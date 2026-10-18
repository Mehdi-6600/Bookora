import { env } from "@/lib/env";

export {
  buildCampaignStartParam,
  buildProspectStartParam,
  isValidStartParam,
  parseStartPayload,
  START_PARAM_MAX_LENGTH,
} from "@/lib/outreach/start-param";
export type { StartPayload } from "@/lib/outreach/start-param";

/**
 * Telegram deep-link (`start` parameter) helpers.
 *
 * Telegram only allows `A-Z`, `a-z`, `0-9`, `_` and `-` in a `start` parameter
 * and caps it at 64 characters, so the payload is intentionally tiny: an
 * opaque reference id that is resolved against the database. No personal data
 * ever travels inside the link.
 */

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
