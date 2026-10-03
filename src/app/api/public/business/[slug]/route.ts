import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const business = await prisma.business.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        currency: true,
        country: true,
        timezone: true,
        status: true,
        services: {
          where: { active: true },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            currency: true,
            durationMinutes: true,
            depositType: true,
            depositValue: true,
          },
        },
      },
    });

    if (!business || business.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "کسب‌وکار پیدا نشد." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      business: {
        name: business.name,
        description: business.description,
        currency: business.currency,
        country: business.country,
        timezone: business.timezone || "UTC",
        services: business.services.map((service) => ({
          id: service.id,
          name: service.name,
          description: service.description,
          price: service.price.toString(),
          currency: service.currency,
          durationMinutes: service.durationMinutes,
          depositType: service.depositType,
          depositValue: service.depositValue.toString(),
        })),
      },
    });
  } catch (error) {
    console.error(
      "GET /api/public/business/[slug] failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "خطا در دریافت کسب‌وکار" },
      { status: 500 }
    );
  }
}
