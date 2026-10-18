/** Pure helpers for Telegram deep-link payloads; safe to import in browser code. */
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

  if (raw.startsWith(PROSPECT_PREFIX) && raw.length > PROSPECT_PREFIX.length) {
    return { kind: "prospect", id: raw.slice(PROSPECT_PREFIX.length) };
  }

  if (raw.startsWith(CAMPAIGN_PREFIX) && raw.length > CAMPAIGN_PREFIX.length) {
    return { kind: "campaign", code: raw.slice(CAMPAIGN_PREFIX.length) };
  }

  return { kind: "none" };
}
