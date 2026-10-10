import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { isKeywordGroup } from "@/lib/outreach/types";

const patchSchema = z.object({
  term: z.string().trim().min(1).max(120).optional(),
  group: z.string().refine(isKeywordGroup).optional(),
  language: z.string().trim().min(1).max(8).optional(),
  priority: z.coerce.number().int().min(1).max(5).optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (await isRateLimited(`outreach-keyword:${guard.user.id}`, 200, 10 * 60 * 1000)) {
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

  const keyword = await prisma.discoveryKeyword.update({
    where: { id },
    data: parsed.data,
  });

  return NextResponse.json({ keyword });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  await prisma.discoveryKeyword.delete({ where: { id } });
  return NextResponse.json({ deleted: true });
}
