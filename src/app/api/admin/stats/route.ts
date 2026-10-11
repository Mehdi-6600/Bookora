import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

function daysAgo(days: number): Date {
  const now = new Date();
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user || !user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const since7d = daysAgo(7);

    const [
      usersTotal,
      usersNew7d,
      businessesTotal,
      businessesActive,
      businessesArchived,
      bookingsTotal,
      bookings7d,
      bookingsPendingPayment,
      subscriptionsActive,
      subscriptionsPending,
      paymentsPendingReview,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: since7d } } }),
      prisma.business.count(),
      prisma.business.count({ where: { status: "ACTIVE" } }),
      prisma.business.count({ where: { status: "ARCHIVED" } }),
      // Test bookings are verification traffic, not customer demand, so they
      // are excluded from the booking totals the team reads as demand.
      prisma.booking.count({ where: { isTestBooking: false } }),
      prisma.booking.count({
        where: { createdAt: { gte: since7d }, isTestBooking: false },
      }),
      prisma.booking.count({
        where: { status: "PENDING_PAYMENT", isTestBooking: false },
      }),
      prisma.subscription.count({ where: { status: "ACTIVE" } }),
      prisma.subscription.count({ where: { status: "PENDING" } }),
      prisma.payment.count({ where: { status: "PENDING" } }),
    ]);

    return NextResponse.json({
      users: { total: usersTotal, last7d: usersNew7d },
      businesses: {
        total: businessesTotal,
        active: businessesActive,
        archived: businessesArchived,
      },
      bookings: {
        total: bookingsTotal,
        last7d: bookings7d,
        pendingPayment: bookingsPendingPayment,
      },
      subscriptions: {
        active: subscriptionsActive,
        pending: subscriptionsPending,
      },
      payments: { pendingReview: paymentsPendingReview },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "GET /api/admin/stats failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "خطا در دریافت آمار" },
      { status: 500 }
    );
  }
}
