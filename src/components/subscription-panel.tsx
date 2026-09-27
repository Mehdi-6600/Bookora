"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { PLANS, PlanCode } from "@/lib/subscription/plans";

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
  country: string | null;
}) {
  const t = useTranslations("subscription");
  const locale = useLocale();

  // تصمیم روش پرداخت بر اساس کشور واقعی کسب‌وکار است، نه زبان نمایش —
  // چون این یک محدودیت واقعی مالی/قانونی است، نه صرفاً یک ترجیح زبانی.
  const useManualPayment = country === "IR";

  const planLabels: Record<PlanCode, string> = {
    PRO_MONTHLY: t("planMonthly"),
    PRO_YEARLY: t("planYearly"),
  };

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
        throw new Error(data?.error || t("loadError"));
      }

      setSubscription(data.subscription);
      setPending(data.pendingSubscription);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadError"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        throw new Error(data?.error || t("checkoutError"));
      }

      const webApp = getTelegramWebApp();

      if (!webApp?.openInvoice) {
        setError(t("telegramOnly"));
        return;
      }

      webApp.openInvoice(data.invoiceLink, (status) => {
        if (status === "paid") {
          loadStatus();
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("checkoutError"));
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
        throw new Error(data?.error || t("loadError"));
      }

      setManualInfo(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadError"));
    } finally {
      setManualLoading(false);
    }
  }

  async function submitReceipt() {
    if (!businessId || !manualPlan) return;

    if (!receiptReference.trim()) {
      setError(t("receiptRequired"));
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
        throw new Error(data?.error || t("submitError"));
      }

      setManualPlan(null);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("submitError"));
    } finally {
      setSubmittingReceipt(false);
    }
  }

  if (!businessId || !country) {
    return (
      <section className="space-y-2 rounded-2xl border bg-card p-5 shadow-sm">
        <h2 className="text-xl font-bold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("needBusiness")}</p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
      <div>
        <h2 className="text-xl font-bold">{t("title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {useManualPayment ? t("subtitleIR") : t("subtitleOther")}
        </p>
      </div>

      {loading && (
        <div className="text-sm text-muted-foreground">
          {t("checkingStatus")}
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
            {t("activePlan", {
              plan: planLabels[subscription.plan as PlanCode] || subscription.plan,
            })}
          </p>
          {subscription.expiresAt && (
            <p className="mt-1 text-muted-foreground">
              {t("expiresAt", {
                date: new Date(subscription.expiresAt).toLocaleDateString(
                  locale
                ),
              })}
            </p>
          )}
        </div>
      )}

      {!loading && !subscription && pending && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          {t("pendingNotice", {
            plan: planLabels[pending.plan as PlanCode] || pending.plan,
          })}
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
                useManualPayment
                  ? openManualPayment(plan.code)
                  : subscribeWithStars(plan.code)
              }
              className="rounded-xl border bg-background p-4 text-right disabled:opacity-50"
            >
              <div className="font-semibold">{planLabels[plan.code]}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {useManualPayment
                  ? t("manualPayment")
                  : t("starsPayment", { stars: plan.starsPrice })}
              </div>
              <div className="mt-2 text-xs text-primary">
                {checkingOut === plan.code ? t("connecting") : t("selectButton")}
              </div>
            </button>
          ))}
        </div>
      )}

      {manualPlan && (
        <div className="space-y-3 rounded-xl border p-4">
          <h3 className="font-semibold">
            {t("manualPaymentTitle", { plan: planLabels[manualPlan] })}
          </h3>

          {manualLoading && (
            <p className="text-sm text-muted-foreground">
              {t("manualLoading")}
            </p>
          )}

          {manualInfo && !manualInfo.configured && (
            <p className="text-sm text-destructive">
              {t("manualNotConfigured")}
            </p>
          )}

          {manualInfo && manualInfo.configured && (
            <div className="space-y-1 rounded-lg bg-muted p-3 text-sm">
              <p>{t("cardNumber", { value: manualInfo.cardNumber })}</p>
              {manualInfo.cardHolder && (
                <p>{t("accountHolder", { value: manualInfo.cardHolder })}</p>
              )}
              {manualInfo.bankName && (
                <p>{t("bankName", { value: manualInfo.bankName })}</p>
              )}
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
            placeholder={t("receiptPlaceholder")}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none"
          />

          <textarea
            value={receiptNote}
            onChange={(event) => setReceiptNote(event.target.value)}
            placeholder={t("notePlaceholder")}
            className="min-h-16 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none"
          />

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={submitReceipt}
              disabled={submittingReceipt}
              className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {submittingReceipt ? t("submitting") : t("submitButton")}
            </button>

            <button
              type="button"
              onClick={() => setManualPlan(null)}
              className="rounded-lg border px-3 py-2 text-sm font-medium"
            >
              {t("cancelButton")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
