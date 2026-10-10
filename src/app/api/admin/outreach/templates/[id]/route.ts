import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { validateTemplateBody } from "@/lib/outreach/templates";
import { isProspectCategory, isOutreachLanguage } from "@/lib/outreach/types";

const patchSchema = z.object({
  language: z.string().refine(isOutreachLanguage).optional(),
  category: z.union([z.string().refine(isProspectCategory), z.literal("ALL")]).optional(),
  body: z.string().trim().min(1).max(1500).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (await isRateLimited(`outreach-template:${guard.user.id}`, 120, 10 * 60 * 1000)) {
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
      { error: "invalid update", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (parsed.data.body !== undefined) {
    const bodyError = validateTemplateBody(parsed.data.body);
    if (bodyError) {
      return NextResponse.json({ error: bodyError }, { status: 400 });
    }
  }

  const template = await prisma.invitationTemplate.update({
    where: { id },
    data: parsed.data,
  });

  return NextResponse.json({ template });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const inUse = await prisma.outreachInvitation.count({
    where: { templateId: id },
  });

  if (inUse > 0) {
    // Deactivating keeps the historical invitations readable.
    const template = await prisma.invitationTemplate.update({
      where: { id },
      data: { active: false },
    });
    return NextResponse.json({ template, deactivated: true });
  }

  await prisma.invitationTemplate.delete({ where: { id } });
  return NextResponse.json({ deleted: true });
}
