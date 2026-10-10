import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { validateTemplateBody } from "@/lib/outreach/templates";

const patchSchema = z.object({
  action: z.enum(["approve", "reject", "reset", "mark_manual_sent"]),
  body: z.string().trim().min(1).max(1500).optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export async function PATCH(
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
    select: { id: true, status: true },
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

    const updated = await prisma.outreachInvitation.update({
      where: { id },
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

    return NextResponse.json({ invitation: updated });
  }

  if (parsed.data.action === "reject") {
    const updated = await prisma.outreachInvitation.update({
      where: { id },
      data: {
        status: "REJECTED",
        reviewedAt: now,
        rejectionNote: parsed.data.note ?? "Rejected by admin",
      },
    });

    return NextResponse.json({ invitation: updated });
  }

  if (parsed.data.action === "reset") {
    const updated = await prisma.outreachInvitation.update({
      where: { id },
      data: {
        status: "DRAFT",
        approvedAt: null,
        approvedByUserId: null,
        reviewedAt: now,
        failureReason: null,
        ...(parsed.data.body ? { body: parsed.data.body } : {}),
      },
    });

    return NextResponse.json({ invitation: updated });
  }

  // mark_manual_sent — the administrator sent the invitation by hand through
  // the business's public channel (for example replying to their Instagram).
  // This records intent honestly: it is NOT a verified delivery.
  const updated = await prisma.outreachInvitation.update({
    where: { id },
    data: {
      status: "SENT",
      sentAt: now,
      reviewedAt: now,
      failureReason: null,
    },
  });

  const full = await prisma.outreachInvitation.findUnique({
    where: { id },
    select: { prospectId: true },
  });

  if (full) {
    await prisma.outreachProspect.update({
      where: { id: full.prospectId },
      data: {
        status: "CONTACTED",
        lastContactedAt: now,
        contactedCount: { increment: 1 },
        nextFollowUpAt: new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000),
      },
    });
  }

  return NextResponse.json({ invitation: updated, manual: true });
}

export async function DELETE(
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
