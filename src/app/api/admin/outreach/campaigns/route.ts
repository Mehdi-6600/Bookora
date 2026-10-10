import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { buildBotDeepLink, buildCampaignStartParam } from "@/lib/outreach/deeplink";

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const campaigns = await prisma.outreachCampaign.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      _count: { select: { prospects: true, botStarts: true } },
    },
  });

  return NextResponse.json(
    {
      campaigns: campaigns.map((campaign) => ({
        id: campaign.id,
        code: campaign.code,
        name: campaign.name,
        description: campaign.description,
        active: campaign.active,
        createdAt: campaign.createdAt,
        prospectCount: campaign._count.prospects,
        botStartCount: campaign._count.botStarts,
        deepLink: buildBotDeepLink(buildCampaignStartParam(campaign.code)),
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const createSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/i, "code must be alphanumeric"),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().default(true),
});

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (await isRateLimited(`outreach-campaign:${guard.user.id}`, 60, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  triggerRateLimitCleanup();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid campaign", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const existing = await prisma.outreachCampaign.findUnique({
    where: { code: parsed.data.code },
    select: { id: true },
  });

  if (existing) {
    return NextResponse.json(
      { error: "campaign code already exists" },
      { status: 409 }
    );
  }

  const campaign = await prisma.outreachCampaign.create({
    data: {
      code: parsed.data.code,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      active: parsed.data.active,
    },
  });

  return NextResponse.json(
    {
      campaign,
      deepLink: buildBotDeepLink(buildCampaignStartParam(campaign.code)),
    },
    { status: 201 }
  );
}
