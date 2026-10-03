import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

const ALLOWED_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
type AllowedStatus = (typeof ALLOWED_STATUSES)[number];

function parseStatus(value: string | null): AllowedStatus | "ALL" {
  if (!value) return "ALL";
  const upper = value.toUpperCase();
  if (upper === "ALL") return "ALL";
  if ((ALLOWED_STATUSES as readonly string[]).includes(upper)) {
    return upper as AllowedStatus;
  }
  return "ALL";
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user || !user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const status = parseStatus(req.nextUrl.searchParams.get("status"));
    const rawQ = req.nextUrl.searchParams.get("q");
    const q = rawQ ? rawQ.trim().slice(0, 100) : "";

    const where: Prisma.BusinessWhereInput = {};

    if (status !== "ALL") {
      where.status = status;
    }

    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
        { owner: { firstName: { contains: q, mode: "insensitive" } } },
        {
          owner: {
            telegramUsername: { contains: q, mode: "insensitive" },
          },
        },
      ];
    }

    const businesses = await prisma.business.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        owner: {
          select: {
            firstName: true,
            lastName: true,
            telegramUsername: true,
            telegramId: true,
          },
        },
        _count: {
          select: {
            services: true,
            bookings: true,
          },
        },
      },
    });

    return NextResponse.json({
      businesses: businesses.map((biz) => ({
        id: biz.id,
        name: biz.name,
        slug: biz.slug,
        country: biz.country,
        currency: biz.currency,
        status: biz.status,
        createdAt: biz.createdAt,
        owner: {
          firstName: biz.owner.firstName,
          lastName: biz.owner.lastName,
          username: biz.owner.telegramUsername,
          telegramId: biz.owner.telegramId,
        },
        counts: {
          services: biz._count.services,
          bookings: biz._count.bookings,
        },
      })),
    });
  } catch (error) {
    console.error("GET /api/admin/businesses failed:", error);
    return NextResponse.json(
      { error: "خطا در دریافت کسب‌وکارها" },
      { status: 500 }
    );
  }
}
