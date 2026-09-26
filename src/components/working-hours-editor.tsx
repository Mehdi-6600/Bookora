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
  const map = new Map(
    loaded.map((day) => [day.dayOfWeek, day])
  );

  return buildDefaultWeek().map((defaultDay) => {
    const existing = map.get(defaultDay.dayOfWeek);

    if (!existing) {
      return defaultDay;
    }

    return {
      dayOfWeek: defaultDay.dayOfWeek,
      enabled: existing.enabled,
      openTime: existing.openTime,
      closeTime: existing.closeTime,
      breakStart: existing.breakStart ?? null,
      breakEnd: existing.breakEnd ?? null,
    };
  });
}

function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validateDays(days: WorkingHour[]): string | null {
  if (days.length !== 7) {
    return "اطلاعات هفت روز هفته کامل نیست.";
  }

  for (const day of days) {
    if (!isValidTime(day.openTime) || !isValidTime(day.closeTime)) {
      return `ساعت کاری ${DAY_LABELS[day.dayOfWeek]} معتبر نیست.`;
    }

    if (day.enabled && day.openTime >= day.closeTime) {
      return `ساعت شروع ${DAY_LABELS[day.dayOfWeek]} باید قبل از ساعت پایان باشد.`;
    }

    if (day.breakStart && !isValidTime(day.breakStart)) {
      return `شروع زمان استراحت ${DAY_LABELS[day.dayOfWeek]} معتبر نیست.`;
    }

    if (day.breakEnd && !isValidTime(day.breakEnd)) {
      return `پایان زمان استراحت ${DAY_LABELS[day.dayOfWeek]} معتبر نیست.`;
    }

    if (day.breakStart && day.breakEnd) {
      if (day.breakStart >= day.breakEnd) {
        return `زمان استراحت ${DAY_LABELS[day.dayOfWeek]} معتبر نیست.`;
      }

      if (
        day.enabled &&
        (day.breakStart < day.openTime ||
          day.breakEnd > day.closeTime)
      ) {
        return `زمان استراحت ${DAY_LABELS[day.dayOfWeek]} باید داخل ساعات کاری باشد.`;
      }
    }
  }

  return null;
}

export function WorkingHoursEditor({
  businessId,
  onSaved,
}: {
  businessId: string;
  onSaved?: () => void;
}) {
  const [days, setDays] = useState<WorkingHour[]>(
    buildDefaultWeek()
  );

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) {
      setLoading(false);
      setError("شناسه کسب‌وکار موجود نیست.");
      return;
    }

    let cancelled = false;

    async function loadWorkingHours() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(
          `/api/working-hours?businessId=${encodeURIComponent(
            businessId
          )}`,
          {
            method: "GET",
            cache: "no-store",
          }
        );

        let data: unknown = null;

        try {
          data = await response.json();
        } catch {
          data = null;
        }

        if (!response.ok) {
          const apiError =
            typeof data === "object" &&
            data !== null &&
            "error" in data &&
            typeof data.error === "string"
              ? data.error
              : "خطا در دریافت ساعت کاری.";

          throw new Error(apiError);
        }

        if (cancelled) {
          return;
        }

        const workingHours =
          typeof data === "object" &&
          data !== null &&
          "workingHours" in data &&
          Array.isArray(data.workingHours)
            ? data.workingHours
            : [];

        setDays(
          mergeWithDefaults(
            workingHours as WorkingHour[]
          )
        );
      } catch (error) {
        if (cancelled) {
          return;
        }

        setError(
          error instanceof Error
            ? error.message
            : "خطا در دریافت ساعت کاری."
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadWorkingHours();

    return () => {
      cancelled = true;
    };
  }, [businessId]);

  function updateDay(
    index: number,
    patch: Partial<WorkingHour>
  ) {
    setDays((current) =>
      current.map((day, currentIndex) =>
        currentIndex === index
          ? { ...day, ...patch }
          : day
      )
    );

    setMessage(null);
    setError(null);
  }

  async function save() {
    const validationError = validateDays(days);

    if (validationError) {
      setError(validationError);
      setMessage(null);
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setMessage(null);

      const response = await fetch("/api/working-hours", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          businessId,
          days,
        }),
      });

      let data: unknown = null;

      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        const apiError =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : "ذخیره ساعت کاری ناموفق بود.";

        throw new Error(apiError);
      }

      if (
        typeof data === "object" &&
        data !== null &&
        "workingHours" in data &&
        Array.isArray(data.workingHours)
      ) {
        setDays(
          mergeWithDefaults(
            data.workingHours as WorkingHour[]
          )
        );
      }

      setMessage("ساعت کاری با موفقیت ذخیره شد.");

      onSaved?.();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "ذخیره ساعت کاری ناموفق بود."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
      <div>
        <h2 className="text-xl font-bold">
          ساعت کاری
        </h2>

        <p className="mt-1 text-sm text-muted-foreground">
          روزها و ساعت‌هایی که مشتری می‌تواند رزرو کند.
        </p>

        <p className="mt-2 text-xs text-muted-foreground">
          Business ID: {businessId}
        </p>
      </div>

      {loading && (
        <div className="rounded-xl border bg-background p-3 text-sm text-muted-foreground">
          در حال دریافت ساعت کاری...
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">
            {error}
          </p>
        </div>
      )}

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
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={day.enabled}
                  onChange={(event) =>
                    updateDay(index, {
                      enabled: event.target.checked,
                    })
                  }
                  className="h-4 w-4"
                />

                {DAY_LABELS[day.dayOfWeek]}
              </label>

              <span className="text-xs text-muted-foreground">
                {day.enabled ? "فعال" : "تعطیل"}
              </span>
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
                      updateDay(index, {
                        openTime: event.target.value,
                      })
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
                      updateDay(index, {
                        closeTime: event.target.value,
                      })
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
        disabled={saving || loading || !businessId}
        className="w-full rounded-xl bg-primary px-4 py-3 font-medium text-primary-foreground disabled:opacity-50"
      >
        {saving
          ? "در حال ذخیره..."
          : "ذخیره ساعت کاری"}
      </button>
    </section>
  );
}
