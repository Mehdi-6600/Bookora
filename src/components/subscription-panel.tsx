"use client";

import { useEffect, useState } from "react";
import { PLANS, PlanCode } from "@/lib/subscription/plans";
import { CountryCode } from "@/lib/currency";

type SubscriptionStatus = {
  plan: string;
  status: string;
  expiresAt: string | null;
} | null;

type PendingSubscription = {
  plan: string;
  status: string;
  createdAt: string;
} | null;

type ManualInstructions = {
  configured: boolean;
  cardNumber: string | null;
  cardHolder: string | null;
  bankName: string | null;
  instructions: string | null;
};

type TelegramWebAppWithInvoice = {
  openInvoice?: (
    url: string,
    callback: (status: "paid" | "cancelled" | "failed" | "pending") => void
  ) => void;
};

function getTelegramWebApp(): TelegramWebAppWithInvoice | undefined {
  return (
    window as unknown as {
      Telegram?: { WebApp?: TelegramWebAppWithInvoice };
    }
  ).Telegram?.WebApp;
}

export function SubscriptionPanel({
  businessId,
  country,
}: {
  businessId: string | null;
  country: CountryCode | null;
}) {
  const [subscription, setSubscription] = useState<SubscriptionStatus>(null);
  const [pending, setPending] = useState<PendingSubscription>(null);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState<PlanCode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [manualPlan, setManualPlan] = useState<PlanCode | null>(null);
  const [manualInfo, setManualInfo] = useState<ManualInstructions | null>(
    null
  );
  const [manualLoading, setManualLoading] = useState(false);
  const [receiptReference, setReceiptReference] = useState("");
  const [receiptNote, setReceiptNote] = useState("");
  const [submittingReceipt, setSubmittingReceipt] = useState(false);

  async function loadStatus() {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/subscription/status", {
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "خطا در دریافت وضعیت اشتراک");
      }

      setSubscription(data.subscription);
      setPending(data.pendingSubscription);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "خطا در دریافت وضعیت اشتراک"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function subscribeWithStars(plan: PlanCode) {
    if (!businessId) return;

    try {
      setCheckingOut(plan);
      setError(null);

      const response = await fetch("/api/subscription/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, businessId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "ساخت لینک پرداخت ناموفق بود.");
      }

      const webApp = getTelegramWebApp();

      if (!webApp?.openInvoice) {
        setError("این بخش فقط داخل تلگرام کار می‌کند.");
        return;
      }

      webApp.openInvoice(data.invoiceLink, (status) => {
        if (status === "paid") {
          loadStatus();
        }
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ساخت لینک پرداخت ناموفق بود."
      );
    } finally {
      setCheckingOut(null);
    }
  }

  async function openManualPayment(plan: PlanCode) {
    setManualPlan(plan);
    setError(null);
    setReceiptReference("");
    setReceiptNote("");

    if (manualInfo) return;

    try {
      setManualLoading(true);

      const response = await fetch("/api/subscription/manual/instructions", {
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "خطا در دریافت اطلاعات پرداخت");
      }

      setManualInfo(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "خطا در دریافت اطلاعات پرداخت"
      );
    } finally {
      setManualLoading(false);
    }
  }

  async function submitReceipt() {
    if (!businessId || !manualPlan) return;

    if (!receiptReference.trim()) {
      setError("کد رهگیری یا شماره تراکنش را وارد کنید.");
      return;
    }

    try {
      setSubmittingReceipt(true);
      setError(null);

      const response = await fetch("/api/subscription/manual/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          plan: manualPlan,
          receiptReference: receiptReference.trim(),
          note: receiptNote.trim() || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "ثبت درخواست ناموفق بود.");
      }

      setManualPlan(null);
      await loadStatus();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ثبت درخواست ناموفق بود."
      );
    } finally {
      setSubmittingReceipt(false);
    }
  }

  if (!businessId || !country) {
    return (
      <section className="space-y-2 rounded-2xl border bg-card p-5 shadow-sm">
        <h2 className="text-xl font-bold">اشتراک</h2>
        <p className="text-sm text-muted-foreground">
          برای خرید اشتراک، اول یک کسب‌وکار بساز.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
      <div>
        <h2 className="text-xl font-bold">اشتراک</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {country === "IR"
            ? "پرداخت کارت‌به‌کارت — بعد از تأیید ادمین فعال می‌شود."
            : "ارتقا حساب با پرداخت Telegram Stars."}
        </p>
      </div>

      {loading && (
        <div className="text-sm text-muted-foreground">
          در حال بررسی وضعیت اشتراک...
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && subscription && (
        <div className="rounded-xl bg-muted p-4 text-sm">
          <p className="font-medium">
            پلن فعال:{" "}
            {PLANS[subscription.plan as PlanCode]?.titleFa || subscription.plan}
          </p>
          {subscription.expiresAt && (
            <p className="mt-1 text-muted-foreground">
              تا تاریخ {new Date(subscription.expiresAt).toLocaleDateString("fa-IR")}
            </p>
          )}
        </div>
      )}

      {!loading && !subscription && pending && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          درخواست پرداخت پلن{" "}
          {PLANS[pending.plan as PlanCode]?.titleFa || pending.plan} ثبت شده و
          در انتظار تأیید ادمین است.
        </div>
      )}

      {!loading && !pending && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Object.values(PLANS).map((plan) => (
            <button
              key={plan.code}
              type="button"
              disabled={checkingOut !== null}
              onClick={() =>
                country === "IR"
                  ? openManualPayment(plan.code)
                  : subscribeWithStars(plan.code)
              }
              className="rounded-xl border bg-background p-4 text-right disabled:opacity-50"
            >
              <div className="font-semibold">{plan.titleFa}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {country === "IR" ? "پرداخت کارت‌به‌کارت" : `${plan.starsPrice} ⭐️`}
              </div>
              <div className="mt-2 text-xs text-primary">
                {checkingOut === plan.code ? "در حال اتصال..." : "انتخاب"}
              </div>
            </button>
          ))}
        </div>
      )}

      {manualPlan && (
        <div className="space-y-3 rounded-xl border p-4">
          <h3 className="font-semibold">
            پرداخت {PLANS[manualPlan].titleFa}
          </h3>

          {manualLoading && (
            <p className="text-sm text-muted-foreground">در حال بارگذاری...</p>
          )}

          {manualInfo && !manualInfo.configured && (
            <p className="text-sm text-destructive">
              اطلاعات پرداخت هنوز توسط ادمین تنظیم نشده است.
            </p>
          )}

          {manualInfo && manualInfo.configured && (
            <div className="space-y-1 rounded-lg bg-muted p-3 text-sm">
              <p>شماره کارت: {manualInfo.cardNumber}</p>
              {manualInfo.cardHolder && (
                <p>به نام: {manualInfo.cardHolder}</p>
              )}
              {manualInfo.bankName && <p>بانک: {manualInfo.bankName}</p>}
              {manualInfo.instructions && (
                <p className="text-muted-foreground">
                  {manualInfo.instructions}
                </p>
              )}
            </div>
          )}

          <input
            value={receiptReference}
            onChange={(event) => setReceiptReference(event.target.value)}
            placeholder="کد رهگیری یا شماره تراکنش"
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none"
          />

          <textarea
            value={receiptNote}
            onChange={(event) => setReceiptNote(event.target.value)}
            placeholder="توضیح اضافی (اختیاری)"
            className="min-h-16 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none"
          />

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={submitReceipt}
              disabled={submittingReceipt}
              className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {submittingReceipt ? "در حال ثبت..." : "ثبت پرداخت"}
            </button>

            <button
              type="button"
              onClick={() => setManualPlan(null)}
              className="rounded-lg border px-3 py-2 text-sm font-medium"
            >
              انصراف
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
