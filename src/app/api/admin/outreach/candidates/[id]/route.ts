import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { isCandidateStatus } from "@/lib/outreach/types";

const patchSchema = z.object({
  status: z.string().refine(isCandidateStatus, "invalid status"),
  reviewNote: z.string().trim().max(500).nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (await isRateLimited(`outreach-candidate:${guard.user.id}`, 300, 10 * 60 * 1000)) {
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

  const candidate = await prisma.discoveryCandidate.update({
    where: { id },
    data: {
      status: parsed.data.status,
      ...(parsed.data.reviewNote !== undefined
        ? { reviewNote: parsed.data.reviewNote }
        : {}),
    },
  });

  return NextResponse.json({ candidate });
}
