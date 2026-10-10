import { withOutreachError } from "@/lib/outreach/api-error";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import {
  buildBotDeepLink,
  buildCampaignStartParam,
} from "@/lib/outreach/deeplink";
import {
  BUSINESS_SEGMENTS,
  CITY_REGISTRY,
  isBusinessSegment,
  parseCampaignCities,
  getEffectiveApprovedCities,
  MAX_CAMPAIGN_CITIES,
} from "@/lib/outreach/cities";
import { normalizeLanguage } from "@/lib/outreach/types";
import { validateDestinationUrl } from "@/lib/outreach/message";
import { getOutreachSettings } from "@/lib/outreach/settings";
import { env } from "@/lib/env";
import { recordAuditEvent } from "@/lib/outreach/audit";

async function GETImpl() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const campaigns = await prisma.outreachCampaign.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      template: { select: { id: true, code: true, language: true } },
      _count: {
        select: { prospects: true, botStarts: true, invitations: true },
      },
    },
  });

  // The picker data is registry-wide: every known code with its labels and an
  // `approved` flag, so the UI never hardcodes a city list and admins can see
  // which markets exist but are not approved yet. `approved` reflects the
  // effective per-deployment approval set from `admin_settings`.
  const approved = await getEffectiveApprovedCities();
  const settings = await getOutreachSettings();

  return NextResponse.json(
    {
      cities: approved,
      segments: BUSINESS_SEGMENTS,
      maxCampaignCities: MAX_CAMPAIGN_CITIES,
      cityRegistry: CITY_REGISTRY.map((entry) => ({
        code: entry.code,
        fa: entry.fa,
        en: entry.en,
        region: entry.region,
        country: entry.country,
        approved: approved.includes(entry.code),
      })),
      messageDefaults: {
        botUrl: buildBotDeepLink("START_PARAM"),
        botUsername: env.TELEGRAM_BOT_USERNAME,
        channelUrl: settings.channelUrl,
      },
      campaigns: campaigns.map((campaign) => ({
        id: campaign.id,
        code: campaign.code,
        name: campaign.name,
        description: campaign.description,
        active: campaign.active,
        status: campaign.status,
        cities: campaign.cities,
        segments: campaign.segments,
        language: campaign.language,
        objective: campaign.objective,
        templateId: campaign.templateId,
        templateCode: campaign.template?.code ?? null,
        cta: campaign.cta,
        destinationUrl: campaign.destinationUrl,
        followUpPolicy: campaign.followUpPolicy,
        channel: campaign.channel,
        sendLimit: campaign.sendLimit,
        approvedAt: campaign.approvedAt,
        lastDryRunAt: campaign.lastDryRunAt,
        lastPreparedAt: campaign.lastPreparedAt,
        createdAt: campaign.createdAt,
        prospectCount: campaign._count.prospects,
        botStartCount: campaign._count.botStarts,
        invitationCount: campaign._count.invitations,
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
    .regex(/^[a-z0-9-]+$/i, "code must be alphanumeric")
    .optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().default(true),
  cities: z.array(z.string()).max(MAX_CAMPAIGN_CITIES).default([]),
  segments: z.array(z.string()).max(2).default([]),
  language: z.string().trim().max(8).default("fa"),
  objective: z.string().trim().max(200).nullable().optional(),
  templateId: z.string().trim().max(64).nullable().optional(),
  cta: z.string().trim().max(120).nullable().optional(),
  destinationUrl: z.string().trim().max(500).nullable().optional(),
  followUpPolicy: z.enum(["ONE_FOLLOWUP", "NO_FOLLOWUP"]).default("ONE_FOLLOWUP"),
  channel: z.enum(["TELEGRAM_BOT", "MANUAL"]).default("TELEGRAM_BOT"),
  sendLimit: z.number().int().min(0).max(100).nullable().optional(),
});

/**
 * Strict campaign city validation. Unknown codes and codes the administrator
 * has not approved are reported back as explicit errors — never dropped
 * silently, never substituted with another city.
 */
function validateCities(values: string[], approvedCodes: string[]) {
  const parsed = parseCampaignCities(values, approvedCodes);
  return parsed;
}

function cleanSegments(values: string[]) {
  return values
    .map((value) => value.trim().toUpperCase())
    .filter(isBusinessSegment)
    .filter((value, index, all) => all.indexOf(value) === index);
}

function campaignCode(): string {
  return `cmp-${Math.random().toString(36).slice(2, 8)}${Date.now()
    .toString(36)
    .slice(-4)}`;
}

async function POSTImpl(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const approvedCodes = await getEffectiveApprovedCities();

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

  const data = parsed.data;

  const targeting = validateCities(data.cities, approvedCodes);
  if (targeting.tooMany) {
    return NextResponse.json(
      { error: `A campaign may target at most ${MAX_CAMPAIGN_CITIES} cities.` },
      { status: 400 }
    );
  }
  if (targeting.unknown.length > 0) {
    return NextResponse.json(
      { error: "unknown cities", unknown: targeting.unknown, hint: "Only codes from the market registry can be used; add new cities to prisma/../city-registry.ts first." },
      { status: 400 }
    );
  }
  if (targeting.unapproved.length > 0) {
    return NextResponse.json(
      { error: "cities not approved", unapproved: targeting.unapproved, hint: "Approve the market in Campaigns → Markets before targeting it." },
      { status: 400 }
    );
  }

  if (data.destinationUrl) {
    const valid = validateDestinationUrl(data.destinationUrl);
    if (!valid.ok) {
      return NextResponse.json(
        { error: `destinationUrl: ${valid.reason}` },
        { status: 400 }
      );
    }
  }

  const code = data.code ?? campaignCode();

  const existing = await prisma.outreachCampaign.findUnique({
    where: { code },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "campaign code already exists" },
      { status: 409 }
    );
  }

  if (data.templateId) {
    const template = await prisma.invitationTemplate.findUnique({
      where: { id: data.templateId },
      select: { id: true },
    });
    if (!template) {
      return NextResponse.json({ error: "template not found" }, { status: 400 });
    }
  }

  const campaign = await prisma.$transaction(async (tx) => {
  const campaign = await tx.outreachCampaign.create({
    data: {
      code,
      name: data.name,
      description: data.description ?? null,
      active: data.active,
      status: "DRAFT",
      cities: targeting.cities,
      segments: cleanSegments(data.segments),
      language: normalizeLanguage(data.language),
      objective: data.objective ?? null,
      templateId: data.templateId ?? null,
      cta: data.cta ?? null,
      destinationUrl: data.destinationUrl ?? null,
      followUpPolicy: data.followUpPolicy,
      channel: data.channel,
      sendLimit: data.sendLimit ?? null,
      requestedById: guard.user.id,
    },
  });

  await recordAuditEvent({
    scope: "campaign",
    entityId: campaign.id,
    action: "campaign.created",
    actorUserId: guard.user.id,
    detail: `cities=${campaign.cities.length} language=${campaign.language}`,
  }, tx);
  return campaign;
  });

  return NextResponse.json(
    {
      campaign,
      deepLink: buildBotDeepLink(buildCampaignStartParam(campaign.code)),
    },
    { status: 201 }
  );
}

export const GET = withOutreachError(GETImpl);
export const POST = withOutreachError(POSTImpl);
