"use client";

import { useEffect, useState } from "react";

type TimeOff = {
  id: string;
  startAt: string;
  endAt: string;
  reason: string | null;
};

export function TimeOffPanel({ businessId }: { businessId: string }) {
  const [items, setItems] = useState<TimeOff[]>([]);
  const [loading, setLoading] = useState(true);
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const response = await fetch(`/api/time-off?businessId=${businessId}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (response.ok) setItems(data.timeOffs);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [businessId]);

  async function add() {
    if (!startAt || !endAt) {
      setError("تاریخ شروع و پایان را وارد کنید.");
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const response = await fetch("/api/time-off", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          startAt: new Date(startAt).toISOString(),
          endAt: new Date(endAt).toISOString(),
          reason: reason.trim() || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "ثبت تعطیلی ناموفق بود.");
      }

      setStartAt("");
      setEndAt("");
      setReason("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت تعطیلی ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/time-off/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
      <div>
        <h2 className="text-xl font-bold">تعطیلات و مرخصی</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          بازه‌هایی که کسب‌وکار قابل رزرو نیست.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <input
          type="datetime-local"
          value={startAt}
          onChange={(e) => setStartAt(e.target.value)}
          className="rounded-lg border bg-background px-3 py-2 text-sm outline-none"
        />
        <input
          type="datetime-local"
          value={endAt}
          onChange={(e) => setEndAt(e.target.value)}
          className="rounded-lg border bg-background px-3 py-2 text-sm outline-none"
        />
      </div>

      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="دلیل (اختیاری)"
        className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none"
      />

      <button
        type="button"
        onClick={add}
        disabled={saving}
        className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {saving ? "در حال ثبت..." : "افزودن تعطیلی"}
      </button>

      {!loading && items.length > 0 && (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between rounded-lg border p-3 text-sm"
            >
              <div>
                <p>
                  {new Date(item.startAt).toLocaleString("fa-IR")} تا{" "}
                  {new Date(item.endAt).toLocaleString("fa-IR")}
                </p>
                {item.reason && (
                  <p className="text-muted-foreground">{item.reason}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => remove(item.id)}
                className="rounded-lg border border-destructive/30 px-2 py-1 text-xs text-destructive"
              >
                حذف
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
