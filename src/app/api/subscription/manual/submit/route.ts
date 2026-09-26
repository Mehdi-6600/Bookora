import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { isPlanCode } from "@/lib/subscription/plans";

const submitSchema = z.object({
  businessId: z.string().min(1),
  plan: z.string().refine(isPlanCode, "پلن نامعتبر است."),
  receiptReference: z.string().trim().min(3).max(200),
  note: z.string().trim().max(1000).nullable().optional(),
});

export async function POST(req: NextRequest) {
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

    const parsed = submitSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "اطلاعات ارسالی معتبر نیست.",
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const business = await prisma.business.findFirst({
      where: { id: parsed.data.businessId, ownerId: user.id },
      select: { id: true, country: true },
    });

    if (!business) {
      return NextResponse.json(
        { error: "کسب‌وکار پیدا نشد." },
        { status: 404 }
      );
    }

    if (business.country !== "IR") {
      return NextResponse.json(
        { error: "این مسیر فقط برای کسب‌وکار ایرانی است." },
        { status: 400 }
      );
    }

    const subscription = await prisma.subscription.create({
      data: {
        userId: user.id,
        businessId: business.id,
        plan: parsed.data.plan,
        status: "PENDING",
        provider: "MANUAL_IRAN",
        receiptReference: parsed.data.receiptReference,
        receiptNote: parsed.data.note || null,
      },
    });

    return NextResponse.json(
      {
        subscription: {
          id: subscription.id,
          plan: subscription.plan,
          status: subscription.status,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/subscription/manual/submit failed:", error);

    return NextResponse.json(
      { error: "ثبت درخواست پرداخت ناموفق بود." },
      { status: 500 }
    );
  }
}
