import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { isPaymentPreference } from "@/lib/subscription/payment-method";

const updateSchema = z.object({
  preference: z.string().refine(isPaymentPreference, "روش پرداخت نامعتبر است."),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const record = await prisma.user.findUnique({
    where: { id: user.id },
    select: { paymentPreference: true },
  });

  return NextResponse.json({ preference: record?.paymentPreference || "AUTO" });
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "روش پرداخت نامعتبر است." }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { paymentPreference: parsed.data.preference },
  });

  return NextResponse.json({ preference: parsed.data.preference });
}
