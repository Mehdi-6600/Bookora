import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { PLANS, isPlanCode } from "@/lib/subscription/plans";

const reviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).nullable().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    const parsed = reviewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "اطلاعات معتبر نیست." },
        { status: 400 }
      );
    }

    const subscription = await prisma.subscription.findUnique({
      where: { id },
    });

    if (!subscription) {
      return NextResponse.json(
        { error: "درخواست پیدا نشد." },
        { status: 404 }
      );
    }

    if (subscription.status !== "PENDING") {
      return NextResponse.json(
        { error: "این درخواست قبلاً بررسی شده است." },
        { status: 409 }
      );
    }

    if (parsed.data.action === "reject") {
      // Atomic compare-and-update برای جلوگیری از race condition.
      const updateResult = await prisma.subscription.updateMany({
        where: { id, status: "PENDING" },
        data: {
          status: "REJECTED",
          reviewedAt: new Date(),
          adminNote: parsed.data.note || null,
        },
      });

      if (updateResult.count === 0) {
        return NextResponse.json(
          { error: "این درخواست قبلاً بررسی شده است." },
          { status: 409 }
        );
      }

      return NextResponse.json({ status: "REJECTED" });
    }

    if (!isPlanCode(subscription.plan)) {
      return NextResponse.json(
        { error: "پلن این درخواست نامعتبر است." },
        { status: 400 }
      );
    }

    const plan = PLANS[subscription.plan];
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000
    );

    // Atomic compare-and-update.
    const updateResult = await prisma.subscription.updateMany({
      where: { id, status: "PENDING" },
      data: {
        status: "ACTIVE",
        startedAt: now,
        expiresAt,
        reviewedAt: now,
        adminNote: parsed.data.note || null,
      },
    });

    if (updateResult.count === 0) {
      return NextResponse.json(
        { error: "این درخواست قبلاً بررسی شده است." },
        { status: 409 }
      );
    }

    return NextResponse.json({
      status: "ACTIVE",
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error("POST /api/admin/subscriptions/[id]/review failed:", error);
    return NextResponse.json(
      { error: "بررسی درخواست ناموفق بود." },
      { status: 500 }
    );
  }
}
