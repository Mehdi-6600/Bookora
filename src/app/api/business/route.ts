import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { COUNTRY_CURRENCY, isCountryCode } from "@/lib/currency";

const createBusinessSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  country: z.string().refine(isCountryCode, "کشور معتبر نیست."),
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

async function createUniqueSlug(name: string): Promise<string> {
  const base = createBaseSlug(name);
  let slug = base;
  let counter = 2;

  while (await prisma.business.findUnique({ where: { slug } })) {
    slug = `${base}-${counter}`;
    counter += 1;
  }

  return slug;
}

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const businesses = await prisma.business.findMany({
      where: {
        ownerId: user.id,
      },
      orderBy: {
        createdAt: "asc",
      },
      include: {
        services: {
          orderBy: [
            { sortOrder: "asc" },
            { createdAt: "asc" },
          ],
        },
        _count: {
          select: {
            bookings: true,
          },
        },
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
        status: business.status,
        services: business.services.map((service) => ({
          id: service.id,
          name: service.name,
          description: service.description,
          price: service.price.toString(),
          currency: service.currency,
          durationMinutes: service.durationMinutes,
          active: service.active,
        })),
        _count: {
          bookings: business._count.bookings,
        },
      })),
    });
  } catch (error) {
    console.error("GET /api/business failed:", error);

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
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON" },
        { status: 400 }
      );
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
    const slug = await createUniqueSlug(name);

    const business = await prisma.business.create({
      data: {
        ownerId: user.id,
        name,
        slug,
        description,
        country,
        currency,
      },
      include: {
        services: true,
        _count: {
          select: {
            bookings: true,
          },
        },
      },
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
          status: business.status,
          services: business.services.map((service) => ({
            id: service.id,
            name: service.name,
            description: service.description,
            price: service.price.toString(),
            currency: service.currency,
            durationMinutes: service.durationMinutes,
            active: service.active,
          })),
          _count: {
            bookings: business._count.bookings,
          },
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/business failed:", error);

    return NextResponse.json(
      { error: "ساخت کسب‌وکار ناموفق بود." },
      { status: 500 }
    );
  }
}
