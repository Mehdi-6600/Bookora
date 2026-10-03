import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PENDING_TTL_MINUTES = 15;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    if (authHeader !== "Bearer " + cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const cutoff = new Date(Date.now() - PENDING_TTL_MINUTES * 60 * 1000);

    const staleBookings = await prisma.booking.findMany({
      where: {
        status: "PENDING_PAYMENT",
        paymentStatus: "PENDING",
        createdAt: { lt: cutoff },
      },
      select: { id: true },
      take: 200,
    });

    if (staleBookings.length === 0) {
      return NextResponse.json({ expired: 0 });
    }

    const ids = staleBookings.map((b) => b.id);
    const now = new Date();

    await prisma.$transaction([
      prisma.payment.updateMany({
        where: {
          bookingId: { in: ids },
          status: "PENDING",
        },
        data: { status: "REJECTED", rejectedAt: now },
      }),
      prisma.booking.updateMany({
        where: { id: { in: ids } },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
          paymentStatus: "REJECTED",
        },
      }),
    ]);

    return NextResponse.json({ expired: ids.length });
  } catch (error) {
    console.error("cron/expire-pending failed:", error);
    return NextResponse.json(
      { error: "خطا در اجرای cleanup" },
      { status: 500 }
    );
  }
}
