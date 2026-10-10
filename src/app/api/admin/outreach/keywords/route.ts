import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { DEFAULT_KEYWORDS } from "@/lib/outreach/keywords";
import { isKeywordGroup, KEYWORD_GROUPS } from "@/lib/outreach/types";

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const keywords = await prisma.discoveryKeyword.findMany({
    orderBy: [{ group: "asc" }, { priority: "desc" }, { term: "asc" }],
    select: {
      id: true,
      term: true,
      group: true,
      language: true,
      priority: true,
      enabled: true,
      createdAt: true,
    },
  });

  return NextResponse.json(
    { groups: KEYWORD_GROUPS, defaults: DEFAULT_KEYWORDS, keywords },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const createSchema = z.object({
  term: z.string().trim().min(1).max(120),
  group: z.string().refine(isKeywordGroup, "invalid group"),
  language: z.string().trim().min(1).max(8).default("en"),
  priority: z.coerce.number().int().min(1).max(5).default(1),
  enabled: z.boolean().default(true),
});

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (await isRateLimited(`outreach-keyword:${guard.user.id}`, 200, 10 * 60 * 1000)) {
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
      { error: "invalid keyword", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const keyword = await prisma.discoveryKeyword.upsert({
    where: {
      group_language_term: {
        group: parsed.data.group,
        language: parsed.data.language,
        term: parsed.data.term,
      },
    },
    update: {
      priority: parsed.data.priority,
      enabled: parsed.data.enabled,
    },
    create: {
      term: parsed.data.term,
      group: parsed.data.group,
      language: parsed.data.language,
      priority: parsed.data.priority,
      enabled: parsed.data.enabled,
    },
  });

  return NextResponse.json({ keyword }, { status: 201 });
}

/**
 * Install the documented starter keyword set. Only MISSING terms are created.
 * Existing rows keep their enabled flag and priority, so a keyword the
 * administrator disabled on purpose is never silently re-enabled.
 */
export async function PUT() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  let created = 0;
  let kept = 0;

  for (const keyword of DEFAULT_KEYWORDS) {
    const existing = await prisma.discoveryKeyword.findUnique({
      where: {
        group_language_term: {
          group: keyword.group,
          language: keyword.language,
          term: keyword.term,
        },
      },
      select: { id: true },
    });

    if (existing) {
      kept += 1;
      continue;
    }

    await prisma.discoveryKeyword.create({
      data: {
        term: keyword.term,
        group: keyword.group,
        language: keyword.language,
        priority: keyword.priority,
        enabled: true,
      },
    });
    created += 1;
  }

  return NextResponse.json({ seeded: created, kept });
}
