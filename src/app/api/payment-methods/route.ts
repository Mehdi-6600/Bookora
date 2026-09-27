import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";

const upsertSchema = z.object({
  businessId: z.string().min(1),
  accountHolder: z.string().trim().max(120).nullable().optional(),
  bankName: z.string().trim().max(120).nullable().optional(),
  cardNumber: z.string().trim().max(40).nullable().optional(),
  instructions: z.string().trim().max(500).nullable().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const businessId = req.nextUrl.searchParams.get("businessId");

    if (!businessId) {
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

    const method = await prisma.paymentMethod.findFirst({
      where: { businessId: business.id },
    });

    return NextResponse.json({
      paymentMethod: method
        ? {
            id: method.id,
            accountHolder: method.accountHolder,
            bankName: method.bankName,
            cardNumber: method.cardNumber,
            instructions: method.instructions,
          }
        : null,
    });
  } catch (error) {
    console.error("GET /api/payment-methods failed:", error);

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
      return NextResponse.json(
        { error: "کسب‌وکار پیدا نشد." },
        { status: 404 }
      );
    }

    const existing = await prisma.paymentMethod.findFirst({
      where: { businessId: business.id },
    });

    const method = existing
      ? await prisma.paymentMethod.update({
          where: { id: existing.id },
          data: {
            accountHolder: accountHolder || null,
            bankName: bankName || null,
            cardNumber: cardNumber || null,
            instructions: instructions || null,
          },
        })
      : await prisma.paymentMethod.create({
          data: {
            businessId: business.id,
            type: "MANUAL",
            accountHolder: accountHolder || null,
            bankName: bankName || null,
            cardNumber: cardNumber || null,
            instructions: instructions || null,
          },
        });

    return NextResponse.json({
      paymentMethod: {
        id: method.id,
        accountHolder: method.accountHolder,
        bankName: method.bankName,
        cardNumber: method.cardNumber,
        instructions: method.instructions,
      },
    });
  } catch (error) {
    console.error("PUT /api/payment-methods failed:", error);

    return NextResponse.json(
      { error: "ذخیره روش پرداخت ناموفق بود." },
      { status: 500 }
    );
  }
}
