import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { getBot } from "@/lib/telegram/bot";
import { PLANS, buildInvoicePayload, isPlanCode } from "@/lib/subscription/plans";

const checkoutSchema = z.object({
  plan: z.string().refine(isPlanCode, "پلن نامعتبر است."),
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
        { error: "پلن نامعتبر است." },
        { status: 400 }
      );
    }

    const plan = PLANS[parsed.data.plan as keyof typeof PLANS];
    const bot = getBot();

    const invoiceLink = await bot.api.createInvoiceLink(
      plan.titleFa,
      plan.titleFa,
      buildInvoicePayload(plan.code, user.id),
      "", // provider_token خالی برای Telegram Stars
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
