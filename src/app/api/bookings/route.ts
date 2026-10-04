import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ip = getClientIp(req);
    if (
      await isRateLimited(`bookings:${user.id}:${ip}`, 100, 10 * 60 * 1000)
    ) {
      return NextResponse.json(
        { error: "درخواست‌های زیاد. کمی صبر کنید." },
        { status: 429 }
      );
    }

    triggerRateLimitCleanup();

    const businessId = req.nextUrl.searchParams.get("businessId");

    if (!businessId || businessId.length > 100) {
      return NextResponse.json(
        { error: "businessId لازم است." },
        { status: 400 }
      );
    }

    const business = await prisma.business.findFirst({
      where: { id: businessId, ownerId: user.id },
      select: { id: true },
    });

    if (!business) {
      return NextResponse.json(
        { error: "کسب‌وکار پیدا نشد." },
        { status: 404 }
      );
    }

    const bookings = await prisma.booking.findMany({
      where: { businessId: business.id },
      orderBy: { startAt: "desc" },
      take: 50,
      include: {
        service: { select: { name: true } },
        payments: {
          where: { type: "DEPOSIT" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    return NextResponse.json(
      {
        bookings: bookings.map((b) => ({
          id: b.id,
          serviceName: b.service.name,
          customerName: b.customerName,
          customerPhone: b.customerPhone,
          startAt: b.startAt,
          status: b.status,
          paymentStatus: b.paymentStatus,
          depositDue: b.depositDue.toString(),
          currency: b.currency,
          payment: b.payments[0]
            ? {
                id: b.payments[0].id,
                status: b.payments[0].status,
                transactionReference: b.payments[0].transactionReference,
              }
            : null,
        })),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error(
      "GET /api/bookings failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "خطا در دریافت رزروها" },
      { status: 500 }
    );
  }
}
