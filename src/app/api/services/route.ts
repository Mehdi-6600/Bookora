import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";

const createServiceSchema = z.object({
  businessId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  price: z.coerce.number().finite().min(0).max(99999999.99),
  durationMinutes: z.coerce.number().int().min(1).max(1440),
});

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const businessId = req.nextUrl.searchParams.get("businessId");

    const services = await prisma.service.findMany({
      where: {
        business: {
          ownerId: user.id,
        },
        ...(businessId ? { businessId } : {}),
      },
      orderBy: [
        { sortOrder: "asc" },
        { createdAt: "asc" },
      ],
    });

    return NextResponse.json({
      services: services.map((service) => ({
        id: service.id,
        businessId: service.businessId,
        name: service.name,
        description: service.description,
        price: service.price.toString(),
        currency: service.currency,
        durationMinutes: service.durationMinutes,
        active: service.active,
      })),
    });
  } catch (error) {
    console.error("GET /api/services failed:", error);

    return NextResponse.json(
      { error: "خطا در دریافت سرویس‌ها" },
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

    const parsed = createServiceSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "اطلاعات سرویس معتبر نیست.",
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const {
      businessId,
      name,
      description,
      price,
      durationMinutes,
    } = parsed.data;

    const business = await prisma.business.findFirst({
      where: {
        id: businessId,
        ownerId: user.id,
      },
      select: {
        id: true,
        currency: true,
      },
    });

    if (!business) {
      return NextResponse.json(
        { error: "کسب‌وکار پیدا نشد." },
        { status: 404 }
      );
    }

    const lastService = await prisma.service.findFirst({
      where: {
        businessId: business.id,
      },
      orderBy: {
        sortOrder: "desc",
      },
      select: {
        sortOrder: true,
      },
    });

    const service = await prisma.service.create({
      data: {
        businessId: business.id,
        name,
        description: description || null,
        price,
        currency: business.currency,
        durationMinutes,
        sortOrder: (lastService?.sortOrder ?? -1) + 1,
        active: true,
      },
    });

    return NextResponse.json(
      {
        service: {
          id: service.id,
          businessId: service.businessId,
          name: service.name,
          description: service.description,
          price: service.price.toString(),
          currency: service.currency,
          durationMinutes: service.durationMinutes,
          active: service.active,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/services failed:", error);

    return NextResponse.json(
      { error: "ساخت سرویس ناموفق بود." },
      { status: 500 }
    );
  }
}
