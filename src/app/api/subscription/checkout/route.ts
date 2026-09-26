import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getBot } from "@/lib/telegram/bot";
import { PLANS, buildInvoicePayload, isPlanCode } from "@/lib/subscription/plans";

const checkoutSchema = z.object({
  plan: z.string().refine(isPlanCode, "پلن نامعتبر است."),
  businessId: z.string().min(1),
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

    const parsed = checkoutSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "اطلاعات پرداخت نامعتبر است." },
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

    if (business.country === "IR") {
      return NextResponse.json(
        { error: "برای کسب‌وکار ایرانی از مسیر پرداخت کارت‌به‌کارت استفاده کنید." },
        { status: 400 }
      );
    }

    const plan = PLANS[parsed.data.plan as keyof typeof PLANS];
    const bot = getBot();

    const invoiceLink = await bot.api.createInvoiceLink(
      plan.titleFa,
      plan.titleFa,
      buildInvoicePayload(plan.code, user.id),
      "",
      "XTR",
      [{ label: plan.titleFa, amount: plan.starsPrice }]
    );

    return NextResponse.json({ invoiceLink });
  } catch (error) {
    console.error("POST /api/subscription/checkout failed:", error);

    return NextResponse.json(
      { error: "ساخت لینک پرداخت ناموفق بود." },
      { status: 500 }
    );
  }
}
