"use client";

import { useEffect, useState } from "react";

type PaymentMethod = {
  accountHolder: string | null;
  bankName: string | null;
  cardNumber: string | null;
  instructions: string | null;
};

export function PaymentMethodPanel({ businessId }: { businessId: string }) {
  const [data, setData] = useState<PaymentMethod>({
    accountHolder: "",
    bankName: "",
    cardNumber: "",
    instructions: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const response = await fetch(
          `/api/payment-methods?businessId=${businessId}`,
          { cache: "no-store" }
        );
        const result = await response.json();
        if (response.ok && result.paymentMethod) {
          setData(result.paymentMethod);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [businessId]);

  async function save() {
    try {
      setSaving(true);
      setMessage(null);

      const response = await fetch("/api/payment-methods", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, ...data }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result?.error || "ذخیره ناموفق بود.");
      }

      setMessage("ذخیره شد.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "ذخیره ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
      <div>
        <h2 className="text-xl font-bold">روش دریافت بیعانه</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          این اطلاعات هنگام رزرو، در صورت نیاز به بیعانه، به مشتری نشان داده
          می‌شود.
        </p>
      </div>

      {message && (
        <div className="rounded-lg bg-muted p-3 text-sm">{message}</div>
      )}

      {!loading && (
        <>
          <input
            value={data.accountHolder || ""}
            onChange={(e) => setData({ ...data, accountHolder: e.target.value })}
            placeholder="نام صاحب حساب"
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none"
          />
          <input
            value={data.bankName || ""}
            onChange={(e) => setData({ ...data, bankName: e.target.value })}
            placeholder="نام بانک"
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none"
          />
          <input
            value={data.cardNumber || ""}
            onChange={(e) => setData({ ...data, cardNumber: e.target.value })}
            placeholder="شماره کارت"
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none"
          />
          <textarea
            value={data.instructions || ""}
            onChange={(e) => setData({ ...data, instructions: e.target.value })}
            placeholder="توضیح اضافی برای مشتری (اختیاری)"
            className="min-h-16 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none"
          />

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving ? "در حال ذخیره..." : "ذخیره"}
          </button>
        </>
      )}
    </section>
  );
}
