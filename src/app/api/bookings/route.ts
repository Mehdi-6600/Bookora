import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";
import {
  expireStalePendingBookings,
  lockBusinessSchedule,
} from "@/lib/booking/schedule";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ip = getClientIp(req);
    if (await isRateLimited(`bookings:${user.id}:${ip}`, 100, 10 * 60 * 1000)) {
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

    const bookings = await prisma.$transaction(async (tx) => {
      await lockBusinessSchedule(tx, business.id);
      await expireStalePendingBookings(tx, business.id);

      return tx.booking.findMany({
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
    });

    return NextResponse.json(
      {
        bookings: bookings.map((booking) => ({
          id: booking.id,
          serviceName: booking.service.name,
          customerName: booking.customerName,
          customerPhone: booking.customerPhone,
          startAt: booking.startAt,
          timezone: booking.timezone,
          status: booking.status,
          paymentStatus: booking.paymentStatus,
          depositDue: booking.depositDue.toString(),
          currency: booking.currency,
          payment: booking.payments[0]
            ? {
                id: booking.payments[0].id,
                status: booking.payments[0].status,
                transactionReference: booking.payments[0].transactionReference,
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
