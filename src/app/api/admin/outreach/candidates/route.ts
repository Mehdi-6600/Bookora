import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { promoteCandidates } from "@/lib/outreach/discovery";
import { isCandidateStatus } from "@/lib/outreach/types";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const status = req.nextUrl.searchParams.get("status");
  const group = req.nextUrl.searchParams.get("group");
  const where: Record<string, unknown> = {};

  if (status && isCandidateStatus(status)) where.status = status;
  if (group) where.group = group;

  const candidates = await prisma.discoveryCandidate.findMany({
    where,
    orderBy: [{ score: "desc" }, { discoveredOn: "desc" }],
    take: 200,
    select: {
      id: true,
      publicName: true,
      publicUrl: true,
      description: true,
      source: true,
      group: true,
      matchedTerms: true,
      score: true,
      city: true,
      language: true,
      status: true,
      discoveredOn: true,
      reviewNote: true,
      prospectId: true,
    },
  });

  const runs = await prisma.discoveryRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 14,
  });

  return NextResponse.json(
    { candidates, runs },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const promoteSchema = z.object({
  candidateIds: z.array(z.string().trim().min(1).max(100)).min(1).max(200),
  campaignId: z.string().trim().max(100).nullable().optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (await isRateLimited(`outreach-promote:${guard.user.id}`, 60, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  triggerRateLimitCleanup();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = promoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Promotion creates UNVERIFIED (DISCOVERED) prospects. Verification is a
  // separate administrator action.
  const result = await promoteCandidates({
    candidateIds: parsed.data.candidateIds,
    campaignId: parsed.data.campaignId ?? null,
    actorUserId: guard.user.id,
  });

  return NextResponse.json(result, { status: 201 });
}
