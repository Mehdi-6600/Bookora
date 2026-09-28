"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  CalendarDays,
  Check,
  Clock,
  CreditCard,
  Crown,
  Loader2,
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
  const [preference, setPreference] = useState<PaymentPreference | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState<PlanCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  const [manualPlan, setManualPlan] = useState<PlanCode | null>(null);
  const [manualInfo, setManualInfo] = useState<ManualInstructions | null>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const [receiptReference, setReceiptReference] = useState("");
  const [receiptNote, setReceiptNote] = useState("");
  const [submittingReceipt, setSubmittingReceipt] = useState(false);

  const [savingPreference, setSavingPreference] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState(false);

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
      const text = err instanceof Error ? err.message : t("loadError");
      console.error("[subscription] loadStatus failed:", text);
      setError(text);
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
    setError(null);

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
    } catch (err) {
      const text = err instanceof Error ? err.message : t("loadError");
      console.error("[subscription] updatePreference failed:", text);
      setPreference(previous);
      setError(text);
    } finally {
      setSavingPreference(false);
    }
  }

  async function subscribeWithStars(plan: PlanCode) {
    setOkMessage(null);

    if (!businessId) {
      console.error("[subscription] subscribeWithStars: businessId is null");
      setError(t("needBusiness"));
      return;
    }

    try {
      setCheckingOut(plan);
      setError(null);

      console.log(
        "[subscription] subscribeWithStars start",
        JSON.stringify({ plan, businessId })
      );

      const response = await fetch("/api/subscription/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, businessId }),
      });

      const data = await response.json();

      console.log(
        "[subscription] checkout response",
        response.status,
        JSON.stringify(data)
      );

      if (!response.ok) {
        throw new Error(data?.error || t("checkoutError"));
      }

      if (!data || typeof data.invoiceLink !== "string" || !data.invoiceLink) {
        throw new Error(t("checkoutError"));
      }

      const webApp = getTelegramWebApp();

      if (!webApp) {
        console.error("[subscription] Telegram.WebApp is unavailable");
        setError(t("telegramOnly"));
        return;
      }

      if (typeof webApp.openInvoice !== "function") {
        console.error("[subscription] Telegram.WebApp.openInvoice is missing");
        setError(t("telegramOnly"));
        return;
      }

      webApp.openInvoice(data.invoiceLink, (status) => {
        console.log("[subscription] invoice status:", status);
        if (status === "paid") {
          loadStatus();
        }
      });
    } catch (err) {
      const text = err instanceof Error ? err.message : t("checkoutError");
      console.error("[subscription] subscribeWithStars failed:", text);
      setError(text);
    } finally {
      setCheckingOut(null);
    }
  }

  async function openManualPayment(plan: PlanCode) {
    setOkMessage(null);
    setManualPlan(plan);
    setError(null);
    setReceiptReference("");
    setReceiptNote("");
    setManualInfo(null);

    if (!businessId) {
      console.error("[subscription] openManualPayment: businessId is null");
      setError(t("needBusiness"));
      return;
    }

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
      const text = err instanceof Error ? err.message : t("loadError");
      console.error("[subscription] openManualPayment failed:", text);
      setError(text);
    } finally {
      setManualLoading(false);
    }
  }

  async function submitReceipt() {
    setOkMessage(null);

    if (!businessId || !manualPlan) {
      console.error(
        "[subscription] submitReceipt: missing businessId or manualPlan"
      );
      setError(t("needBusiness"));
      return;
    }

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
      setOkMessage(t("submittedNotice"));
    } catch (err) {
      const text = err instanceof Error ? err.message : t("submitError");
      console.error("[subscription] submitReceipt failed:", text);
      setError(text);
    } finally {
      setSubmittingReceipt(false);
    }
  }

  if (!businessId || !country) {
    return (
      <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-soft">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              {t("title")}
            </h2>
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
      className="rounded-2xl border border-border/60 bg-card p-5 shadow-soft"
    >
      <div className="flex items-start gap-3">
        <Sparkles className="mt-1 h-5 w-5 shrink-0 text-primary" />
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {t("title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {effectiveMethod === "MANUAL"
              ? t("subtitleIR")
              : t("subtitleOther")}
          </p>
        </div>
      </div>

      {loading && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-border/60 bg-background p-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("checkingStatus")}
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <X className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {okMessage && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-400">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{okMessage}</span>
        </div>
      )}

      {!loading && subscription && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <Crown className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm">
            <p className="font-semibold text-amber-900 dark:text-amber-400">
              {t("activePlan", {
                plan:
                  planLabels[subscription.plan as PlanCode] ||
                  subscription.plan,
              })}
            </p>
            {subscription.expiresAt && (
              <p className="mt-1 flex items-center gap-1.5 text-amber-800 dark:text-amber-400/90">
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
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-800 dark:text-amber-400">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <span>
            {t("pendingNotice", {
              plan: planLabels[pending.plan as PlanCode] || pending.plan,
            })}
          </span>
        </div>
      )}

      {!loading && !subscription && !pending && (
        <div className="mt-4 flex items-start gap-3 rounded-xl bg-muted/40 p-4">
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
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-400">
          <Check className="h-4 w-4 shrink-0" />
          {t("preferenceSaved")}
        </div>
      )}

      {!loading && (
        <div className="mt-4 space-y-2">
          <p className="text-sm font-medium">{t("preferenceLabel")}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {PREFERENCE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={savingPreference}
                onClick={() => updatePreference(option.value)}
                className={
                  preference === option.value
                    ? "ring-focus rounded-xl border border-primary bg-primary/10 px-3 py-2.5 text-sm font-medium text-primary transition-colors disabled:opacity-50"
                    : "ring-focus rounded-xl border border-border/60 bg-background px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
                }
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </div>
      )}

      {!loading && showPlans && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Object.values(PLANS).map((plan) => {
            const isCheckingOut = checkingOut === plan.code;
            const disabled = checkingOut !== null || submittingReceipt;

            return (
              <div
                key={plan.code}
                className="flex flex-col rounded-xl border border-border/60 bg-background p-4"
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
                  disabled={disabled}
                  onClick={() =>
                    effectiveMethod === "MANUAL"
                      ? openManualPayment(plan.code)
                      : subscribeWithStars(plan.code)
                  }
                  className="ring-focus mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {isCheckingOut && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {isCheckingOut ? t("connecting") : t("selectButton")}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {!loading && !subscription && (
        <div className="mt-4 space-y-3 rounded-xl border border-border/60 bg-background p-4">
          <h3 className="text-sm font-semibold">{t("compareTitle")}</h3>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-muted/40 p-4">
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

            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex items-center gap-2">
                <Crown className="h-4 w-4 text-amber-600" />
                <p className="font-semibold text-amber-900 dark:text-amber-400">
                  {t("compareProTitle")}
                </p>
              </div>
              <ul className="mt-3 space-y-2 text-sm text-amber-900 dark:text-amber-400">
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
        <div className="mt-4 space-y-3 rounded-xl border border-border/60 bg-background p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 font-semibold">
              <CreditCard className="h-4 w-4" />
              {t("manualPaymentTitle", { plan: planLabels[manualPlan] })}
            </h3>
            <button
              type="button"
              onClick={() => setManualPlan(null)}
              aria-label={t("cancelButton")}
              className="ring-focus rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {manualLoading && (
            <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("manualLoading")}
            </div>
          )}

          {!manualLoading && manualInfo && !manualInfo.configured && (
            <p className="flex items-start gap-2 text-sm text-destructive">
              <X className="mt-0.5 h-4 w-4 shrink-0" />
              {t("manualNotConfigured")}
            </p>
          )}

          {!manualLoading && manualInfo && manualInfo.configured && (
            <div className="space-y-1 rounded-lg bg-muted/40 p-3 text-sm">
              <p className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 shrink-0 text-muted-foreground" />
                {t("cardNumber", { value: manualInfo.cardNumber || "" })}
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

          {!manualLoading && manualInfo && manualInfo.configured && (
            <>
              <input
                value={receiptReference}
                onChange={(event) => setReceiptReference(event.target.value)}
                placeholder={t("receiptPlaceholder")}
                className="ring-focus w-full rounded-lg border border-border/60 bg-background px-3 py-2.5 text-sm outline-none"
              />

              <textarea
                value={receiptNote}
                onChange={(event) => setReceiptNote(event.target.value)}
                placeholder={t("notePlaceholder")}
                className="ring-focus min-h-16 w-full rounded-lg border border-border/60 bg-background px-3 py-2.5 text-sm outline-none"
              />

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={submitReceipt}
                  disabled={submittingReceipt}
                  className="ring-focus flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {submittingReceipt && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {submittingReceipt ? t("submitting") : t("submitButton")}
                </button>

                <button
                  type="button"
                  onClick={() => setManualPlan(null)}
                  className="ring-focus rounded-lg border border-border/60 bg-background px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
                >
                  {t("cancelButton")}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
