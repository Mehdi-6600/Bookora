import { withOutreachError } from "@/lib/outreach/api-error";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { validateTemplateBody } from "@/lib/outreach/templates";
import { approvalPolicy } from "@/lib/outreach/approval-eligibility";
import { recordAuditEvent } from "@/lib/outreach/audit";

const patchSchema = z.object({
  action: z.enum(["approve", "reject", "reset", "mark_manual_sent"]),
  body: z.string().trim().min(1).max(1500).optional(),
  note: z.string().trim().max(500).nullable().optional(),
  confirmedByOperator: z.literal(true).optional(),
  /**
   * `mark_manual_sent` is an attestation that a human already completed this
   * outreach outside the application. It is never a way around verification,
   * bot consent, suppression or the outreach kill switch.
   */
  evidence: z.string().trim().min(3).max(500).optional(),
});

/** Invitation states that may still be reviewed by an administrator. */
const REVIEWABLE_STATUSES = ["DRAFT", "APPROVED", "REJECTED", "SKIPPED", "FAILED"];

async function PATCHImpl(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (await isRateLimited(`outreach-invite-edit:${guard.user.id}`, 200, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  triggerRateLimitCleanup();

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const invitation = await prisma.outreachInvitation.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      campaignId: true,
      prospect: true,
      campaign: { select: { status: true } },
    },
  });

  if (!invitation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const now = new Date();
  const campaignStatus = invitation.campaign?.status ?? null;

  if (parsed.data.action === "approve") {
    if (parsed.data.body !== undefined) {
      const bodyError = validateTemplateBody(parsed.data.body);
      if (bodyError) {
        return NextResponse.json({ error: bodyError }, { status: 400 });
      }
    }

    if (invitation.status !== "DRAFT") {
      return NextResponse.json(
        { error: "Only DRAFT invitations can be approved." },
        { status: 409 }
      );
    }

    // Re-validate inside the transaction that applies the approval, using the
    // same policy delivery uses. A concurrent un-verification, opt-out or
    // consent revocation therefore cannot slip through between check and write.
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const policy = await approvalPolicy(invitation.prospect, {
          db: tx,
          invitation: {
            id: invitation.id,
            status: invitation.status,
            campaignId: invitation.campaignId,
          },
          campaignStatus,
          allowedInvitationStatuses: ["DRAFT"],
          requireApprovedCampaign: Boolean(invitation.campaignId),
        });

        if (!policy.canApprove) {
          throw new ApprovalBlocked(policy.reason, policy.message);
        }

        const claimed = await tx.outreachInvitation.updateMany({
          where: {
            id: invitation.id,
            status: "DRAFT",
            prospect: { verificationStatus: "VERIFIED", optedOutAt: null },
          },
          data: {
            status: "APPROVED",
            approvedAt: now,
            approvedByUserId: guard.user.id,
            reviewedAt: now,
            rejectionNote: null,
            failureReason: null,
            ...(parsed.data.body ? { body: parsed.data.body } : {}),
          },
        });

        if (claimed.count !== 1) {
          throw new ApprovalBlocked(
            "state_changed",
            "The invitation changed while it was being approved; nothing was approved. Refresh and retry."
          );
        }

        await recordAuditEvent(
          {
            scope: "invitation",
            entityId: id,
            action: "invitation.approved",
            actorUserId: guard.user.id,
            detail: `prospect=${invitation.prospect.id}`,
          },
          tx
        );

        return tx.outreachInvitation.findUnique({ where: { id } });
      });

      return NextResponse.json({ invitation: updated });
    } catch (error) {
      if (error instanceof ApprovalBlocked) {
        return NextResponse.json(
          {
            error: error.message,
            reason: error.reason,
            verificationStatus: invitation.prospect.verificationStatus,
          },
          { status: 409 }
        );
      }
      throw error;
    }
  }

  if (parsed.data.action === "reject" || parsed.data.action === "reset") {
    if (!REVIEWABLE_STATUSES.includes(invitation.status)) {
      return NextResponse.json(
        { error: "Invalid invitation state transition." },
        { status: 409 }
      );
    }
    const rejecting = parsed.data.action === "reject";
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const claimed = await tx.outreachInvitation.updateMany({
        where: { id, status: invitation.status },
        data: rejecting
          ? {
              status: "REJECTED",
              reviewedAt: now,
              rejectionNote: parsed.data.note ?? "Rejected by admin",
            }
          : {
              status: "DRAFT",
              approvedAt: null,
              approvedByUserId: null,
              reviewedAt: now,
              failureReason: null,
              ...(parsed.data.body ? { body: parsed.data.body } : {}),
            },
      });
        if (claimed.count !== 1) {
          throw new ApprovalBlocked(
            "state_changed",
            "The invitation changed while it was being reviewed; nothing was saved. Refresh and retry."
          );
        }
        await recordAuditEvent(
          {
            scope: "invitation",
            entityId: id,
            action: rejecting ? "invitation.rejected" : "invitation.reset",
            actorUserId: guard.user.id,
            detail: rejecting
              ? `note=${parsed.data.note ? "provided" : "none"}`
              : undefined,
          },
          tx
        );
        return tx.outreachInvitation.findUnique({ where: { id } });
      });

      return NextResponse.json({ invitation: updated });
    } catch (error) {
      if (error instanceof ApprovalBlocked) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------
  // mark_manual_sent: an attestation of an outreach action that a human
  // already performed outside the application (phone call, in-person visit,
  // the business's own public channel). It is recorded as SENT — never as
  // DELIVERED, which is reserved for application-initiated bot delivery.
  //
  // Gates: verification, do-not-contact, opt-out, invitation state, campaign
  // state and the kill switch all still apply. Bot consent does not, because a
  // phone call is not a Telegram message: a MANUAL_ONLY recipient is exactly
  // the case where a human reaches out through another channel. A withdrawn
  // consent (consent_revoked) is still BLOCKED and cannot be bypassed.
  // ---------------------------------------------------------------------
  if (invitation.status !== "APPROVED") {
    return NextResponse.json(
      {
        error:
          "Only an APPROVED invitation can be recorded as manually sent, and only once.",
      },
      { status: 409 }
    );
  }
  if (parsed.data.confirmedByOperator !== true) {
    return NextResponse.json(
      { error: "Explicit operator confirmation is required." },
      { status: 409 }
    );
  }
  if (!parsed.data.evidence) {
    return NextResponse.json(
      {
        error:
          "Record how and where you contacted this recipient (at least 3 characters). The application has no evidence of an external message.",
      },
      { status: 400 }
    );
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const policy = await approvalPolicy(invitation.prospect, {
        db: tx,
        invitation: {
          id: invitation.id,
          status: invitation.status,
          campaignId: invitation.campaignId,
        },
        campaignStatus,
        allowedInvitationStatuses: ["APPROVED"],
        requireApprovedCampaign: false,
      });

      if (policy.decision === "BLOCKED") {
        throw new ApprovalBlocked(policy.reason, policy.message);
      }

      const claimed = await tx.outreachInvitation.updateMany({
        where: {
          id: invitation.id,
          status: "APPROVED",
          prospect: { verificationStatus: "VERIFIED", optedOutAt: null },
        },
        data: {
          status: "SENT",
          sentAt: now,
          reviewedAt: now,
          failureReason: null,
          // deliveredAt stays null: the application did not deliver anything.
        },
      });

      if (claimed.count !== 1) {
        throw new ApprovalBlocked(
          "state_changed",
          "The invitation changed while the manual send was being recorded; nothing was saved. Refresh and retry."
        );
      }

      await tx.outreachProspect.update({
        where: { id: invitation.prospect.id },
        data: {
          status: "CONTACTED",
          lastContactedAt: now,
          contactedCount: { increment: 1 },
          nextFollowUpAt: new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000),
        },
      });

      await recordAuditEvent(
        {
          scope: "invitation",
          entityId: id,
          action: "invitation.manual_sent",
          actorUserId: guard.user.id,
          detail:
            `channel=manual_attestation consent=${policy.decision} ` +
            `prospect=${invitation.prospect.id} ` +
            `time=${now.toISOString()} evidence=${parsed.data.evidence}`,
        },
        tx
      );

      return tx.outreachInvitation.findUnique({ where: { id } });
    });

    return NextResponse.json({ invitation: updated, manual: true });
  } catch (error) {
    if (error instanceof ApprovalBlocked) {
      return NextResponse.json(
        { error: error.message, reason: error.reason },
        { status: 409 }
      );
    }
    throw error;
  }
}

/** Aborts a transaction without approving or recording anything. */
class ApprovalBlocked extends Error {
  constructor(
    readonly reason: string,
    message: string
  ) {
    super(message);
  }
}

async function DELETEImpl(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const invitation = await prisma.outreachInvitation.findUnique({
    where: { id },
    select: { status: true },
  });

  if (!invitation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (invitation.status === "DELIVERED" || invitation.status === "SENT") {
    return NextResponse.json(
      { error: "A delivered invitation cannot be deleted." },
      { status: 409 }
    );
  }

  await prisma.outreachInvitation.delete({ where: { id } });
  await recordAuditEvent({
    scope: "invitation",
    entityId: id,
    action: "invitation.deleted",
    actorUserId: guard.user.id,
  });
  return NextResponse.json({ deleted: true });
}

export const PATCH = withOutreachError(PATCHImpl);
export const DELETE = withOutreachError(DELETEImpl);
