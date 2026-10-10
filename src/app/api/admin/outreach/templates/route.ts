import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { DEFAULT_TEMPLATES, validateTemplateBody } from "@/lib/outreach/templates";
import {
  isProspectCategory,
  isOutreachLanguage,
} from "@/lib/outreach/types";

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const templates = await prisma.invitationTemplate.findMany({
    orderBy: [{ language: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      language: true,
      category: true,
      body: true,
      active: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(
    { templates, defaults: DEFAULT_TEMPLATES },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const createSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9_]+$/i, "code must be alphanumeric"),
  language: z.string().refine(isOutreachLanguage, "unsupported language"),
  category: z.union([z.string().refine(isProspectCategory), z.literal("ALL")]).default("ALL"),
  body: z.string().trim().min(1).max(1500),
  active: z.boolean().default(true),
});

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (await isRateLimited(`outreach-template:${guard.user.id}`, 60, 10 * 60 * 1000)) {
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
      { error: "invalid template", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const bodyError = validateTemplateBody(parsed.data.body);
  if (bodyError) {
    return NextResponse.json({ error: bodyError }, { status: 400 });
  }

  const existing = await prisma.invitationTemplate.findUnique({
    where: { code: parsed.data.code },
    select: { id: true },
  });

  if (existing) {
    return NextResponse.json(
      { error: "template code already exists" },
      { status: 409 }
    );
  }

  const template = await prisma.invitationTemplate.create({
    data: {
      code: parsed.data.code,
      language: parsed.data.language,
      category: parsed.data.category,
      body: parsed.data.body,
      active: parsed.data.active,
    },
  });

  return NextResponse.json({ template }, { status: 201 });
}
