"use client";

import { useEffect, useState } from "react";

type WorkingHour = {
  dayOfWeek: number;
  enabled: boolean;
  openTime: string;
  closeTime: string;
  breakStart: string | null;
  breakEnd: string | null;
};

const DAY_LABELS = [
  "یکشنبه",
  "دوشنبه",
  "سه‌شنبه",
  "چهارشنبه",
  "پنجشنبه",
  "جمعه",
  "شنبه",
];

const DEFAULT_DAY: WorkingHour = {
  dayOfWeek: 0,
  enabled: false,
  openTime: "09:00",
  closeTime: "18:00",
  breakStart: null,
  breakEnd: null,
};

function buildDefaultWeek(): WorkingHour[] {
  return Array.from({ length: 7 }, (_, index) => ({
    ...DEFAULT_DAY,
    dayOfWeek: index,
    enabled: index >= 1 && index <= 5,
  }));
}

function mergeWithDefaults(loaded: WorkingHour[]): WorkingHour[] {
  const map = new Map(loaded.map((day) => [day.dayOfWeek, day]));
  return buildDefaultWeek().map((defaultDay) => {
    const existing = map.get(defaultDay.dayOfWeek);
    return existing
      ? {
          dayOfWeek: defaultDay.dayOfWeek,
          enabled: existing.enabled,
          openTime: existing.openTime,
          closeTime: existing.closeTime,
          breakStart: existing.breakStart,
          breakEnd: existing.breakEnd,
        }
      : defaultDay;
  });
}

export function WorkingHoursEditor({
  businessId,
  onSaved,
}: {
  businessId: string;
  onSaved?: () => void;
}) {
  const [days, setDays] = useState<WorkingHour[]>(buildDefaultWeek());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setMessage(null);

        const res = await fetch(
          `/api/working-hours?businessId=${encodeURIComponent(businessId)}`,
          { cache: "no-store" }
        );

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data?.error || "خطا در دریافت ساعت کاری");
        }

        if (!cancelled) {
          setDays(mergeWithDefaults(data.workingHours || []));
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error ? error.message : "خطای ناشناخته"
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [businessId]);

  function updateDay(index: number, patch: Partial<WorkingHour>) {
    setDays((current) =>
      current.map((day, i) => (i === index ? { ...day, ...patch } : day))
    );
  }

  async function save() {
    try {
      setSaving(true);
      setMessage(null);

      const res = await fetch("/api/working-hours", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, days }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "ذخیره ناموفق بود.");
      }

      setMessage("ساعت کاری ذخیره شد.");
      onSaved?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "خطای ناشناخته");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
        در حال بارگذاری...
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
      <div>
        <h2 className="text-xl font-bold">ساعت کاری</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          روزها و ساعت‌هایی که مشتری می‌تواند رزرو کند.
        </p>
      </div>

      {message && (
        <div className="rounded-xl border bg-background p-3 text-sm">
          {message}
        </div>
      )}

      <div className="space-y-3">
        {days.map((day, index) => (
          <div
            key={day.dayOfWeek}
            className="rounded-xl border bg-background p-4"
          >
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={day.enabled}
                  onChange={(event) =>
                    updateDay(index, { enabled: event.target.checked })
                  }
                  className="h-4 w-4"
                />
                {DAY_LABELS[day.dayOfWeek]}
              </label>
            </div>

            {day.enabled && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">
                    شروع
                  </span>
                  <input
                    type="time"
                    value={day.openTime}
                    onChange={(event) =>
                      updateDay(index, { openTime: event.target.value })
                    }
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none"
                  />
                </label>

                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">
                    پایان
                  </span>
                  <input
                    type="time"
                    value={day.closeTime}
                    onChange={(event) =>
                      updateDay(index, { closeTime: event.target.value })
                    }
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none"
                  />
                </label>
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="w-full rounded-xl bg-primary px-4 py-3 font-medium text-primary-foreground disabled:opacity-50"
      >
        {saving ? "در حال ذخیره..." : "ذخیره ساعت کاری"}
      </button>
    </div>
  );
}
