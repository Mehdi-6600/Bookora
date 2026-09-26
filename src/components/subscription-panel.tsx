"use client";

import { useEffect, useState } from "react";
import { PLANS, PlanCode } from "@/lib/subscription/plans";

type SubscriptionStatus = {
  plan: string;
  status: string;
  expiresAt: string | null;
} | null;

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

export function SubscriptionPanel() {
  const [subscription, setSubscription] = useState<SubscriptionStatus>(null);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState<PlanCode | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  async function subscribe(plan: PlanCode) {
    try {
      setCheckingOut(plan);
      setError(null);

      const response = await fetch("/api/subscription/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
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

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
      <div>
        <h2 className="text-xl font-bold">اشتراک</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          ارتقا حساب با پرداخت Telegram Stars.
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
            پلن فعال: {PLANS[subscription.plan as PlanCode]?.titleFa || subscription.plan}
          </p>
          {subscription.expiresAt && (
            <p className="mt-1 text-muted-foreground">
              تا تاریخ {new Date(subscription.expiresAt).toLocaleDateString("fa-IR")}
            </p>
          )}
        </div>
      )}

      {!loading && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Object.values(PLANS).map((plan) => (
            <button
              key={plan.code}
              type="button"
              disabled={checkingOut !== null}
              onClick={() => subscribe(plan.code)}
              className="rounded-xl border bg-background p-4 text-right disabled:opacity-50"
            >
              <div className="font-semibold">{plan.titleFa}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {plan.starsPrice} ⭐️
              </div>
              <div className="mt-2 text-xs text-primary">
                {checkingOut === plan.code ? "در حال اتصال..." : "خرید"}
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
