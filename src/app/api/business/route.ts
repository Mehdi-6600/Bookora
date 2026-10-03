import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { COUNTRY_CURRENCY, isCountryCode } from "@/lib/currency";
import { FREE_BUSINESS_LIMIT } from "@/lib/subscription/plans";
import { activePaidSubscriptionWhere } from "@/lib/subscription/entitlement";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { normalizeTimeZone } from "@/lib/booking/time";

const createBusinessSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  country: z.string().refine(isCountryCode, "کشور معتبر نیست."),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((value) => normalizeTimeZone(value) !== null, "منطقه زمانی معتبر نیست.")
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

    const businesses = await prisma.business.findMany({
      where: { ownerId: user.id },
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
        status: business.status,
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
    console.error(
      "GET /api/business failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "خطا در دریافت کسب‌وکارها" },
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
        { error: "درخواست‌های زیاد. کمی بعد دوباره تلاش کنید." },
        { status: 429 }
      );
    }
    triggerRateLimitCleanup();

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
          error: "اطلاعات کسب‌وکار معتبر نیست.",
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

    // استفاده از advisory lock برای جلوگیری از race در free business limit.
    // همچنین retry برای P2002 (unique constraint) در صورت collision slug.
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const business = await prisma.$transaction(async (tx) => {
          // قفل اتمیک روی free-limit این کاربر.
          await tx.$queryRaw`
            SELECT pg_advisory_xact_lock(
              hashtext(${user.id}::text),
              hashtext('business-limit'::text)
            )
          `;

          const existingCount = await tx.business.count({
            where: { ownerId: user.id },
          });

          if (existingCount >= FREE_BUSINESS_LIMIT) {
            const activeSubscription = await tx.subscription.findFirst({
              where: activePaidSubscriptionWhere(user.id, new Date()),
              select: { id: true },
            });

            if (!activeSubscription) {
              throw new Error("SUBSCRIPTION_REQUIRED");
            }
          }

          // ساخت slug یکتا داخل transaction.
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
            },
          });

          return created;
        });

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
              services: [],
              _count: { bookings: 0 },
            },
          },
          { status: 201 }
        );
      } catch (err) {
        if (err instanceof Error && err.message === "SUBSCRIPTION_REQUIRED") {
          return NextResponse.json(
            {
              error:
                "برای ساخت بیش از یک کسب‌وکار، ابتدا باید اشتراک بخرید.",
              code: "SUBSCRIPTION_REQUIRED",
            },
            { status: 403 }
          );
        }

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
      { error: "ساخت کسب‌وکار ناموفق بود." },
      { status: 500 }
    );
  } catch (error) {
    console.error(
      "POST /api/business failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "ساخت کسب‌وکار ناموفق بود." },
      { status: 500 }
    );
  }
}
