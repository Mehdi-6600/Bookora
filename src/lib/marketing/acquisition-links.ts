import { buildCampaignStartParam } from "@/lib/outreach/start-param";

export const BOOKORA_TELEGRAM_URL = "https://t.me/Bookora_App_bot";

/**
 * Build the owner-initiated setup link. A real campaign ref is preserved for
 * attribution; an organic source label is used only for first-party analytics.
 */
export function buildAcquisitionSignupUrl(campaignRef?: string | null): string {
  if (!campaignRef) return BOOKORA_TELEGRAM_URL;

  const url = new URL(BOOKORA_TELEGRAM_URL);
  url.searchParams.set("start", buildCampaignStartParam(campaignRef));
  return url.toString();
}

export function getAcquisitionEventRef(
  campaignRef: string | null | undefined,
  source: string
): string {
  return campaignRef || `seo_${source}`;
}
