import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import {
  InvalidManualSubscriptionError,
  ReviewConflictError,
  SubscriptionNotFoundError,
  reviewManualSubscription,
} from "@/lib/subscription/manual-review";

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

    const reviewerName = user.firstName
      ? `${user.firstName} ${user.lastName ?? ""}`.trim()
      : user.username
      ? `@${user.username}`
      : "مدیر وب";

    const result = await reviewManualSubscription({
      subscriptionId: id,
      action: parsed.data.action,
      note: parsed.data.note,
      reviewerName,
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
