"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { formatPrice } from "@/lib/currency";

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
  services: Service[];
};

type PaymentMethodInfo = {
  accountHolder: string | null;
  bankName: string | null;
  cardNumber: string | null;
  instructions: string | null;
};

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
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

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);

        const response = await fetch(`/api/public/business/${slug}`, {
          cache: "no-store",
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error || "کسب‌وکار پیدا نشد.");
        }

        setBusiness(data.business);

        if (data.business.services.length > 0) {
          setSelectedServiceId(data.business.services[0].id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "خطا در بارگذاری");
      } finally {
        setLoading(false);
      }
    }

    load();
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
          throw new Error(data?.error || "خطا در دریافت زمان‌ها");
        }

        setSlots(data.slots || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "خطا در دریافت زمان‌ها");
      } finally {
        setLoadingSlots(false);
      }
    }

    loadSlots();
  }, [selectedServiceId, date, slug]);

  async function submitBooking() {
    if (!selectedServiceId || !selectedSlot) return;

    if (!customerName.trim() || !customerPhone.trim()) {
      setError("نام و شماره تلفن را وارد کنید.");
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
        throw new Error(data?.error || "ثبت رزرو ناموفق بود.");
      }

      setConfirmedBookingId(data.booking.id);
      setDepositDue(data.booking.depositDue);
      setPaymentMethod(data.paymentMethod);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت رزرو ناموفق بود.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReceipt() {
    if (!confirmedBookingId || !receiptRef.trim()) {
      setError("کد رهگیری یا شماره تراکنش را وارد کنید.");
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
        throw new Error(data?.error || "ثبت رسید ناموفق بود.");
      }

      setReceiptSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت رسید ناموفق بود.");
    } finally {
      setSubmittingReceipt(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        در حال بارگذاری...
      </div>
    );
  }

  if (error && !business) {
    return (
      <div className="p-8 text-center text-sm text-destructive">{error}</div>
    );
  }

  if (!business) return null;

  const selectedService = business.services.find(
    (s) => s.id === selectedServiceId
  );

  if (confirmedBookingId) {
    if (depositDue <= 0) {
      return (
        <div className="mx-auto max-w-md space-y-4 p-6 text-center">
          <h1 className="text-xl font-bold">رزرو شما ثبت شد ✅</h1>
          <p className="text-sm text-muted-foreground">
            {business.name} منتظر شماست.
          </p>
        </div>
      );
    }

    if (receiptSubmitted) {
      return (
        <div className="mx-auto max-w-md space-y-4 p-6 text-center">
          <h1 className="text-xl font-bold">رسید شما ثبت شد ✅</h1>
          <p className="text-sm text-muted-foreground">
            بعد از تأیید {business.name}، رزرو شما نهایی می‌شود.
          </p>
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-md space-y-4 p-4 py-8">
        <h1 className="text-xl font-bold">پرداخت بیعانه</h1>
        <p className="text-sm text-muted-foreground">
          برای نهایی‌شدن رزرو، مبلغ{" "}
          {formatPrice(depositDue, selectedService?.currency || business.currency)}{" "}
          را واریز کنید.
        </p>

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {paymentMethod ? (
          <div className="space-y-1 rounded-lg bg-muted p-3 text-sm">
            {paymentMethod.cardNumber && <p>شماره کارت: {paymentMethod.cardNumber}</p>}
            {paymentMethod.accountHolder && <p>به نام: {paymentMethod.accountHolder}</p>}
            {paymentMethod.bankName && <p>بانک: {paymentMethod.bankName}</p>}
            {paymentMethod.instructions && (
              <p className="text-muted-foreground">{paymentMethod.instructions}</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-destructive">
            اطلاعات پرداخت هنوز توسط کسب‌وکار تنظیم نشده. برای هماهنگی مستقیم
            تماس بگیرید.
          </p>
        )}

        <input
          value={receiptRef}
          onChange={(e) => setReceiptRef(e.target.value)}
          placeholder="کد رهگیری یا شماره تراکنش"
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none"
        />

        <button
          type="button"
          onClick={submitReceipt}
          disabled={submittingReceipt}
          className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {submittingReceipt ? "در حال ثبت..." : "ثبت پرداخت"}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-6 p-4 py-8">
      <div>
        <h1 className="text-2xl font-bold">{business.name}</h1>
        {business.description && (
          <p className="mt-1 text-sm text-muted-foreground">
            {business.description}
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium">انتخاب سرویس</p>
        <div className="space-y-2">
          {business.services.map((service) => (
            <button
              key={service.id}
              type="button"
              onClick={() => setSelectedServiceId(service.id)}
              className={`w-full rounded-xl border p-3 text-right ${
                selectedServiceId === service.id
                  ? "border-primary bg-primary/10"
                  : "bg-background"
              }`}
            >
              <div className="font-semibold">{service.name}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {formatPrice(service.price, service.currency)} —{" "}
                {service.durationMinutes} دقیقه
                {service.depositType !== "NONE" && (
                  <span> — نیاز به بیعانه</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">انتخاب تاریخ</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {nextDays.map((d) => {
            const iso = toISODate(d);
            const label = d.toLocaleDateString(locale, {
              weekday: "short",
              day: "numeric",
              month: "short",
            });
            return (
              <button
                key={iso}
                type="button"
                onClick={() => setDate(iso)}
                className={`shrink-0 rounded-lg border px-3 py-2 text-xs whitespace-nowrap ${
                  date === iso
                    ? "border-primary bg-primary/10 font-medium"
                    : "bg-background"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">زمان‌های آزاد</p>
        {loadingSlots ? (
          <p className="text-sm text-muted-foreground">در حال بارگذاری...</p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            زمان آزادی برای این روز نیست.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {slots.map((slot) => {
              const time = new Date(slot);
              const label = time.toLocaleTimeString(locale, {
                hour: "2-digit",
                minute: "2-digit",
              });
              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() => setSelectedSlot(slot)}
                  className={`rounded-lg border px-2 py-2 text-sm ${
                    selectedSlot === slot
                      ? "border-primary bg-primary/10"
                      : "bg-background"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selectedSlot && (
        <div className="space-y-3 rounded-xl border p-4">
          <p className="text-sm font-medium">اطلاعات شما</p>
          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="نام و نام خانوادگی"
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none"
          />
          <input
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            placeholder="شماره تلفن"
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none"
          />
          <input
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
            placeholder="ایمیل (اختیاری)"
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none"
          />
          <button
            type="button"
            onClick={submitBooking}
            disabled={submitting}
            className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {submitting
              ? "در حال ثبت..."
              : `تأیید رزرو — ${
                  selectedService
                    ? formatPrice(selectedService.price, selectedService.currency)
                    : ""
                }`}
          </button>
        </div>
      )}
    </div>
  );
}
