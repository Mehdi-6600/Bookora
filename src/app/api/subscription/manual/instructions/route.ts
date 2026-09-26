import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { MANUAL_PAYMENT_SETTING_KEYS } from "@/lib/admin-settings";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const settings = await prisma.adminSetting.findMany({
      where: { key: { in: [...MANUAL_PAYMENT_SETTING_KEYS] } },
    });

    const map = Object.fromEntries(
      settings.map((setting) => [setting.key, setting.value])
    );

    const configured = Boolean(map.payment_card_number);

    return NextResponse.json({
      configured,
      cardNumber: map.payment_card_number || null,
      cardHolder: map.payment_card_holder || null,
      bankName: map.payment_bank_name || null,
      instructions: map.payment_instructions || null,
    });
  } catch (error) {
    console.error("GET /api/subscription/manual/instructions failed:", error);

    return NextResponse.json(
      { error: "خطا در دریافت اطلاعات پرداخت" },
      { status: 500 }
    );
  }
}
