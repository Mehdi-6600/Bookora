"use client";

import { useEffect, useState } from "react";
import { formatPrice } from "@/lib/currency";

type Booking = {
  id: string;
  serviceName: string;
  customerName: string;
  customerPhone: string;
  startAt: string;
  status: string;
  paymentStatus: string;
  depositDue: string;
  currency: string;
  payment: { id: string; status: string; transactionReference: string | null } | null;
};

export function BookingsPanel({ businessId }: { businessId: string }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const response = await fetch(`/api/bookings?businessId=${businessId}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (response.ok) setBookings(data.bookings);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [businessId]);

  async function review(
    bookingId: string,
    paymentId: string,
    action: "approve" | "reject"
  ) {
    try {
      setReviewingId(paymentId);
      await fetch(`/api/bookings/${bookingId}/payments/${paymentId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await load();
    } finally {
      setReviewingId(null);
    }
  }

  if (loading) {
    return (
      <section className="rounded-2xl border bg-card p-5 shadow-sm text-sm text-muted-foreground">
        در حال بارگذاری رزروها...
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
      <h2 className="text-xl font-bold">رزروها</h2>

      {bookings.length === 0 ? (
        <p className="text-sm text-muted-foreground">هنوز رزروی ثبت نشده.</p>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => (
            <div key={b.id} className="rounded-xl border p-4 text-sm">
              <p className="font-semibold">
                {b.serviceName} — {b.customerName}
              </p>
              <p className="mt-1 text-muted-foreground">
                {new Date(b.startAt).toLocaleString("fa-IR")} — {b.customerPhone}
              </p>
              <p className="mt-1 text-muted-foreground">
                وضعیت: {b.status} / پرداخت: {b.paymentStatus}
              </p>

              {Number(b.depositDue) > 0 && (
                <p className="mt-1">
                  بیعانه: {formatPrice(b.depositDue, b.currency)}
                </p>
              )}

              {b.payment && b.payment.status === "PENDING" && (
                <div className="mt-3 rounded-lg bg-muted p-3">
                  <p className="text-xs text-muted-foreground">
                    کد رهگیری ارسالی:{" "}
                    {b.payment.transactionReference || "هنوز ارسال نشده"}
                  </p>

                  {b.payment.transactionReference && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => review(b.id, b.payment!.id, "approve")}
                        disabled={reviewingId === b.payment.id}
                        className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
                      >
                        تأیید پرداخت
                      </button>
                      <button
                        type="button"
                        onClick={() => review(b.id, b.payment!.id, "reject")}
                        disabled={reviewingId === b.payment.id}
                        className="rounded-lg border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive disabled:opacity-50"
                      >
                        رد
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
