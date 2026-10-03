"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  Crown,
  Loader2,
  Sparkles,
  Star,
  X,
  XCircle,
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

const CARD_MAIN = "rounded-3xl bg-[#B8D4F5] p-5 shadow-soft";

const CARD_INNER = "rounded-2xl bg-white p-4 shadow-soft";

const CARD_INNER_MUTED = "rounded-2xl bg-white/60 p-4 shadow-soft";

const BTN_PRIMARY =
  "btn-elevated flex w-full items-center justify-center gap-2 rounded-2xl bg-[#4F5FE8] px-4 py-3.5 text-sm font-bold text-white transition-transform active:scale-[0.98] disabled:opacity-50";

const BTN_GHOST =
  "flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-3 py-3 text-sm font-bold text-[#1A1F36] shadow-soft transition-transform active:scale-[0.98] disabled:opacity-50";

const BTN_PREF_ACTIVE =
  "btn-selected w-full rounded-2xl px-3 py-2.5 text-sm font-bold transition-all active:scale-95 disabled:opacity-50";

const BTN_PREF_IDLE =
  "w-full rounded-2xl bg-white px-3 py-2.5 text-sm font-bold text-[#1A1F36] shadow-soft transition-all active:scale-95 disabled:opacity-50";

const INPUT_BASE =
  "w-full rounded-2xl bg-white px-4 py-3 text-sm font-medium text-[#1A1F36] outline-none placeholder:text-[#1A1F36]/40 shadow-soft";

const SECTION_ICON =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-soft";

const SECTION_TITLE = "text-base font-bold text-[#1A1F36]";

const LABEL_SMALL =
  "text-[11px] font-bold uppercase tracking-wide text-[#1A1F36]/50";

const BOX_ERROR =
  "flex items-start gap-2 rounded-2xl bg-[#FF4D5E] p-3.5 text-sm font-medium text-white shadow-soft";

const BOX_SUCCESS =
  "flex items-start gap-2 rounded-2xl bg-[#34C759] p-3.5 text-sm font-bold text-white shadow-soft";

const BADGE_CROWN =
  "inline-flex items-center gap-1 rounded-full bg-[#FCA311] px-2.5 py-1 text-[10px] font-bold text-white shadow-soft";

const BADGE_PENDING =
  "inline-flex items-center gap-1 rounded-full bg-[#1A1F36]/15 px-2.5 py-1 text-[10px] font-bold text-[#1A1F36]/70";

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

  const manualBoxRef = useRef<HTMLDivElement | null>(null);

  const effectiveMethod = resolvePaymentMethod(preference ?? "AUTO", country);

  const planLabels: Record<PlanCode, string> = {
    PRO_MONTHLY: t("planMonthly"),
    PRO_YEARLY: t("planYearly"),
  };

  useEffect(() => {
    if (manualPlan && manualBoxRef.current) {
      const id = window.setTimeout(() => {
        if (manualBoxRef.current) {
          manualBoxRef.current.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }
      }, 50);
      return () => window.clearTimeout(id);
    }
  }, [manualPlan]);

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
      setPreference(previous);
      setError(text);
    } finally {
      setSavingPreference(false);
    }
  }

  async function subscribeWithStars(plan: PlanCode) {
    setOkMessage(null);

    if (!businessId) {
      setError(t("needBusiness"));
      return;
    }

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

      if (!data || typeof data.invoiceLink !== "string" || !data.invoiceLink) {
        throw new Error(t("checkoutError"));
      }

      const webApp = getTelegramWebApp();

      if (!webApp || typeof webApp.openInvoice !== "function") {
        setError(t("telegramOnly"));
        return;
      }

      webApp.openInvoice(data.invoiceLink, (status) => {
        if (status === "paid") {
          loadStatus();
        }
      });
    } catch (err) {
      const text = err instanceof Error ? err.message : t("checkoutError");
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
      setError(text);
    } finally {
      setManualLoading(false);
    }
  }

  async function submitReceipt() {
    setOkMessage(null);

    if (!businessId || !manualPlan) {
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
      setError(text);
    } finally {
      setSubmittingReceipt(false);
    }
  }

  // ==================== NO BUSINESS ====================
  if (!businessId || !country) {
    return (
      <section className={CARD_MAIN}>
        <div className="flex items-start gap-3">
          <span className={SECTION_ICON}>
            <Sparkles className="h-5 w-5 text-[#4F5FE8]" />
          </span>
          <div>
            <h2 className={SECTION_TITLE}>{t("title")}</h2>
            <p className="mt-1 text-sm font-medium text-[#1A1F36]/60">
              {t("needBusiness")}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const showPlans = !pending;

  return (
    <section id="subscription-panel" className={CARD_MAIN}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className={SECTION_ICON}>
          <Sparkles className="h-5 w-5 text-[#4F5FE8]" />
        </span>
        <div className="min-w-0">
          <h2 className={SECTION_TITLE}>{t("title")}</h2>
          <p className="mt-0.5 text-xs font-medium text-[#1A1F36]/60">
            {effectiveMethod === "MANUAL"
              ? t("subtitleIR")
              : t("subtitleOther")}
          </p>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-white py-4 text-sm font-medium text-[#1A1F36]/60 shadow-soft">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("checkingStatus")}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className={BOX_ERROR + " mt-4"}>
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Success */}
      {okMessage && (
        <div className={BOX_SUCCESS + " mt-4"}>
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{okMessage}</span>
        </div>
      )}

      {/* Active subscription */}
      {!loading && subscription && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl bg-[#FCA311] p-4 shadow-soft">
          <Crown className="mt-0.5 h-5 w-5 shrink-0 text-white" />
          <div className="text-sm text-white">
            <p className="font-bold">
              {t("activePlan", {
                plan:
                  planLabels[subscription.plan as PlanCode] ||
                  subscription.plan,
              })}
            </p>
            {subscription.expiresAt && (
              <p className="mt-1 flex items-center gap-1.5 opacity-90">
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

      {/* Pending subscription */}
      {!loading && !subscription && pending && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl bg-white p-4 shadow-soft">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-[#FCA311]" />
          <div className="min-w-0 flex-1 text-sm">
            <span className={BADGE_PENDING}>
              {t("statusPending")}
            </span>
            <p className="mt-2 font-medium text-[#1A1F36]">
              {t("pendingNotice", {
                plan: planLabels[pending.plan as PlanCode] || pending.plan,
              })}
            </p>
          </div>
        </div>
      )}

      {/* Free plan info */}
      {!loading && !subscription && !pending && (
        <div className={CARD_INNER_MUTED + " mt-4 flex items-start gap-3"}>
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-[#1A1F36]/50" />
          <div className="text-sm">
            <p className="font-bold text-[#1A1F36]">{t("compareFreeTitle")}</p>
            <p className="mt-0.5 font-medium text-[#1A1F36]/60">
              {t("compareFreeBusiness")}
            </p>
          </div>
        </div>
      )}

      {/* Preference saved */}
      {preferenceMessage && (
        <div className={BOX_SUCCESS + " mt-4"}>
          <Check className="h-4 w-4 shrink-0" />
          {t("preferenceSaved")}
        </div>
      )}

      {/* Payment preference */}
      {!loading && (
        <div className="mt-4">
          <p className={LABEL_SMALL + " mb-2"}>{t("preferenceLabel")}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {PREFERENCE_OPTIONS.map((option) => {
              const isActive = preference === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={savingPreference}
                  onClick={() => updatePreference(option.value)}
                  className={isActive ? BTN_PREF_ACTIVE : BTN_PREF_IDLE}
                >
                  {t(option.labelKey)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Plans */}
      {!loading && showPlans && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Object.values(PLANS).map((plan) => {
            const isCheckingOut = checkingOut === plan.code;
            const disabled = checkingOut !== null || submittingReceipt;

            return (
              <div key={plan.code} className={CARD_INNER}>
                <div className="flex items-center gap-2">
                  <Crown className="h-4 w-4 text-[#FCA311]" />
                  <div className="text-sm font-bold text-[#1A1F36]">
                    {planLabels[plan.code]}
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-1.5 text-sm font-medium text-[#1A1F36]/70">
                  {effectiveMethod === "MANUAL" ? (
                          <>
                      <CreditCard className="h-4 w-4" />
                      <span className="tabular font-bold text-[#1A1F36]">
                        {t("priceManual", {
                          price: formatToman(plan.manualPriceToman, locale),
                        })}
                      </span>
                    </>
                  ) : (
                    <>
                      <Star className="h-4 w-4 text-[#FCA311]" />
                      <span className="tabular font-bold text-[#1A1F36]">
                        {t("starsPayment", { stars: plan.starsPrice })}
                      </span>
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
                  className={BTN_PRIMARY + " mt-4"}
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

      {/* Compare */}
      {!loading && !subscription && (
        <div className={CARD_INNER + " mt-4"}>
          <h3 className="text-sm font-bold text-[#1A1F36]">
            {t("compareTitle")}
          </h3>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* Free */}
            <div className={CARD_INNER_MUTED}>
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[#1A1F36]/50" />
                <p className="text-sm font-bold text-[#1A1F36]">
                  {t("compareFreeTitle")}
                </p>
              </div>
              <ul className="mt-3 space-y-2 text-sm font-medium text-[#1A1F36]/60">
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

            {/* Pro */}
            <div className="rounded-2xl bg-[#FCA311]/15 p-4">
              <div className="flex items-center gap-2">
                <Crown className="h-4 w-4 text-[#FCA311]" />
                <p className="text-sm font-bold text-[#1A1F36]">
                  {t("compareProTitle")}
                </p>
              </div>
              <ul className="mt-3 space-y-2 text-sm font-medium text-[#1A1F36]/80">
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#34C759]" />
                  {t("compareProBusiness")}
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#34C759]" />
                  {t("compareProSupport")}
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#34C759]" />
                  {t("compareProBadge")}
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Manual payment box */}
      {manualPlan && (
        <div ref={manualBoxRef} className={CARD_INNER + " mt-4 scroll-mt-4"}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-bold text-[#1A1F36]">
              <CreditCard className="h-4 w-4 text-[#4F5FE8]" />
              {t("manualPaymentTitle", { plan: planLabels[manualPlan] })}
            </h3>
            <button
              type="button"
              onClick={() => setManualPlan(null)}
              aria-label={t("cancelButton")}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1A1F36]/10 text-[#1A1F36] transition-colors hover:bg-[#1A1F36]/20"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {manualLoading && (
            <div className="mt-3 flex items-center justify-center gap-2 rounded-2xl bg-[#B8D4F5]/60 py-4 text-sm font-medium text-[#1A1F36]/60">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("manualLoading")}
            </div>
          )}

          {!manualLoading && manualInfo && !manualInfo.configured && (
            <div className="mt-3 rounded-2xl bg-[#FF4D5E] p-4 text-sm font-medium text-white">
              {t("manualNotConfigured")}
            </div>
          )}

          {!manualLoading && manualInfo && manualInfo.configured && (
            <>
              <div className="mt-3 space-y-3">
                {manualInfo.cardNumber && (
                  <div className="rounded-2xl bg-white p-4 shadow-soft">
                    <p className={LABEL_SMALL}>{t("cardNumberLabel")}</p>
                    <p className="mt-1 tabular text-lg font-bold tracking-wider text-[#1A1F36]">
                      {manualInfo.cardNumber}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  {manualInfo.cardHolder && (
                    <div className="rounded-2xl bg-white p-3 shadow-soft">
                      <p className={LABEL_SMALL}>
                        {t("accountHolderLabel")}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-[#1A1F36]">
                        {manualInfo.cardHolder}
                      </p>
                    </div>
                  )}
                  {manualInfo.bankName && (
                    <div className="rounded-2xl bg-white p-3 shadow-soft">
                      <p className={LABEL_SMALL}>{t("bankNameLabel")}</p>
                      <p className="mt-1 text-sm font-semibold text-[#1A1F36]">
                        {manualInfo.bankName}
                      </p>
                    </div>
                  )}
                </div>

                {manualInfo.instructions && (
                  <div className="rounded-2xl bg-white/60 p-4 shadow-soft">
                    <p className="text-sm font-medium text-[#1A1F36]/80">
                      {manualInfo.instructions}
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-4 space-y-3">
                <input
                  value={receiptReference}
                  onChange={(event) =>
                    setReceiptReference(event.target.value)
                  }
                  placeholder={t("receiptPlaceholder")}
                  className={INPUT_BASE}
                />

                <textarea
                  value={receiptNote}
                  onChange={(event) => setReceiptNote(event.target.value)}
                  placeholder={t("notePlaceholder")}
                  className={INPUT_BASE + " min-h-16"}
                />

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={submitReceipt}
                    disabled={submittingReceipt}
                    className={BTN_PRIMARY}
                  >
                    {submittingReceipt && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    {submittingReceipt ? t("submitting") : t("submitButton")}
                  </button>

                  <button
                    type="button"
                    onClick={() => setManualPlan(null)}
                    className={BTN_GHOST}
                  >
                    {t("cancelButton")}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
