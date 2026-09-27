import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const business = await prisma.business.findFirst({
      where: { slug, status: "ACTIVE" },
      select: {
        name: true,
        description: true,
        currency: true,
        country: true,
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
          },
        },
      },
    });

    if (!business) {
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
        services: business.services.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          price: s.price.toString(),
          currency: s.currency,
          durationMinutes: s.durationMinutes,
        })),
      },
    });
  } catch (error) {
    console.error("GET /api/public/business/[slug] failed:", error);

    return NextResponse.json(
      { error: "خطا در دریافت اطلاعات" },
      { status: 500 }
    );
  }
}
