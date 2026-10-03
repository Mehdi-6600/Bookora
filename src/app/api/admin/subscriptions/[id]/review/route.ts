import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { PLANS, isPlanCode } from "@/lib/subscription/plans";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { lockUserSubscriptions } from "@/lib/booking/schedule";
import { nextSubscriptionPeriod } from "@/lib/subscription/entitlement";

const reviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).nullable().optional(),
});

class SubscriptionNotFoundError extends Error {}
class ReviewConflictError extends Error {}
class InvalidManualSubscriptionError extends Error {}

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

    if (await isRateLimited(`subscription-review:${user.id}`, 100, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: "Too many requests." },
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

    const parsed = reviewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "اطلاعات معتبر نیست." }, { status: 400 });
    }

    const reference = await prisma.subscription.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!reference) {
      return NextResponse.json({ error: "درخواست پیدا نشد." }, { status: 404 });
    }

    const result = await prisma.$transaction(async (tx) => {
      await lockUserSubscriptions(tx, reference.userId);
      const subscription = await tx.subscription.findUnique({ where: { id } });
      if (!subscription || subscription.userId !== reference.userId) {
        throw new SubscriptionNotFoundError();
      }

      if (subscription.status !== "PENDING") {
        const requestedFinalState =
          parsed.data.action === "approve" ? "ACTIVE" : "REJECTED";
        if (subscription.status === requestedFinalState) {
          return {
            status: subscription.status,
            expiresAt: subscription.expiresAt,
          };
        }
        throw new ReviewConflictError();
      }

      if (subscription.provider !== "MANUAL_IRAN") {
        throw new InvalidManualSubscriptionError();
      }

      if (parsed.data.action === "reject") {
        const now = new Date();
        const updated = await tx.subscription.updateMany({
          where: { id, userId: reference.userId, status: "PENDING" },
          data: {
            status: "REJECTED",
            reviewedAt: now,
            adminNote: parsed.data.note || null,
          },
        });
        if (updated.count !== 1) throw new ReviewConflictError();
        return { status: "REJECTED", expiresAt: null };
      }

      if (!isPlanCode(subscription.plan) || !subscription.receiptReference?.trim()) {
        throw new InvalidManualSubscriptionError();
      }

      const plan = PLANS[subscription.plan];
      const now = new Date();
      const period = await nextSubscriptionPeriod(
        tx,
        subscription.userId,
        plan.durationDays,
        now
      );
      const updated = await tx.subscription.updateMany({
        where: { id, userId: reference.userId, status: "PENDING" },
        data: {
          status: "ACTIVE",
          startedAt: period.startedAt,
          expiresAt: period.expiresAt,
          reviewedAt: now,
          adminNote: parsed.data.note || null,
        },
      });
      if (updated.count !== 1) throw new ReviewConflictError();
      return { status: "ACTIVE", expiresAt: period.expiresAt };
    });

    return NextResponse.json({
      status: result.status,
      ...(result.expiresAt ? { expiresAt: result.expiresAt.toISOString() } : {}),
    });
  } catch (error) {
    if (error instanceof SubscriptionNotFoundError) {
      return NextResponse.json({ error: "درخواست پیدا نشد." }, { status: 404 });
    }
    if (error instanceof ReviewConflictError) {
      return NextResponse.json(
        { error: "این درخواست قبلاً بررسی شده است." },
        { status: 409 }
      );
    }
    if (error instanceof InvalidManualSubscriptionError) {
      return NextResponse.json(
        { error: "درخواست پرداخت یا رسید معتبر نیست." },
        { status: 409 }
      );
    }
    console.error(
      "POST /api/admin/subscriptions/[id]/review failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "بررسی درخواست ناموفق بود." },
      { status: 500 }
    );
  }
}
