import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

const ALLOWED_STATUSES = ["PENDING", "ACTIVE", "REJECTED"] as const;
type AllowedStatus = (typeof ALLOWED_STATUSES)[number];

function parseStatus(value: string | null): AllowedStatus | "ALL" {
  if (!value) return "PENDING";
  const upper = value.toUpperCase();
  if (upper === "ALL") return "ALL";
  if ((ALLOWED_STATUSES as readonly string[]).includes(upper)) {
    return upper as AllowedStatus;
  }
  return "PENDING";
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user || !user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const status = parseStatus(req.nextUrl.searchParams.get("status"));

    const subscriptions = await prisma.subscription.findMany({
      where: status === "ALL" ? {} : { status },
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            telegramUsername: true,
            firstName: true,
            lastName: true,
            telegramId: true,
          },
        },
        business: {
          select: { name: true, slug: true },
        },
      },
    });

    return NextResponse.json({
      subscriptions: subscriptions.map((sub) => ({
        id: sub.id,
        plan: sub.plan,
        status: sub.status,
        receiptReference: sub.receiptReference,
        receiptNote: sub.receiptNote,
        adminNote: sub.adminNote,
        createdAt: sub.createdAt,
        reviewedAt: sub.reviewedAt,
        businessName: sub.business?.name || null,
        businessSlug: sub.business?.slug || null,
        userName:
          sub.user.firstName ||
          sub.user.telegramUsername ||
          sub.user.telegramId,
      })),
    });
  } catch (error) {
    console.error("GET /api/admin/subscriptions failed:", error);

    return NextResponse.json(
      { error: "خطا در دریافت درخواست‌ها" },
      { status: 500 }
    );
  }
}
