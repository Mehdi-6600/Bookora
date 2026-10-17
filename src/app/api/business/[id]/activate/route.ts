import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { activePaidSubscriptionWhere } from "@/lib/subscription/entitlement";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { lockBusinessSchedule } from "@/lib/booking/schedule";
import {
  canActivateBusiness,
  isBusinessPubliclyActive,
} from "@/lib/business/lifecycle";

class BusinessNotFoundError extends Error {}
class BusinessNotReadyError extends Error {
  constructor(public readonly missingReason?: "BOTH" | "SERVICES" | "HOURS") {
    super();
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (await isRateLimited(`business-activate:${user.id}`, 20, 10 * 60 * 1000)) {
      return NextResponse.json(
        { error: "درخواست‌های زیاد. کمی صبر کنید." },
        { status: 429 }
      );
    }
    triggerRateLimitCleanup();

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      await lockBusinessSchedule(tx, id);

      const business = await tx.business.findFirst({
        where: { id, ownerId: user.id, deletedAt: null },
        select: {
          id: true,
          status: true,
          expiresAt: true,
          setupCompletedAt: true,
        },
      });
      if (!business) throw new BusinessNotFoundError();

      if (isBusinessPubliclyActive(business, now)) {
        return { activated: true, alreadyActive: true, expiresAt: business.expiresAt };
      }
      if (!canActivateBusiness(business, now)) {
        throw new BusinessNotReadyError();
      }

      const [activeServices, enabledDays] = await Promise.all([
        tx.service.count({ where: { businessId: business.id, active: true } }),
        tx.workingHour.count({ where: { businessId: business.id, enabled: true } }),
      ]);
      if (activeServices < 1 || enabledDays < 1) {
        throw new BusinessNotReadyError(
          activeServices < 1 && enabledDays < 1
            ? "BOTH"
            : activeServices < 1
            ? "SERVICES"
            : "HOURS"
        );
      }

      if (!business.setupCompletedAt) {
        const setupMarked = await tx.business.updateMany({
          where: {
            id: business.id,
            ownerId: user.id,
            deletedAt: null,
            status: { in: ["DRAFT", "EXPIRED", "ACTIVE"] },
            setupCompletedAt: null,
          },
          data: { setupCompletedAt: now },
        });
        if (setupMarked.count !== 1) throw new BusinessNotReadyError();
      }

      const subscription = await tx.subscription.findFirst({
        where: activePaidSubscriptionWhere(user.id, now, business.id),
        orderBy: { createdAt: "desc" },
        select: { id: true, expiresAt: true },
      });
      if (!subscription) {
        return { activated: false, requiresSubscription: true };
      }

      const updated = await tx.business.updateMany({
        where: {
          id: business.id,
          ownerId: user.id,
          deletedAt: null,
          status: { in: ["DRAFT", "EXPIRED", "ACTIVE"] },
        },
        data: {
          status: "ACTIVE",
          expiresAt: subscription.expiresAt,
        },
      });
      if (updated.count !== 1) throw new BusinessNotReadyError();

      return {
        activated: true,
        alreadyActive: false,
        expiresAt: subscription.expiresAt,
      };
    });

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof BusinessNotFoundError) {
      return NextResponse.json({ error: "کسب‌وکار پیدا نشد." }, { status: 404 });
    }
    if (error instanceof BusinessNotReadyError) {
      const errorMessage =
        error.missingReason === "HOURS"
          ? "ابتدا دست‌کم یک روز کاری فعال ثبت کنید."
          : error.missingReason === "SERVICES"
          ? "ابتدا دست‌کم یک سرویس فعال ثبت کنید."
          : "ابتدا دست‌کم یک سرویس فعال و یک روز کاری فعال ثبت کنید.";
      return NextResponse.json(
        {
          error: errorMessage,
          code: "BUSINESS_NOT_READY",
        },
        { status: 409 }
      );
    }
    console.error(
      "POST /api/business/[id]/activate failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "فعال‌سازی کسب‌وکار ناموفق بود." },
      { status: 500 }
    );
  }
}
