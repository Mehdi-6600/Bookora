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
  APPROVED_CITIES,
  BUSINESS_SEGMENTS,
  isCityCode,
  isBusinessSegment,
} from "@/lib/outreach/cities";
import { normalizeLanguage } from "@/lib/outreach/types";

export async function GET() {
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

  return NextResponse.json(
    {
      cities: APPROVED_CITIES,
      segments: BUSINESS_SEGMENTS,
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
  cities: z.array(z.string()).max(4).default([]),
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

function cleanCities(values: string[]) {
  return values
    .map((value) => value.trim().toUpperCase())
    .filter(isCityCode)
    .filter((value, index, all) => all.indexOf(value) === index);
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

  const data = parsed.data;
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

  const campaign = await prisma.outreachCampaign.create({
    data: {
      code,
      name: data.name,
      description: data.description ?? null,
      active: data.active,
      status: "DRAFT",
      cities: cleanCities(data.cities),
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

  return NextResponse.json(
    {
      campaign,
      deepLink: buildBotDeepLink(buildCampaignStartParam(campaign.code)),
    },
    { status: 201 }
  );
}
