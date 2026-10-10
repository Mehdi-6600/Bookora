import { withOutreachError } from "@/lib/outreach/api-error";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { validateTemplateBody } from "@/lib/outreach/templates";
import { approvalBlocker } from "@/lib/outreach/approval-eligibility";
import { recordAuditEvent } from "@/lib/outreach/audit";

const patchSchema = z.object({
  action: z.enum(["approve", "reject", "reset", "mark_manual_sent"]),
  body: z.string().trim().min(1).max(1500).optional(),
  note: z.string().trim().max(500).nullable().optional(),
  confirmedByOperator: z.literal(true).optional(),
});

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
    select: { id: true, status: true, prospect: true },
  });

  if (!invitation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const now = new Date();

  if (parsed.data.action === "approve") {
    if (parsed.data.body !== undefined) {
      const bodyError = validateTemplateBody(parsed.data.body);
      if (bodyError) {
        return NextResponse.json({ error: bodyError }, { status: 400 });
      }
    }

    if (invitation.status !== "DRAFT") {
      return NextResponse.json({ error: "Only DRAFT invitations can be approved." }, { status: 409 });
    }
    const blocker = await approvalBlocker(invitation.prospect);
    if (blocker) return NextResponse.json({ error: blocker, verificationStatus: invitation.prospect.verificationStatus }, { status: 409 });

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.outreachInvitation.update({
        where: { id },
        data: { status: "APPROVED", approvedAt: now,
          approvedByUserId: guard.user.id, reviewedAt: now,
          rejectionNote: null, failureReason: null,
          ...(parsed.data.body ? { body: parsed.data.body } : {}) },
      });
      await recordAuditEvent({ scope: "invitation", entityId: id,
        action: "invitation.approved", actorUserId: guard.user.id,
        detail: `prospect=${invitation.prospect.id}` }, tx);
      return row;
    });

    return NextResponse.json({ invitation: updated });
  }

  if (parsed.data.action === "reject" || parsed.data.action === "reset") {
    if (!(["DRAFT", "APPROVED", "REJECTED", "SKIPPED", "FAILED"].includes(invitation.status))) {
      return NextResponse.json({ error: "Invalid invitation state transition." }, { status: 409 });
    }
    const rejecting = parsed.data.action === "reject";
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.outreachInvitation.update({
        where: { id }, data: rejecting
          ? { status: "REJECTED", reviewedAt: now, rejectionNote: parsed.data.note ?? "Rejected by admin" }
          : { status: "DRAFT", approvedAt: null, approvedByUserId: null,
              reviewedAt: now, failureReason: null,
              ...(parsed.data.body ? { body: parsed.data.body } : {}) },
      });
      await recordAuditEvent({ scope: "invitation", entityId: id,
        action: rejecting ? "invitation.rejected" : "invitation.reset",
        actorUserId: guard.user.id }, tx);
      return row;
    });
    return NextResponse.json({ invitation: updated });
  }

  // A manual-sent record is an attestation of an already completed, consensual
  // outreach action; never a shortcut around verification or bot consent.
  if (invitation.status !== "APPROVED" || parsed.data.confirmedByOperator !== true) {
    return NextResponse.json({ error: "An APPROVED invitation and explicit operator confirmation are required." }, { status: 409 });
  }
  const blocker = await approvalBlocker(invitation.prospect);
  if (blocker) return NextResponse.json({ error: blocker }, { status: 409 });
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.outreachInvitation.update({
      where: { id }, data: { status: "SENT", sentAt: now, reviewedAt: now, failureReason: null },
    });
    await tx.outreachProspect.update({
      where: { id: invitation.prospect.id },
      data: { status: "CONTACTED", lastContactedAt: now,
        contactedCount: { increment: 1 },
        nextFollowUpAt: new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000) },
    });
    await recordAuditEvent({ scope: "invitation", entityId: id,
      action: "invitation.manual_sent", actorUserId: guard.user.id,
      detail: `prospect=${invitation.prospect.id} time=${now.toISOString()}` }, tx);
    return row;
  });

  return NextResponse.json({ invitation: updated, manual: true });
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
  return NextResponse.json({ deleted: true });
}

export const PATCH = withOutreachError(PATCHImpl);
export const DELETE = withOutreachError(DELETEImpl);
