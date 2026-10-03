import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { lockBusinessSchedule } from "@/lib/booking/schedule";

const upsertSchema = z.object({
  businessId: z.string().min(1).max(100),
  accountHolder: z.string().trim().max(120).nullable().optional(),
  bankName: z.string().trim().max(120).nullable().optional(),
  cardNumber: z.string().trim().max(40).nullable().optional(),
  instructions: z.string().trim().max(500).nullable().optional(),
});

class BusinessNotFoundError extends Error {}

function serializePaymentMethod(method: {
  id: string;
  accountHolder: string | null;
  bankName: string | null;
  cardNumber: string | null;
  instructions: string | null;
}) {
  return {
    id: method.id,
    accountHolder: method.accountHolder,
    bankName: method.bankName,
    cardNumber: method.cardNumber,
    instructions: method.instructions,
  };
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const businessId = req.nextUrl.searchParams.get("businessId");
    if (!businessId || businessId.length > 100) {
      return NextResponse.json({ error: "businessId لازم است." }, { status: 400 });
    }

    const business = await prisma.business.findFirst({
      where: { id: businessId, ownerId: user.id },
      select: { id: true },
    });
    if (!business) {
      return NextResponse.json({ error: "کسب‌وکار پیدا نشد." }, { status: 404 });
    }

    const method = await prisma.paymentMethod.findFirst({
      where: { businessId: business.id },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      paymentMethod: method ? serializePaymentMethod(method) : null,
    });
  } catch (error) {
    console.error(
      "GET /api/payment-methods failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "خطا در دریافت روش پرداخت" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
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

    const parsed = upsertSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "اطلاعات معتبر نیست." },
        { status: 400 }
      );
    }

    const { businessId, accountHolder, bankName, cardNumber, instructions } =
      parsed.data;
    const business = await prisma.business.findFirst({
      where: { id: businessId, ownerId: user.id },
      select: { id: true },
    });
    if (!business) {
      return NextResponse.json({ error: "کسب‌وکار پیدا نشد." }, { status: 404 });
    }

    if (
      await isRateLimited(`payment-method:${user.id}:${business.id}`, 30, 10 * 60 * 1000)
    ) {
      return NextResponse.json(
        { error: "درخواست‌های زیاد. کمی صبر کنید." },
        { status: 429 }
      );
    }
    triggerRateLimitCleanup();

    const method = await prisma.$transaction(async (tx) => {
      await lockBusinessSchedule(tx, business.id);
      const ownedBusiness = await tx.business.findFirst({
        where: { id: business.id, ownerId: user.id },
        select: { id: true },
      });
      if (!ownedBusiness) throw new BusinessNotFoundError();

      const existing = await tx.paymentMethod.findFirst({
        where: { businessId: ownedBusiness.id },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });

      const data = {
        accountHolder: accountHolder || null,
        bankName: bankName || null,
        cardNumber: cardNumber || null,
        instructions: instructions || null,
      };

      return existing
        ? tx.paymentMethod.update({ where: { id: existing.id }, data })
        : tx.paymentMethod.create({
            data: { businessId: ownedBusiness.id, type: "MANUAL", ...data },
          });
    });

    return NextResponse.json({ paymentMethod: serializePaymentMethod(method) });
  } catch (error) {
    if (error instanceof BusinessNotFoundError) {
      return NextResponse.json({ error: "کسب‌وکار پیدا نشد." }, { status: 404 });
    }
    console.error(
      "PUT /api/payment-methods failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "ذخیره روش پرداخت ناموفق بود." },
      { status: 500 }
    );
  }
}
