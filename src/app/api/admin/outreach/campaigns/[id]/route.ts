import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { buildBotDeepLink, buildCampaignStartParam } from "@/lib/outreach/deeplink";
import { isCityCode, isBusinessSegment } from "@/lib/outreach/cities";
import { normalizeLanguage } from "@/lib/outreach/types";
import { planCampaign } from "@/lib/outreach/campaigns";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const campaign = await prisma.outreachCampaign.findUnique({
    where: { id },
    include: {
      template: { select: { id: true, code: true, language: true } },
      _count: { select: { prospects: true, botStarts: true, invitations: true } },
    },
  });

  if (!campaign) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const plan = await planCampaign(campaign);

  return NextResponse.json(
    {
      campaign: {
        ...campaign,
        templateCode: campaign.template?.code ?? null,
        deepLink: buildBotDeepLink(buildCampaignStartParam(campaign.code)),
      },
      counts: campaign._count,
      plan,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().optional(),
  cities: z.array(z.string()).max(4).optional(),
  segments: z.array(z.string()).max(2).optional(),
  language: z.string().trim().max(8).optional(),
  objective: z.string().trim().max(200).nullable().optional(),
  templateId: z.string().trim().max(64).nullable().optional(),
  cta: z.string().trim().max(120).nullable().optional(),
  destinationUrl: z.string().trim().max(500).nullable().optional(),
  followUpPolicy: z.enum(["ONE_FOLLOWUP", "NO_FOLLOWUP"]).optional(),
  channel: z.enum(["TELEGRAM_BOT", "MANUAL"]).optional(),
  sendLimit: z.number().int().min(0).max(100).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (await isRateLimited(`outreach-campaign:${guard.user.id}`, 60, 10 * 60 * 1000)) {
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
      { error: "invalid patch", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const campaign = await prisma.outreachCampaign.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!campaign) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Once approved, targeting is frozen so results stay attributable.
  if (campaign.status !== "DRAFT" && campaign.status !== "REVIEW") {
    return NextResponse.json(
      { error: "Targeting is locked after approval." },
      { status: 409 }
    );
  }

  const data = parsed.data;
  const update: Record<string, unknown> = {};

  if (data.name !== undefined) update.name = data.name;
  if (data.description !== undefined) update.description = data.description;
  if (data.active !== undefined) update.active = data.active;
  if (data.objective !== undefined) update.objective = data.objective;
  if (data.templateId !== undefined) update.templateId = data.templateId;
  if (data.cta !== undefined) update.cta = data.cta;
  if (data.destinationUrl !== undefined) update.destinationUrl = data.destinationUrl;
  if (data.followUpPolicy !== undefined) update.followUpPolicy = data.followUpPolicy;
  if (data.channel !== undefined) update.channel = data.channel;
  if (data.sendLimit !== undefined) update.sendLimit = data.sendLimit;
  if (data.language !== undefined) update.language = normalizeLanguage(data.language);
  if (data.cities !== undefined) {
    update.cities = data.cities
      .map((v) => v.trim().toUpperCase())
      .filter(isCityCode);
  }
  if (data.segments !== undefined) {
    update.segments = data.segments
      .map((v) => v.trim().toUpperCase())
      .filter(isBusinessSegment);
  }

  const updated = await prisma.outreachCampaign.update({
    where: { id },
    data: update,
  });

  return NextResponse.json({ campaign: updated });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const campaign = await prisma.outreachCampaign.findUnique({
    where: { id },
    select: { id: true, status: true, _count: { select: { invitations: true } } },
  });
  if (!campaign) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (campaign._count.invitations > 0) {
    return NextResponse.json(
      { error: "Cannot delete a campaign that already has invitations." },
      { status: 409 }
    );
  }

  await prisma.outreachCampaign.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
