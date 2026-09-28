"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  CalendarDays,
  Check,
  Clock,
  CreditCard,
  Crown,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { PLANS } from "@/lib/subscription/plans";
import type { PlanCode } from "@/lib/subscription/plans";
import {
  isPaymentPreference,
  resolvePaymentMethod,
} from "@/lib/subscription/payment-method";
import type { PaymentPreference } from "@/lib/subscription/payment-method";

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

const PREFERENCE_OPTIONS: { value: PaymentPreference; labelKey: string }[] = [
  { value: "AUTO", labelKey: "preferenceAuto" },
  { value: "MANUAL", labelKey: "preferenceManual" },
  { value: "STARS", labelKey: "preferenceStars" },
];

function getTelegramWebApp(): TelegramWebAppWithInvoice | undefined {
  return (
    window as unknown as {
      Telegram?: { WebApp?: TelegramWebAppWithInvoice };
    }
  ).Telegram?.WebApp;
}

function formatToman(value: number, locale: string): string {
  const numberingLocale =
    locale === "fa" ? "fa-IR" : locale === "ar" ? "ar-EG" : "en-US";
  return new Intl.NumberFormat(numberingLocale).format(value);
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

  const [subscription, setSubscription] = useState<SubscriptionStatus>(null);
  const [pending, setPending] = useState<PendingSubscription>(null);
  const [preference, setPreference] = useState<PaymentPreference | null>(
    null
  );
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

  const [savingPreference, setSavingPreference] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState(false);

  // روش پرداخت مؤثر دقیقاً با منطق backend یکی است:
  // src/lib/subscription/payment-method.ts — کپی نمی‌شود، import می‌شود.
  const effectiveMethod = resolvePaymentMethod(preference ?? "AUTO", country);

  const planLabels: Record<PlanCode, string> = {
    PRO_MONTHLY: t("planMonthly"),
    PRO_YEARLY: t("planYearly"),
  };

  async function loadStatus() {
    try {
      setLoading(true);
      setError(null);

      const [statusResponse, preferenceResponse] = await Promise.all([
        fetch("/api/subscription/status", { cache: "no-store" }),
        fetch("/api/subscription/payment-preference", { cache: "no-store" }),
      ]);

      const statusData = await statusResponse.json();

      if (!statusResponse.ok) {
        throw new Error(statusData?.error || t("loadError"));
      }

      setSubscription(statusData.subscription);
      setPending(statusData.pendingSubscription);

      if (preferenceResponse.ok) {
        const preferenceData = await preferenceResponse.json();
        if (
          typeof preferenceData?.preference === "string" &&
          isPaymentPreference(preferenceData.preference)
        ) {
          setPreference(preferenceData.preference);
        }
      }
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

  async function updatePreference(next: PaymentPreference) {
    if (savingPreference || next === preference) return;

    const previous = preference;
    setPreference(next);
    setPreferenceMessage(false);

    try {
      setSavingPreference(true);

      const response = await fetch("/api/subscription/payment-preference", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preference: next }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || t("loadError"));
      }

      setPreferenceMessage(true);
    } catch {
      setPreference(previous);
      setError(t("loadError"));
    } finally {
      setSavingPreference(false);
    }
  }

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

    if (receiptReference.trim().length < 3) {
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
      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <h2 className="text-xl font-bold">{t("title")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("needBusiness")}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const showPlans = !pending;

  return (
    <section
      id="subscription-panel"
      className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <Sparkles className="mt-1 h-5 w-5 shrink-0 text-primary" />
        <div>
          <h2 className="text-xl font-bold">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {effectiveMethod === "MANUAL" ? t("subtitleIR") : t("subtitleOther")}
          </p>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4 animate-pulse" />
          {t("checkingStatus")}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <X className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!loading && subscription && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50 p-4">
          <Crown className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm">
            <p className="font-semibold text-amber-900">
              {t("activePlan", {
                plan:
                  planLabels[subscription.plan as PlanCode] ||
                  subscription.plan,
              })}
            </p>
            {subscription.expiresAt && (
              <p className="mt-1 flex items-center gap-1.5 text-amber-800">
                <CalendarDays className="h-4 w-4" />
                {t("expiresAt", {
                  date: new Date(subscription.expiresAt).toLocaleDateString(
                    locale
                  ),
                })}
              </p>
            )}
          </div>
        </div>
      )}

      {!loading && !subscription && pending && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <span>
            {t("pendingNotice", {
              plan: planLabels[pending.plan as PlanCode] || pending.plan,
            })}
          </span>
        </div>
      )}

      {!loading && !subscription && !pending && (
        <div className="flex items-start gap-3 rounded-xl bg-muted p-4">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="text-sm">
            <p className="font-semibold">{t("compareFreeTitle")}</p>
            <p className="mt-1 text-muted-foreground">
              {t("compareFreeBusiness")}
            </p>
          </div>
        </div>
      )}

      {preferenceMessage && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-300/60 bg-emerald-50 p-3 text-sm text-emerald-800">
          <Check className="h-4 w-4 shrink-0" />
          {t("preferenceSaved")}
        </div>
      )}

      {!loading && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("preferenceLabel")}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {PREFERENCE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={savingPreference}
                onClick={() => updatePreference(option.value)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                  preference === option.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "bg-background hover:bg-muted"
                }`}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </div>
      )}

      {!loading && showPlans && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Object.values(PLANS).map((plan) => (
            <div
              key={plan.code}
              className="flex flex-col rounded-xl border bg-background p-4"
            >
              <div className="flex items-center gap-2">
                <Crown className="h-4 w-4 text-amber-600" />
                <div className="font-semibold">{planLabels[plan.code]}</div>
              </div>

              <div className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                {effectiveMethod === "MANUAL" ? (
                  <>
                    <CreditCard className="h-4 w-4" />
                    {t("priceManual", {
                      price: formatToman(plan.manualPriceToman, locale),
                    })}
                  </>
                ) : (
                  <>
                    <Star className="h-4 w-4 text-amber-500" />
                    {t("starsPayment", { stars: plan.starsPrice })}
                  </>
                )}
              </div>

              <button
                type="button"
                disabled={checkingOut !== null || submittingReceipt}
                onClick={() =>
                  effectiveMethod === "MANUAL"
                    ? openManualPayment(plan.code)
                    : subscribeWithStars(plan.code)
                }
                className="mt-4 w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-50"
              >
                {checkingOut === plan.code
                  ? t("connecting")
                  : t("selectButton")}
              </button>
            </div>
          ))}
        </div>
      )}

      {!loading && !subscription && (
        <div className="space-y-3 rounded-xl border bg-background p-4">
          <h3 className="text-sm font-semibold">{t("compareTitle")}</h3>

          <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 sm:grid-cols-2">
            <div className="rounded-xl bg-muted p-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-muted-foreground" />
                <p className="font-semibold">{t("compareFreeTitle")}</p>
              </div>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <X className="mt-0.5 h-4 w-4 shrink-0" />
                  {t("compareFreeBusiness")}
                </li>
                <li className="flex items-start gap-2">
                  <X className="mt-0.5 h-4 w-4 shrink-0" />
                  {t("compareFreeSupport")}
                </li>
              </ul>
            </div>

            <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-4">
              <div className="flex items-center gap-2">
                <Crown className="h-4 w-4 text-amber-600" />
                <p className="font-semibold text-amber-900">
                  {t("compareProTitle")}
                </p>
              </div>
              <ul className="mt-3 space-y-2 text-sm text-amber-900">
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  {t("compareProBusiness")}
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  {t("compareProSupport")}
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  {t("compareProBadge")}
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {manualPlan && (
        <div className="space-y-3 rounded-xl border p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 font-semibold">
              <CreditCard className="h-4 w-4" />
              {t("manualPaymentTitle", { plan: planLabels[manualPlan] })}
            </h3>
            <button
              type="button"
              onClick={() => setManualPlan(null)}
              className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
              aria-label={t("cancelButton")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {manualLoading && (
            <p className="text-sm text-muted-foreground">
              {t("manualLoading")}
            </p>
          )}

          {manualInfo && !manualInfo.configured && (
            <p className="flex items-start gap-2 text-sm text-destructive">
              <X className="mt-0.5 h-4 w-4 shrink-0" />
              {t("manualNotConfigured")}
            </p>
          )}

          {manualInfo && manualInfo.configured && (
            <div className="space-y-1 rounded-lg bg-muted p-3 text-sm">
              <p className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 shrink-0 text-muted-foreground" />
                {t("cardNumber", { value: manualInfo.cardNumber })}
              </p>
              {manualInfo.cardHolder && (
                <p className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {t("accountHolder", { value: manualInfo.cardHolder })}
                </p>
              )}
              {manualInfo.bankName && (
                <p className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {t("bankName", { value: manualInfo.bankName })}
                </p>
              )}
              {manualInfo.instructions && (
                <p className="pt-1 text-muted-foreground">
                  {manualInfo.instructions}
                </p>
              )}
            </div>
          )}

          <input
            value={receiptReference}
            onChange={(event) => setReceiptReference(event.target.value)}
            placeholder={t("receiptPlaceholder")}
            className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm outline-none"
          />

          <textarea
            value={receiptNote}
            onChange={(event) => setReceiptNote(event.target.value)}
            placeholder={t("notePlaceholder")}
            className="min-h-16 w-full rounded-lg border bg-background px-3 py-2.5 text-sm outline-none"
          />

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={submitReceipt}
              disabled={submittingReceipt}
              className="rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {submittingReceipt ? t("submitting") : t("submitButton")}
            </button>

            <button
              type="button"
              onClick={() => setManualPlan(null)}
              className="rounded-lg border px-3 py-2.5 text-sm font-medium"
            >
              {t("cancelButton")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
