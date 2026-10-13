import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  canAdminSoftDeleteBusiness,
  getEffectiveBusinessStatus,
} from "@/lib/business/lifecycle";

const ALLOWED_STATUSES = [
  "ACTIVE",
  "DRAFT",
  "EXPIRED",
  "DISABLED",
  "ARCHIVED",
] as const;
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

    const now = new Date();
    const filters: Prisma.BusinessWhereInput[] = [{ deletedAt: null }];

    if (status === "ACTIVE") {
      filters.push({
        status: "ACTIVE",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      });
    } else if (status === "EXPIRED") {
      filters.push({
        OR: [
          { status: "EXPIRED" },
          { status: "ACTIVE", expiresAt: { lte: now } },
        ],
      });
    } else if (status !== "ALL") {
      filters.push({ status });
    }

    if (q) {
      filters.push({
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { slug: { contains: q, mode: "insensitive" } },
          { phone: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { owner: { firstName: { contains: q, mode: "insensitive" } } },
          { owner: { lastName: { contains: q, mode: "insensitive" } } },
          { owner: { telegramUsername: { contains: q, mode: "insensitive" } } },
          { owner: { telegramId: { contains: q, mode: "insensitive" } } },
        ],
      });
    }

    const where: Prisma.BusinessWhereInput = { AND: filters };
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
        phone: biz.phone,
        email: biz.email,
        currency: biz.currency,
        timezone: biz.timezone,
        status: getEffectiveBusinessStatus(biz, now),
        createdAt: biz.createdAt,
        expiresAt: biz.expiresAt,
        canSoftDelete: canAdminSoftDeleteBusiness(biz, now),
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
    console.error(
      "GET /api/admin/businesses failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "خطا در دریافت کسب‌وکارها" },
      { status: 500 }
    );
  }
}
