import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  reviewManualSubscription,
  notifyAdminsNewManualSubscription,
  isTelegramUserAdmin,
  SubscriptionNotFoundError,
  ReviewConflictError,
  InvalidManualSubscriptionError,
} from "@/lib/subscription/manual-review";

const state = {
  users: [] as any[],
  businesses: [] as any[],
  subscriptions: [] as any[],
  services: [] as any[],
  workingHours: [] as any[],
  sentMessages: [] as any[],
  paidConversions: [] as Array<{ userId: string; businessId: string | null }>,
};

vi.mock("@/lib/env", () => ({
  env: {
    APP_URL: "https://bookora.app",
    TELEGRAM_BOT_TOKEN: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
  },
  getAdminTelegramConfig: vi.fn(() => ({
    configured: true,
    ids: [BigInt(999001)],
  })),
}));

vi.mock("@/lib/telegram/notify", () => ({
  notifyUser: vi.fn(async (telegramId: string, text: string, options?: any) => {
    state.sentMessages.push({ telegramId, text, options });
  }),
}));

vi.mock("@/lib/booking/schedule", () => ({
  lockBusinessSchedule: vi.fn().mockResolvedValue(undefined),
  lockUserSubscriptions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/outreach/attribution", () => ({
  markPaidConversion: vi.fn(async (userId: string, businessId: string | null) => {
    state.paidConversions.push({ userId, businessId });
  }),
}));

vi.mock("@/lib/prisma", () => {
  const prismaMock = {
    user: {
      findUnique: vi.fn(async ({ where }: any) => {
        return (
          state.users.find(
            (u) =>
              (where.id && u.id === where.id) ||
              (where.telegramId && u.telegramId === where.telegramId)
          ) ?? null
        );
      }),
      findMany: vi.fn(async ({ where }: any) => {
        if (where?.isAdmin) {
          return state.users.filter((u) => u.isAdmin);
        }
        return state.users;
      }),
    },
    business: {
      findUnique: vi.fn(async ({ where }: any) => {
        return state.businesses.find((b) => b.id === where.id) ?? null;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        return (
          state.businesses.find(
            (b) =>
              b.id === where.id &&
              (!where.ownerId || b.ownerId === where.ownerId) &&
              b.deletedAt === null
          ) ?? null
        );
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const b of state.businesses) {
          if (b.id === where.id) {
            Object.assign(b, data);
            count++;
          }
        }
        return { count };
      }),
    },
    service: {
      count: vi.fn(async ({ where }: any) => {
        return state.services.filter(
          (s) => s.businessId === where.businessId && s.active === where.active
        ).length;
      }),
    },
    workingHour: {
      count: vi.fn(async ({ where }: any) => {
        return state.workingHours.filter(
          (w) => w.businessId === where.businessId && w.enabled === where.enabled
        ).length;
      }),
    },
    subscription: {
      findUnique: vi.fn(async ({ where }: any) => {
        return state.subscriptions.find((s) => s.id === where.id) ?? null;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return state.subscriptions.filter((s) => {
          if (where.userId && s.userId !== where.userId) return false;
          if (where.businessId && s.businessId !== where.businessId)
            return false;
          if (where.status && s.status !== where.status) return false;
          return true;
        });
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const s of state.subscriptions) {
          if (
            s.id === where.id &&
            s.userId === where.userId &&
            s.status === where.status
          ) {
            Object.assign(s, data);
            count++;
          }
        }
        return { count };
      }),
    },
    $transaction: vi.fn(async (callback: any) => {
      return callback(prismaMock);
    }),
  };

  return { prisma: prismaMock };
});

describe("manual-review subscription service", () => {
  beforeEach(() => {
    state.users = [
      {
        id: "buyer-1",
        telegramId: "111001",
        firstName: "علی",
        lastName: "محمدی",
        telegramUsername: "ali_m",
        isAdmin: false,
      },
      {
        id: "admin-db",
        telegramId: "999002",
        firstName: "مدیر",
        lastName: "سیستم",
        telegramUsername: "admin_user",
        isAdmin: true,
      },
    ];

    state.businesses = [
      {
        id: "biz-1",
        ownerId: "buyer-1",
        name: "سالن زیبایی نگین",
        slug: "negin-salon",
        status: "DRAFT",
        setupCompletedAt: new Date("2026-10-01T10:00:00Z"),
        deletedAt: null,
      },
    ];

    state.services = [
      { id: "svc-1", businessId: "biz-1", name: "کاشت مژه", active: true },
    ];

    state.workingHours = [
      { id: "wh-1", businessId: "biz-1", dayOfWeek: 1, enabled: true },
    ];

    state.subscriptions = [
      {
        id: "sub-1",
        userId: "buyer-1",
        businessId: "biz-1",
        plan: "PRO_MONTHLY",
        status: "PENDING",
        provider: "MANUAL_IRAN",
        receiptReference: "REC-123456",
        receiptNote: "واریز از بانک ملت",
        createdAt: new Date("2026-10-15T12:00:00Z"),
      },
    ];

    state.sentMessages = [];
    state.paidConversions = [];
  });

  it("checks admin authorization correctly via env and db", async () => {
    expect(await isTelegramUserAdmin("999001")).toBe(true); // from env
    expect(await isTelegramUserAdmin("999002")).toBe(true); // from db
    expect(await isTelegramUserAdmin("111001")).toBe(false); // regular user
  });

  it("notifies admins when a new manual subscription is submitted", async () => {
    await notifyAdminsNewManualSubscription({
      subscriptionId: "sub-1",
      userId: "buyer-1",
      businessId: "biz-1",
      plan: "PRO_MONTHLY",
      receiptReference: "REC-123456",
      receiptNote: "واریز از بانک ملت",
    });

    expect(state.sentMessages.length).toBeGreaterThanOrEqual(1);
    const adminMsg = state.sentMessages.find((m) => m.telegramId === "999001");
    expect(adminMsg).toBeDefined();
    expect(adminMsg.text).toContain("درخواست جدید خرید اشتراک");
    expect(adminMsg.text).toContain("علی محمدی");
    expect(adminMsg.text).toContain("REC-123456");
    expect(adminMsg.text).toContain("سالن زیبایی نگین");
    expect(adminMsg.options?.replyMarkup).toBeDefined();
  });

  it("approves a subscription, activates the business, and notifies the buyer", async () => {
    const result = await reviewManualSubscription({
      subscriptionId: "sub-1",
      action: "approve",
      note: "تایید شده",
      reviewerName: "مدیر",
    });

    expect(result.status).toBe("ACTIVE");
    expect(result.expiresAt).toBeDefined();
    expect(state.paidConversions).toEqual([{ userId: "buyer-1", businessId: "biz-1" }]);

    // Verify DB update
    const updatedSub = state.subscriptions.find((s) => s.id === "sub-1");
    expect(updatedSub.status).toBe("ACTIVE");
    expect(updatedSub.adminNote).toBe("تایید شده");

    const updatedBiz = state.businesses.find((b) => b.id === "biz-1");
    expect(updatedBiz.status).toBe("ACTIVE");

    // Verify buyer notification
    const buyerMsg = state.sentMessages.find((m) => m.telegramId === "111001");
    expect(buyerMsg).toBeDefined();
    expect(buyerMsg.text).toContain("اشتراک شما با موفقیت تأیید شد");
    expect(buyerMsg.text).toContain("سالن زیبایی نگین");
    expect(buyerMsg.options?.replyMarkup).toBeDefined();
  });

  it("rejects a subscription and notifies the buyer with the rejection reason", async () => {
    const result = await reviewManualSubscription({
      subscriptionId: "sub-1",
      action: "reject",
      note: "شماره پیگیری در صورت‌حساب بانکی یافت نشد",
      reviewerName: "مدیر",
    });

    expect(result.status).toBe("REJECTED");
    expect(result.expiresAt).toBeNull();

    // Verify DB update
    const updatedSub = state.subscriptions.find((s) => s.id === "sub-1");
    expect(updatedSub.status).toBe("REJECTED");
    expect(updatedSub.adminNote).toBe("شماره پیگیری در صورت‌حساب بانکی یافت نشد");

    // Verify buyer notification contains the rejection reason and tracking code
    const buyerMsg = state.sentMessages.find((m) => m.telegramId === "111001");
    expect(buyerMsg).toBeDefined();
    expect(buyerMsg.text).toContain("درخواست خرید اشتراک تأیید نشد");
    expect(buyerMsg.text).toContain("شماره پیگیری در صورت‌حساب بانکی یافت نشد");
    expect(buyerMsg.text).toContain("REC-123456");
    expect(buyerMsg.options?.replyMarkup).toBeDefined();
  });

  it("prevents double-review when subscription is already decided", async () => {
    state.subscriptions[0].status = "ACTIVE";

    // Re-approving returns alreadyReviewed
    const result = await reviewManualSubscription({
      subscriptionId: "sub-1",
      action: "approve",
    });
    expect(result.alreadyReviewed).toBe(true);
    expect(state.paidConversions).toHaveLength(0);

    // Trying to reject an ACTIVE subscription throws ReviewConflictError
    await expect(
      reviewManualSubscription({
        subscriptionId: "sub-1",
        action: "reject",
      })
    ).rejects.toThrow(ReviewConflictError);
  });
});
