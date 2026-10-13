import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { isBusinessPubliclyActive } from "@/lib/business/lifecycle";

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
        expiresAt: true,
        deletedAt: true,
        ownerId: true,
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

    if (!business) {
      return NextResponse.json(
        { error: "کسب‌وکار پیدا نشد." },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    let previewOnly = false;
    if (!isBusinessPubliclyActive(business)) {
      const wantsPreview = req.nextUrl.searchParams.get("preview") === "1";
      const viewer = wantsPreview && business.status === "DRAFT" && !business.deletedAt
        ? await getCurrentUser()
        : null;
      if (!viewer || viewer.id !== business.ownerId) {
        return NextResponse.json(
          { error: "این کسب‌وکار هنوز فعال نیست." },
          { status: 404, headers: { "Cache-Control": "no-store" } }
        );
      }
      previewOnly = true;
    }

    return NextResponse.json(
      {
        business: {
          name: business.name,
          description: business.description,
          currency: business.currency,
          country: business.country,
          timezone: business.timezone || "UTC",
          previewOnly,
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
      },
      { headers: { "Cache-Control": "no-store" } }
    );
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
