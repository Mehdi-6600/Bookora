import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { COUNTRY_CURRENCY, isCountryCode } from "@/lib/currency";
import { getEffectiveBusinessStatus } from "@/lib/business/lifecycle";
import {
  BUSINESS_SCHEMA_MIGRATION_REQUIRED,
  getPrismaSchemaMismatch,
} from "@/lib/business/schema-drift";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { normalizeTimeZone } from "@/lib/booking/time";
import { markRegistered } from "@/lib/outreach/attribution";

const creationKeySchema = z.string().uuid();

class BusinessCreationConflictError extends Error {}

const createBusinessSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  country: z.string().refine(isCountryCode, "invalid country"),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((value) => normalizeTimeZone(value) !== null, "invalid timezone")
    .optional(),
});

function createBaseSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  return slug || "business";
}

function resolveTimezone(country: string): string {
  return country === "IR" ? "Asia/Tehran" : "UTC";
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();
    const businesses = await prisma.business.findMany({
      where: { ownerId: user.id, deletedAt: null },
      orderBy: { createdAt: "asc" },
      include: {
        services: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
        _count: { select: { bookings: true } },
      },
    });

    return NextResponse.json({
      businesses: businesses.map((business) => ({
        id: business.id,
        name: business.name,
        slug: business.slug,
        description: business.description,
        country: business.country,
        currency: business.currency,
        timezone: business.timezone,
        status: getEffectiveBusinessStatus(business, now),
        expiresAt: business.expiresAt,
        setupCompletedAt: business.setupCompletedAt,
        services: business.services.map((service) => ({
          id: service.id,
          name: service.name,
          description: service.description,
          price: service.price.toString(),
          currency: service.currency,
          durationMinutes: service.durationMinutes,
          slotIntervalMinutes: service.slotIntervalMinutes,
          active: service.active,
          depositType: service.depositType,
          depositValue: service.depositValue.toString(),
        })),
        _count: { bookings: business._count.bookings },
      })),
    });
  } catch (error) {
    const schemaMismatch = getPrismaSchemaMismatch(error);
    if (schemaMismatch) {
      console.error("GET /api/business schema mismatch:", schemaMismatch);
      return NextResponse.json(
        {
          error: "The business database needs a schema update.",
          code: BUSINESS_SCHEMA_MIGRATION_REQUIRED,
        },
        { status: 503 }
      );
    }

    console.error(
      "GET /api/business failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "failed to load businesses" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (await isRateLimited(`business-create:${user.id}`, 5, 60 * 60 * 1000)) {
      return NextResponse.json(
        { error: "too many requests" },
        { status: 429 }
      );
    }
    triggerRateLimitCleanup();

    const parsedCreationKey = creationKeySchema.safeParse(
      req.headers.get("idempotency-key")
    );
    if (!parsedCreationKey.success) {
      return NextResponse.json(
        { error: "کلید یکتای درخواست کسب‌وکار معتبر نیست." },
        { status: 400 }
      );
    }
    const creationKey = parsedCreationKey.data;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = createBusinessSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "invalid business",
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const name = parsed.data.name;
    const description = parsed.data.description || null;
    const country = parsed.data.country;
    const currency = COUNTRY_CURRENCY[country];
    const timezone = parsed.data.timezone
      ? normalizeTimeZone(parsed.data.timezone)!
      : resolveTimezone(country);

    let lastError: unknown = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const result = await prisma.$transaction(async (tx) => {
          await tx.$queryRaw<Array<{ locked: string }>>`
            SELECT pg_advisory_xact_lock(
              hashtext(${user.id}::text),
              hashtext('business-slug'::text)
            )::text AS locked
          `;

          const existing = await tx.business.findUnique({
            where: {
              ownerId_creationKey: {
                ownerId: user.id,
                creationKey,
              },
            },
          });
          if (existing) {
            if (
              existing.name !== name ||
              existing.description !== description ||
              existing.country !== country ||
              existing.timezone !== timezone
            ) {
              throw new BusinessCreationConflictError();
            }
            return { business: existing, created: false };
          }

          const base = createBaseSlug(name);
          let slug = base;
          let counter = 2;

          while (
            await tx.business.findUnique({ where: { slug: slug } })
          ) {
            slug = base + "-" + counter;
            counter += 1;
          }

          const created = await tx.business.create({
            data: {
              ownerId: user.id,
              name: name,
              slug: slug,
              description: description,
              country: country,
              currency: currency,
              timezone: timezone,
              status: "DRAFT",
              creationKey,
            },
          });

          return { business: created, created: true };
        });

        // Best-effort growth attribution. Never fails the request.
        if (result.created) void markRegistered(user.id, result.business.id);
        const business = result.business;

        return NextResponse.json(
          {
            business: {
              id: business.id,
              name: business.name,
              slug: business.slug,
              description: business.description,
              country: business.country,
              currency: business.currency,
              timezone: business.timezone,
              status: business.status,
              setupCompletedAt: business.setupCompletedAt,
              services: [],
              _count: { bookings: 0 },
            },
          },
          { status: result.created ? 201 : 200 }
        );
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          lastError = err;
          continue;
        }

        throw err;
      }
    }

    console.error(
      "POST /api/business failed after retries:",
      lastError instanceof Error ? lastError.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "failed to create business" },
      { status: 500 }
    );
  } catch (error) {
    if (error instanceof BusinessCreationConflictError) {
      return NextResponse.json(
        {
          error: "کلید درخواست ایجاد کسب‌وکار قبلاً با اطلاعات دیگری استفاده شده است.",
          code: "IDEMPOTENCY_CONFLICT",
        },
        { status: 409 }
      );
    }

    const schemaMismatch = getPrismaSchemaMismatch(error);
    if (schemaMismatch) {
      console.error("POST /api/business schema mismatch:", schemaMismatch);
      return NextResponse.json(
        {
          error: "The business database needs a schema update.",
          code: BUSINESS_SCHEMA_MIGRATION_REQUIRED,
        },
        { status: 503 }
      );
    }

    console.error(
      "POST /api/business failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "failed to create business" },
      { status: 500 }
    );
  }
}
