import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { isPlanCode } from "@/lib/subscription/plans";
import {
  isPaymentPreference,
  resolvePaymentMethod,
} from "@/lib/subscription/payment-method";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import {
  lockBusinessSchedule,
  lockPaymentReference,
  lockUserSubscriptions,
} from "@/lib/booking/schedule";
import { normalizePaymentReference } from "@/lib/payment-reference";

const referencePattern = /^[\p{L}\p{N}][\p{L}\p{N} .#/_-]*[\p{L}\p{N}]$/u;
const submitSchema = z.object({
  businessId: z.string().min(1).max(100),
  plan: z.string().refine(isPlanCode, "پلن نامعتبر است."),
  receiptReference: z.string().trim().min(3).max(200).regex(referencePattern),
  note: z.string().trim().max(1000).nullable().optional(),
});

class BusinessNotFoundError extends Error {}
class PaymentMethodUnavailableError extends Error {}
class PendingSubscriptionError extends Error {}
class DuplicateReferenceError extends Error {}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (await isRateLimited(`manual-submit:${user.id}`, 3, 10 * 60 * 1000)) {
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

    const parsed = submitSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "اطلاعات ارسالی معتبر نیست.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const businessRef = await prisma.business.findFirst({
      where: { id: parsed.data.businessId, ownerId: user.id },
      select: { id: true },
    });
    if (!businessRef) {
      return NextResponse.json({ error: "کسب‌وکار پیدا نشد." }, { status: 404 });
    }

    const normalizedReference = normalizePaymentReference(
      parsed.data.receiptReference
    );

    const result = await prisma.$transaction(async (tx) => {
      await lockBusinessSchedule(tx, businessRef.id);
      await lockUserSubscriptions(tx, user.id);
      await lockPaymentReference(tx, normalizedReference);

      const business = await tx.business.findFirst({
        where: { id: businessRef.id, ownerId: user.id },
        select: { id: true, country: true },
      });
      if (!business) throw new BusinessNotFoundError();

      const userRecord = await tx.user.findUnique({
        where: { id: user.id },
        select: { paymentPreference: true },
      });
      const preference =
        userRecord?.paymentPreference &&
        isPaymentPreference(userRecord.paymentPreference)
          ? userRecord.paymentPreference
          : "AUTO";
      if (resolvePaymentMethod(preference, business.country) !== "MANUAL") {
        throw new PaymentMethodUnavailableError();
      }

      const existingPending = await tx.subscription.findFirst({
        where: { userId: user.id, status: "PENDING" },
        select: {
          id: true,
          plan: true,
          businessId: true,
          receiptReference: true,
        },
      });

      if (existingPending) {
        if (
          existingPending.plan === parsed.data.plan &&
          existingPending.businessId === business.id &&
          existingPending.receiptReference &&
          normalizePaymentReference(existingPending.receiptReference) ===
            normalizedReference
        ) {
          return { subscription: existingPending, created: false };
        }
        throw new PendingSubscriptionError();
      }

      const [duplicatePayment, duplicateSubscription] = await Promise.all([
        tx.payment.findFirst({
          where: {
            transactionReference: {
              equals: normalizedReference,
              mode: "insensitive",
            },
          },
          select: { id: true },
        }),
        tx.subscription.findFirst({
          where: {
            receiptReference: {
              equals: normalizedReference,
              mode: "insensitive",
            },
          },
          select: { id: true },
        }),
      ]);
      if (duplicatePayment || duplicateSubscription) {
        throw new DuplicateReferenceError();
      }

      const subscription = await tx.subscription.create({
        data: {
          userId: user.id,
          businessId: business.id,
          plan: parsed.data.plan,
          status: "PENDING",
          provider: "MANUAL_IRAN",
          receiptReference: normalizedReference,
          receiptNote: parsed.data.note || null,
        },
        select: { id: true, plan: true, status: true },
      });
      return { subscription, created: true };
    });

    return NextResponse.json(
      {
        subscription: {
          id: result.subscription.id,
          plan: result.subscription.plan,
          status: "PENDING",
        },
      },
      { status: result.created ? 201 : 200 }
    );
  } catch (error) {
    if (error instanceof BusinessNotFoundError) {
      return NextResponse.json({ error: "کسب‌وکار پیدا نشد." }, { status: 404 });
    }
    if (error instanceof PaymentMethodUnavailableError) {
      return NextResponse.json(
        { error: "روش پرداخت شما روی Telegram Stars تنظیم شده است." },
        { status: 400 }
      );
    }
    if (error instanceof PendingSubscriptionError) {
      return NextResponse.json(
        {
          error:
            "شما یک درخواست در انتظار تأیید دارید. لطفاً منتظر بمانید تا بررسی شود.",
          code: "PENDING_EXISTS",
        },
        { status: 409 }
      );
    }
    if (error instanceof DuplicateReferenceError) {
      return NextResponse.json(
        { error: "این کد پیگیری قبلاً ثبت شده است." },
        { status: 409 }
      );
    }

    console.error(
      "POST /api/subscription/manual/submit failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "ثبت درخواست پرداخت ناموفق بود." },
      { status: 500 }
    );
  }
}
