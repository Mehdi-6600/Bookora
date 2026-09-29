"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import {
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  Scissors,
  Sparkles,
  User,
} from "lucide-react";
import { formatPrice } from "@/lib/currency";
import { LocaleSwitcher } from "@/components/locale-switcher";

type Service = {
  id: string;
  name: string;
  description: string | null;
  price: string;
  currency: string;
  durationMinutes: number;
  depositType: string;
  depositValue: string;
};

type BusinessInfo = {
  name: string;
  description: string | null;
  currency: string;
  country: string | null;
  timezone: string | null;
  services: Service[];
};

type PaymentMethodInfo = {
  accountHolder: string | null;
  bankName: string | null;
  cardNumber: string | null;
  instructions: string | null;
};

const CARD_MAIN = "rounded-3xl bg-[#B8D4F5] p-5 shadow-soft";

const BTN_PRIMARY =
  "btn-elevated w-full rounded-2xl bg-[#4F5FE8] px-4 py-4 text-base font-bold text-white transition-transform active:scale-[0.98] disabled:opacity-50";

const BTN_SERVICE =
  "w-full rounded-2xl bg-white p-4 text-start shadow-soft transition-all active:scale-[0.99]";

const BTN_SERVICE_SELECTED =
  "w-full rounded-2xl bg-white p-4 text-start shadow-elevated ring-2 ring-[#4F5FE8] transition-all active:scale-[0.99]";

const BTN_DATE =
  "shrink-0 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-[#1A1F36] shadow-soft transition-all active:scale-95";

const BTN_DATE_SELECTED =
  "shrink-0 rounded-2xl bg-[#4F5FE8] px-4 py-3 text-sm font-bold text-white shadow-elevated transition-all active:scale-95";

const BTN_SLOT =
  "rounded-2xl bg-white px-3 py-3 text-sm font-semibold text-[#1A1F36] tabular shadow-soft transition-all active:scale-95";

const BTN_SLOT_SELECTED =
  "rounded-2xl bg-[#4F5FE8] px-3 py-3 text-sm font-bold text-white tabular shadow-elevated transition-all active:scale-95";

const INPUT_BASE =
  "w-full rounded-2xl bg-white px-4 py-3.5 text-base text-[#1A1F36] outline-none placeholder:text-[#1A1F36]/40";

const ERROR_BOX =
  "rounded-2xl bg-[#FF4D5E] px-4 py-3 text-sm font-medium text-white shadow-soft";

const SECTION_ICON =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white shadow-soft";

const SECTION_TITLE = "text-sm font-bold text-[#1A1F36]";

const LABEL_SMALL =
  "text-[11px] font-bold uppercase tracking-wide text-[#1A1F36]/50";

function toISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function buildNextDays(count: number): Date[] {
  const days: Date[] = [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  for (let i = 0; i < count; i += 1) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  return days;
}

export default function PublicBookingPage() {
  const t = useTranslations("publicBooking");
  const tSvc = useTranslations("service");
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [business, setBusiness] = useState<BusinessInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(
    null
  );

  const nextDays = useMemo(() => buildNextDays(14), []);
  const [date, setDate] = useState<string>(() => toISODate(nextDays[0]));
  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [confirmedBookingId, setConfirmedBookingId] = useState<string | null>(
    null
  );
  const [depositDue, setDepositDue] = useState(0);
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethodInfo | null>(null);
  const [receiptRef, setReceiptRef] = useState("");
  const [submittingReceipt, setSubmittingReceipt] = useState(false);
  const [receiptSubmitted, setReceiptSubmitted] = useState(false);

  const locale = business?.country === "IR" ? "fa-IR" : "en-US";
  const tz = business?.timezone || "UTC";

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);

        const response = await fetch(`/api/public/business/${slug}`, {
          cache: "no-store",
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error || t("notFound"));
        }

        setBusiness(data.business);

        if (data.business.services.length > 0) {
          setSelectedServiceId(data.business.services[0].id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t("notFound"));
      } finally {
        setLoading(false);
      }
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    if (!selectedServiceId) return;

    async function loadSlots() {
      try {
        setLoadingSlots(true);
        setSelectedSlot(null);
        setError(null);

        const response = await fetch(
          `/api/public/business/${slug}/availability?serviceId=${selectedServiceId}&date=${date}`,
          { cache: "no-store" }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error || t("slotsError"));
        }

        setSlots(data.slots || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("slotsError"));
      } finally {
        setLoadingSlots(false);
      }
    }

    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServiceId, date, slug]);

  async function submitBooking() {
    if (!selectedServiceId || !selectedSlot) return;

    if (!customerName.trim() || !customerPhone.trim()) {
      setError(t("nameRequired"));
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const response = await fetch(`/api/public/business/${slug}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: selectedServiceId,
          startAt: selectedSlot,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          customerEmail: customerEmail.trim() || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || t("bookingError"));
      }

      setConfirmedBookingId(data.booking.id);
      setDepositDue(Number(data.booking.depositDue) || 0);
      setPaymentMethod(data.paymentMethod);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("bookingError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReceipt() {
    if (!confirmedBookingId || !receiptRef.trim()) {
      setError(t("receiptRequired"));
      return;
    }

    try {
      setSubmittingReceipt(true);
      setError(null);

      const response = await fetch(
        `/api/public/bookings/${confirmedBookingId}/receipt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerPhone: customerPhone.trim(),
            transactionReference: receiptRef.trim(),
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || t("receiptError"));
      }

      setReceiptSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("receiptError"));
    } finally {
      setSubmittingReceipt(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-medium text-[#1A1F36] shadow-soft">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("loading")}
        </div>
      </div>
    );
  }

  if (error && !business) {
    return (
      <div className="mx-auto max-w-md p-6">
        <div className={ERROR_BOX}>{error}</div>
      </div>
    );
  }

  if (!business) return null;

  const selectedService = business.services.find(
    (s) => s.id === selectedServiceId
  );

  if (confirmedBookingId && (!depositDue || depositDue <= 0)) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center p-6">
        <div className="w-full space-y-5 rounded-3xl bg-[#B8D4F5] p-6 text-center shadow-elevated">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#34C759] shadow-soft">
            <CheckCircle2 className="h-10 w-10 text-white" strokeWidth={3} />
          </div>
          <h1 className="text-2xl font-bold text-[#1A1F36]">
            {t("confirmed")}
          </h1>
          <p className="text-sm font-medium text-[#1A1F36]/70">
            {t("confirmedDesc", { name: business.name })}
          </p>
        </div>
      </div>
    );
  }

  if (confirmedBookingId && receiptSubmitted) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center p-6">
        <div className="w-full space-y-5 rounded-3xl bg-[#B8D4F5] p-6 text-center shadow-elevated">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#34C759] shadow-soft">
            <CheckCircle2 className="h-10 w-10 text-white" strokeWidth={3} />
          </div>
          <h1 className="text-2xl font-bold text-[#1A1F36]">
            {t("receiptSubmitted")}
          </h1>
          <p className="text-sm font-medium text-[#1A1F36]/70">
            {t("receiptSubmittedDesc", { name: business.name })}
          </p>
        </div>
      </div>
    );
  }

  if (confirmedBookingId) {
    return (
      <div className="mx-auto max-w-md space-y-5 p-4 py-8">
        <div className="rounded-3xl bg-[#B8D4F5] p-6 shadow-elevated">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white shadow-soft">
              <CreditCard className="h-6 w-6 text-[#4F5FE8]" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-bold text-[#1A1F36]">
                {t("depositTitle")}
              </h1>
              <p className="mt-0.5 text-xs font-medium text-[#1A1F36]/60">
                {t("depositDesc", {
                  amount: formatPrice(
                    depositDue,
                    selectedService?.currency || business.currency
                  ),
                })}
              </p>
            </div>
          </div>

          {error && <div className={ERROR_BOX + " mt-4"}>{error}</div>}

          {paymentMethod ? (
            <div className="mt-5 space-y-3">
              {paymentMethod.cardNumber && (
                <div className="rounded-2xl bg-white p-4 shadow-soft">
                  <p className={LABEL_SMALL}>{t("cardNumberLabel")}</p>
                  <p className="mt-1 tabular text-lg font-bold tracking-wider text-[#1A1F36]">
                    {paymentMethod.cardNumber}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {paymentMethod.accountHolder && (
                  <div className="rounded-2xl bg-white p-3 shadow-soft">
                    <p className={LABEL_SMALL}>
                      {t("accountHolderLabel")}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[#1A1F36]">
                      {paymentMethod.accountHolder}
                    </p>
                  </div>
                )}
                {paymentMethod.bankName && (
                  <div className="rounded-2xl bg-white p-3 shadow-soft">
                    <p className={LABEL_SMALL}>{t("bankNameLabel")}</p>
                    <p className="mt-1 text-sm font-semibold text-[#1A1F36]">
                      {paymentMethod.bankName}
                    </p>
                  </div>
                )}
              </div>

              {paymentMethod.instructions && (
                <div className="rounded-2xl bg-white/60 p-4 shadow-soft">
                  <p className="text-sm font-medium text-[#1A1F36]/80">
                    {paymentMethod.instructions}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-5 rounded-2xl bg-[#FF4D5E]/15 p-4 text-sm font-medium text-[#FF4D5E]">
              {t("paymentInfoMissing")}
            </div>
          )}

          <div className="mt-5 space-y-3">
            <input
              value={receiptRef}
              onChange={(e) => setReceiptRef(e.target.value)}
              placeholder={t("receiptPlaceholder")}
              className={INPUT_BASE}
            />

            <button
              type="button"
              onClick={submitReceipt}
              disabled={submittingReceipt}
              className={BTN_PRIMARY}
            >
              {submittingReceipt ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("submitting")}
                </span>
              ) : (
                t("submitReceipt")
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-5 p-4 py-6">
      <div className="flex items-start justify-between gap-3 rounded-3xl bg-[#B8D4F5] p-5 shadow-elevated">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-[#1A1F36]">
            {business.name}
          </h1>
          {business.description && (
            <p className="mt-1 line-clamp-2 text-xs font-medium text-[#1A1F36]/60">
              {business.description}
            </p>
          )}
        </div>
        <LocaleSwitcher />
      </div>

      {error && <div className={ERROR_BOX}>{error}</div>}

      <div className={CARD_MAIN}>
        <div className="mb-4 flex items-center gap-2">
          <span className={SECTION_ICON}>
            <Scissors className="h-4 w-4 text-[#4F5FE8]" />
          </span>
          <h2 className={SECTION_TITLE}>{t("selectService")}</h2>
        </div>

        <div className="space-y-3">
          {business.services.map((service) => {
            const isSelected = selectedServiceId === service.id;
            const cls = isSelected ? BTN_SERVICE_SELECTED : BTN_SERVICE;
            return (
              <button
                key={service.id}
                type="button"
                onClick={() => setSelectedServiceId(service.id)}
                className={cls}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-bold text-[#1A1F36]">
                      {service.name}
                    </div>
                    {service.description && (
                      <div className="mt-0.5 line-clamp-2 text-xs font-medium text-[#1A1F36]/60">
                        {service.description}
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="inline-flex items-center gap-1 font-semibold text-[#4F5FE8]">
                        <Clock className="h-3.5 w-3.5" />
                        {tSvc("minutes", { count: service.durationMinutes })}
                      </span>
                      {service.depositType !== "NONE" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#4F5FE8]/15 px-2 py-0.5 text-[10px] font-bold text-[#4F5FE8]">
                          {t("requiresDeposit")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-end">
                    <div className="tabular text-base font-bold text-[#1A1F36]">
                      {formatPrice(service.price, service.currency)}
                    </div>
                    {isSelected && (
                      <div className="mt-1 flex justify-end">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#34C759] shadow-soft">
                          <CheckCircle2
                            className="h-3.5 w-3.5 text-white"
                            strokeWidth={3}
                          />
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className={CARD_MAIN}>
        <div className="mb-4 flex items-center gap-2">
          <span className={SECTION_ICON}>
            <Calendar className="h-4 w-4 text-[#4F5FE8]" />
          </span>
          <h2 className={SECTION_TITLE}>{t("selectDate")}</h2>
        </div>

        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {nextDays.map((d) => {
            const iso = toISODate(d);
            const label = d.toLocaleDateString(locale, {
              weekday: "short",
              day: "numeric",
              month: "short",
            });
            const isSelected = date === iso;
            return (
              <button
                key={iso}
                type="button"
                onClick={() => setDate(iso)}
                className={isSelected ? BTN_DATE_SELECTED : BTN_DATE}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className={CARD_MAIN}>
        <div className="mb-4 flex items-center gap-2">
          <span className={SECTION_ICON}>
            <Clock className="h-4 w-4 text-[#4F5FE8]" />
          </span>
          <h2 className={SECTION_TITLE}>{t("availableSlots")}</h2>
        </div>

        {loadingSlots ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl bg-white py-6 text-sm font-medium text-[#1A1F36]/60 shadow-soft">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("loading")}
          </div>
        ) : slots.length === 0 ? (
          <div className="rounded-2xl bg-white py-6 text-center text-sm font-medium text-[#1A1F36]/60 shadow-soft">
            {t("noSlots")}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {slots.map((slot) => {
              const zoned = toZonedTime(new Date(slot), tz);
              const label = format(zoned, "HH:mm");
              const isSelected = selectedSlot === slot;
              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() => setSelectedSlot(slot)}
                  className={isSelected ? BTN_SLOT_SELECTED : BTN_SLOT}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selectedSlot && (
        <div className={CARD_MAIN}>
          <div className="mb-4 flex items-center gap-2">
            <span className={SECTION_ICON}>
              <User className="h-4 w-4 text-[#4F5FE8]" />
            </span>
            <h2 className={SECTION_TITLE}>{t("yourInfo")}</h2>
          </div>

          <div className="space-y-3">
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder={t("namePlaceholder")}
              className={INPUT_BASE}
            />
            <input
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder={t("phonePlaceholder")}
              inputMode="tel"
              className={INPUT_BASE}
            />
            <input
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder={t("emailPlaceholder")}
              inputMode="email"
              className={INPUT_BASE}
            />

            <button
              type="button"
              onClick={submitBooking}
              disabled={submitting}
              className={BTN_PRIMARY + " mt-2"}
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("confirming")}
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  {t("confirmButton", {
                    price: selectedService
                      ? formatPrice(
                          selectedService.price,
                          selectedService.currency
                        )
                      : "",
                  })}
                </span>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
