import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  MANUAL_PAYMENT_SETTING_KEYS,
  isManualPaymentSettingKey,
} from "@/lib/admin-settings";

const updateSchema = z.object({
  settings: z
    .array(
      z.object({
        key: z.string().refine(isManualPaymentSettingKey, "کلید نامعتبر است."),
        value: z.string().trim().max(500),
      })
    )
    .min(1),
});

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user || !user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const settings = await prisma.adminSetting.findMany({
      where: { key: { in: [...MANUAL_PAYMENT_SETTING_KEYS] } },
    });

    const map = Object.fromEntries(
      settings.map((setting) => [setting.key, setting.value])
    );

    return NextResponse.json({
      settings: MANUAL_PAYMENT_SETTING_KEYS.map((key) => ({
        key,
        value: map[key] || "",
      })),
    });
  } catch (error) {
    console.error("GET /api/admin/settings failed:", error);

    return NextResponse.json(
      { error: "خطا در دریافت تنظیمات" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user || !user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = updateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "اطلاعات معتبر نیست." },
        { status: 400 }
      );
    }

    await prisma.$transaction(
      parsed.data.settings.map((setting) =>
        prisma.adminSetting.upsert({
          where: { key: setting.key },
          update: { value: setting.value },
          create: { key: setting.key, value: setting.value },
        })
      )
    );

    return NextResponse.json({ saved: true });
  } catch (error) {
    console.error("PUT /api/admin/settings failed:", error);

    return NextResponse.json(
      { error: "ذخیره تنظیمات ناموفق بود." },
      { status: 500 }
    );
  }
}
