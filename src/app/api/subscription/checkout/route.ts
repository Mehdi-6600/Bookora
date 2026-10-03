import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getBot } from "@/lib/telegram/bot";
import {
  PLANS,
  buildInvoicePayload,
  isPlanCode,
} from "@/lib/subscription/plans";
import {
  isPaymentPreference,
  resolvePaymentMethod,
} from "@/lib/subscription/payment-method";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";

const checkoutSchema = z.object({
  plan: z.string().refine(isPlanCode, "پلن نامعتبر است."),
  businessId: z.string().min(1).max(100),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (await isRateLimited(`checkout:${user.id}`, 5, 60 * 1000)) {
      return NextResponse.json(
        { error: "درخواست‌های زیاد. کمی صبر کنید." },
        { status: 429 }
      );
    }

    triggerRateLimitCleanup();

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

    const userRecord = await prisma.user.findUnique({
      where: { id: user.id },
      select: { paymentPreference: true },
    });
    const preference =
      userRecord?.paymentPreference &&
      isPaymentPreference(userRecord.paymentPreference)
        ? userRecord.paymentPreference
        : "AUTO";
    const method = resolvePaymentMethod(preference, business.country);

    if (method !== "STARS") {
      return NextResponse.json(
        { error: "روش پرداخت شما روی کارت‌به‌کارت تنظیم شده است." },
        { status: 400 }
      );
    }

    const plan = PLANS[parsed.data.plan as keyof typeof PLANS];

    let bot;
    try {
      bot = getBot();
    } catch (botError) {
      console.error(
        "POST /api/subscription/checkout: getBot failed",
        botError
      );
      return NextResponse.json(
        { error: "ربات تلگرام در دسترس نیست." },
        { status: 500 }
      );
    }

    if (!bot) {
      console.error("POST /api/subscription/checkout: bot is undefined");
      return NextResponse.json(
        { error: "ربات تلگرام در دسترس نیست." },
        { status: 500 }
      );
    }

    let invoiceLink: string;
    try {
      invoiceLink = await bot.api.createInvoiceLink(
        plan.titleEn,
        plan.titleEn,
        buildInvoicePayload(plan.code, user.id),
        "",
        "XTR",
        [{ label: plan.titleEn, amount: plan.starsPrice }]
      );
    } catch (invoiceError) {
      console.error(
        "POST /api/subscription/checkout: createInvoiceLink failed",
        {
          plan: plan.code,
          starsPrice: plan.starsPrice,
          userId: user.id,
          error: invoiceError,
        }
      );
      return NextResponse.json(
        { error: "ساخت لینک پرداخت ناموفق بود." },
        { status: 500 }
      );
    }

    if (!invoiceLink || typeof invoiceLink !== "string") {
      console.error(
        "POST /api/subscription/checkout: invoiceLink is empty or invalid",
        { plan: plan.code, userId: user.id }
      );
      return NextResponse.json(
        { error: "ساخت لینک پرداخت ناموفق بود." },
        { status: 500 }
      );
    }

    return NextResponse.json({ invoiceLink });
  } catch (error) {
    console.error("POST /api/subscription/checkout failed:", error);
    return NextResponse.json(
      { error: "ساخت لینک پرداخت ناموفق بود." },
      { status: 500 }
    );
  }
}
