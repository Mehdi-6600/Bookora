import { withOutreachError } from "@/lib/outreach/api-error";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { buildBotDeepLink, buildCampaignStartParam } from "@/lib/outreach/deeplink";
import {
  isBusinessSegment,
  parseCampaignCities,
  getEffectiveApprovedCities,
  MAX_CAMPAIGN_CITIES,
} from "@/lib/outreach/cities";
import { validateDestinationUrl } from "@/lib/outreach/message";
import { getAuditEvents, recordAuditEvent, AuditUnavailableError } from "@/lib/outreach/audit";
import { normalizeLanguage } from "@/lib/outreach/types";
import { planCampaign } from "@/lib/outreach/campaigns";

type Params = { params: Promise<{ id: string }> };

async function GETImpl(_req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const campaign = await prisma.outreachCampaign.findUnique({
    where: { id },
    include: {
      template: {
        select: { id: true, code: true, language: true, body: true },
      },
      _count: { select: { prospects: true, botStarts: true, invitations: true } },
    },
  });

  if (!campaign) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const plan = await planCampaign(campaign);
  let auditEvents;
  try {
    auditEvents = await getAuditEvents({ entityId: campaign.id, take: 100 });
  } catch (error) {
    if (error instanceof AuditUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
    throw error;
  }

  return NextResponse.json(
    {
      campaign: {
        ...campaign,
        templateCode: campaign.template?.code ?? null,
        templateBody: campaign.template?.body ?? null,
        deepLink: buildBotDeepLink(buildCampaignStartParam(campaign.code)),
      },
      counts: campaign._count,
      plan,
      auditEvents,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().optional(),
  cities: z.array(z.string()).max(MAX_CAMPAIGN_CITIES).optional(),
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

async function PATCHImpl(req: NextRequest, { params }: Params) {
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

  if (data.cities !== undefined) {
    const approvedCodes = await getEffectiveApprovedCities();
    const targeting = parseCampaignCities(data.cities, approvedCodes);
    if (targeting.tooMany) {
      return NextResponse.json(
        { error: `A campaign may target at most ${MAX_CAMPAIGN_CITIES} cities.` },
        { status: 400 }
      );
    }
    if (targeting.unknown.length > 0) {
      return NextResponse.json(
        { error: "unknown cities", unknown: targeting.unknown },
        { status: 400 }
      );
    }
    if (targeting.unapproved.length > 0) {
      return NextResponse.json(
        { error: "cities not approved", unapproved: targeting.unapproved },
        { status: 400 }
      );
    }
    update.cities = targeting.cities;
  }

  if (data.destinationUrl !== undefined && data.destinationUrl !== null) {
    const valid = validateDestinationUrl(data.destinationUrl);
    if (!valid.ok) {
      return NextResponse.json({ error: `destinationUrl: ${valid.reason}` }, { status: 400 });
    }
    update.destinationUrl = valid.url;
  } else if (data.destinationUrl === null) {
    update.destinationUrl = null;
  }

  if (data.name !== undefined) update.name = data.name;
  if (data.description !== undefined) update.description = data.description;
  if (data.active !== undefined) update.active = data.active;
  if (data.objective !== undefined) update.objective = data.objective;
  if (data.templateId !== undefined) update.templateId = data.templateId;
  if (data.cta !== undefined) update.cta = data.cta;
  if (data.followUpPolicy !== undefined) update.followUpPolicy = data.followUpPolicy;
  if (data.channel !== undefined) update.channel = data.channel;
  if (data.sendLimit !== undefined) update.sendLimit = data.sendLimit;
  if (data.language !== undefined) update.language = normalizeLanguage(data.language);
  if (data.segments !== undefined) {
    update.segments = data.segments
      .map((v) => v.trim().toUpperCase())
      .filter(isBusinessSegment);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.outreachCampaign.update({ where: { id }, data: update });
    await recordAuditEvent({ scope: "campaign", entityId: id, action: "campaign.updated",
      actorUserId: guard.user.id, detail: `keys=${Object.keys(update).join(",")}` }, tx);
    return row;
  });

  return NextResponse.json({ campaign: updated });
}

async function DELETEImpl(_req: NextRequest, { params }: Params) {
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

  await prisma.$transaction(async (tx) => {
    await tx.outreachCampaign.delete({ where: { id } });
    await recordAuditEvent({ scope: "campaign", entityId: id, action: "campaign.deleted",
      actorUserId: guard.user.id }, tx);
  });
  return NextResponse.json({ ok: true });
}

export const GET = withOutreachError(GETImpl);
export const PATCH = withOutreachError(PATCHImpl);
export const DELETE = withOutreachError(DELETEImpl);
