import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const receiptSchema = z.object({
  customerPhone: z.string().trim().min(3).max(30),
  transactionReference: z.string().trim().min(3).max(200),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = receiptSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "اطلاعات معتبر نیست." },
        { status: 400 }
      );
    }

    // شماره تلفن به‌عنوان تأیید هویت سبک استفاده می‌شود چون مشتری Login ندارد.
    const booking = await prisma.booking.findFirst({
      where: { id, customerPhone: parsed.data.customerPhone },
    });

    if (!booking) {
      return NextResponse.json(
        { error: "رزرو پیدا نشد یا شماره تلفن اشتباه است." },
        { status: 404 }
      );
    }

    const payment = await prisma.payment.findFirst({
      where: { bookingId: booking.id, type: "DEPOSIT", status: "PENDING" },
    });

    if (!payment) {
      return NextResponse.json(
        { error: "پرداخت در انتظاری برای این رزرو یافت نشد." },
        { status: 404 }
      );
    }

    await prisma.payment.update({
      where: { id: payment.id },
      data: { transactionReference: parsed.data.transactionReference },
    });

    return NextResponse.json({ submitted: true });
  } catch (error) {
    console.error("POST /api/public/bookings/[id]/receipt failed:", error);

    return NextResponse.json(
      { error: "ثبت رسید ناموفق بود." },
      { status: 500 }
    );
  }
}
