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
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "REJECTED", rejectedAt: new Date() },
      });

      return NextResponse.json({ status: "REJECTED" });
    }

    await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: { status: "APPROVED", verifiedAt: new Date() },
      }),
      prisma.booking.update({
        where: { id: booking.id },
        data: {
          status: "CONFIRMED",
          paymentStatus: "PAID",
          depositPaid: payment.amount,
          remainingAmount: Number(booking.finalPrice) - Number(payment.amount),
        },
      }),
    ]);

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
