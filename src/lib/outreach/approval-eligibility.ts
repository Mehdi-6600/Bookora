import { getOutreachSettings } from "@/lib/outreach/settings";
import { checkEligibility, resolveTelegramUserId } from "@/lib/outreach/eligibility";

export type ApprovalProspect = {
  id: string;
  status: string;
  verificationStatus: string;
  telegramUsername: string | null;
  publicUrl: string | null;
  optedOutAt: Date | null;
};

/** All approval surfaces use the same live consent and suppression checks as delivery. */
export async function approvalBlocker(prospect: ApprovalProspect): Promise<string | null> {
  const settings = await getOutreachSettings();
  if (settings.readError) return settings.readError;
  if (!settings.enabled || !settings.autoSendEnabled) return "Outreach approval is paused in settings.";
  if (prospect.verificationStatus !== "VERIFIED") return "Only VERIFIED prospects can be approved for outreach.";
  const telegramUserId = await resolveTelegramUserId(prospect);
  const eligibility = await checkEligibility({ ...prospect, telegramUserId });
  return eligibility.canAutoSend ? null : `Prospect is not eligible for outreach: ${eligibility.reason}.`;
}
