import {
  evaluateOutreachPolicy,
  type DbClient,
  type PolicyResult,
} from "@/lib/outreach/policy";
import type { OutreachSettings } from "@/lib/outreach/settings";

/**
 * Approval uses exactly the same gates as delivery.
 *
 * Approving an invitation arms automated sending, so an approval is only ever
 * allowed for a recipient the bot is already entitled to message: verified by
 * an administrator, not suppressed, not opted out, and holding a current,
 * unrevoked private bot /start bound to this prospect.
 */

export type ApprovalProspect = {
  id: string;
  status: string;
  verificationStatus: string;
  telegramUsername: string | null;
  publicUrl: string | null;
  optedOutAt: Date | null;
};

export async function approvalPolicy(
  prospect: ApprovalProspect,
  options: {
    db?: DbClient;
    settings?: OutreachSettings;
    invitation?: { id?: string; status: string; campaignId?: string | null };
    campaignStatus?: string | null;
    allowedInvitationStatuses?: string[];
    requireApprovedCampaign?: boolean;
  } = {}
): Promise<PolicyResult> {
  return evaluateOutreachPolicy(
    {
      id: prospect.id,
      status: prospect.status,
      verificationStatus: prospect.verificationStatus,
      telegramUsername: prospect.telegramUsername,
      publicUrl: prospect.publicUrl,
      optedOutAt: prospect.optedOutAt,
    },
    {
      db: options.db,
      settings: options.settings,
      invitation: options.invitation,
      campaignStatus: options.campaignStatus,
      allowedInvitationStatuses: options.allowedInvitationStatuses,
      requireApprovedCampaign: options.requireApprovedCampaign,
    }
  );
}

/**
 * `null` when the invitation may be approved, otherwise an actionable,
 * admin-facing explanation (never a bare boolean).
 */
export async function approvalBlocker(
  prospect: ApprovalProspect,
  options: Parameters<typeof approvalPolicy>[1] = {}
): Promise<string | null> {
  const policy = await approvalPolicy(prospect, options);
  return policy.canApprove ? null : policy.message;
}
