import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";

const reviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  try {
    const { id, paymentId } = await params;
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = reviewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "اطلاعات معتبر نیست." },
        { status: 400 }
      );
    }

    const booking = await prisma.booking.findFirst({
      where: { id, business: { ownerId: user.id } },
    });

    if (!booking) {
      return NextResponse.json({ error: "رزرو پیدا نشد." }, { status: 404 });
    }

    const payment = await prisma.payment.findFirst({
      where: { id: paymentId, bookingId: booking.id },
    });

    if (!payment) {
      return NextResponse.json({ error: "پرداخت پیدا نشد." }, { status: 404 });
    }

    if (payment.status !== "PENDING") {
      return NextResponse.json(
        { error: "این پرداخت قبلاً بررسی شده است." },
        { status: 409 }
      );
    }

    if (parsed.data.action === "reject") {
      // Atomic: فقط اگر status هنوز PENDING است، reject کن.
      const updateResult = await prisma.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: "REJECTED", rejectedAt: new Date() },
      });

      if (updateResult.count === 0) {
        return NextResponse.json(
          { error: "این پرداخت قبلاً بررسی شده است." },
          { status: 409 }
        );
      }

      // booking را هم کنسل کن تا slot آزاد شود.
      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          paymentStatus: "REJECTED",
        },
      });

      return NextResponse.json({ status: "REJECTED" });
    }

    // Atomic approve.
    const paymentUpdate = await prisma.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: { status: "APPROVED", verifiedAt: new Date() },
    });

    if (paymentUpdate.count === 0) {
      return NextResponse.json(
        { error: "این پرداخت قبلاً بررسی شده است." },
        { status: 409 }
      );
    }

    const remaining = Math.max(
      0,
      Number(booking.finalPrice) - Number(payment.amount)
    );

    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: "CONFIRMED",
        paymentStatus: "PAID",
        depositPaid: payment.amount,
        remainingAmount: remaining,
      },
    });

    return NextResponse.json({ status: "APPROVED" });
  } catch (error) {
    console.error(
      "POST /api/bookings/[id]/payments/[paymentId]/review failed:",
      error
    );
    return NextResponse.json(
      { error: "بررسی پرداخت ناموفق بود." },
      { status: 500 }
    );
  }
}
