"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type WorkingHour = {
  dayOfWeek: number;
  enabled: boolean;
  openTime: string;
  closeTime: string;
  breakStart: string | null;
  breakEnd: string | null;
};

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
    if (!existing) return defaultDay;
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

export function WorkingHoursEditor({ businessId }: { businessId: string }) {
  const t = useTranslations("workingHours");
  const dayLabels = [0, 1, 2, 3, 4, 5, 6].map((i) => t(`days.${i}`));

  const [days, setDays] = useState<WorkingHour[]>(buildDefaultWeek());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(
          `/api/working-hours?businessId=${encodeURIComponent(businessId)}`,
          { cache: "no-store" }
        );
        let data: unknown = null;
        try {
          data = await response.json();
        } catch {
          data = null;
        }
        if (!response.ok) {
          const apiError =
            typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
              ? data.error
              : t("loading");
          throw new Error(apiError);
        }
        if (cancelled) return;
        const workingHours =
          typeof data === "object" && data !== null && "workingHours" in data && Array.isArray(data.workingHours)
            ? data.workingHours
            : [];
        setDays(mergeWithDefaults(workingHours as WorkingHour[]));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t("loading"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [businessId, t]);

  function updateDay(index: number, patch: Partial<WorkingHour>) {
    setDays((current) =>
      current.map((day, i) => (i === index ? { ...day, ...patch } : day))
    );
    setMessage(null);
    setError(null);
  }

  function validateDays(list: WorkingHour[]): string | null {
    for (const day of list) {
      if (!isValidTime(day.openTime) || !isValidTime(day.closeTime)) {
        return `${dayLabels[day.dayOfWeek]}`;
      }
    }
    return null;
  }

  async function save() {
    const validationError = validateDays(days);
    if (validationError) {
      setError(validationError);
      return;
    }
    try {
      setSaving(true);
      setError(null);
      setMessage(null);
      const response = await fetch("/api/working-hours", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, days }),
      });
      let data: unknown = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      if (!response.ok) {
        const apiError =
          typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
            ? data.error
            : t("saved");
        throw new Error(apiError);
      }
      if (typeof data === "object" && data !== null && "workingHours" in data && Array.isArray(data.workingHours)) {
        setDays(mergeWithDefaults(data.workingHours as WorkingHour[]));
      }
      setMessage(t("saved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saved"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
      <div>
        <h2 className="text-xl font-bold">{t("title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("businessId", { id: businessId })}
        </p>
      </div>

      {loading && (
        <div className="rounded-xl border bg-background p-3 text-sm text-muted-foreground">
          {t("loading")}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {message && (
        <div className="rounded-xl border bg-background p-3 text-sm">{message}</div>
      )}

      <div className="space-y-3">
        {days.map((day, index) => (
          <div key={day.dayOfWeek} className="rounded-xl border bg-background p-4">
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={day.enabled}
                  onChange={(e) => updateDay(index, { enabled: e.target.checked })}
                  className="h-4 w-4"
                />
                {dayLabels[day.dayOfWeek]}
              </label>
              <span className="text-xs text-muted-foreground">
                {day.enabled ? t("active") : t("closed")}
              </span>
            </div>

            {day.enabled && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">{t("start")}</span>
                  <input
                    type="time"
                    value={day.openTime}
                    onChange={(e) => updateDay(index, { openTime: e.target.value })}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none"
                  />
                </label>
                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">{t("end")}</span>
                  <input
                    type="time"
                    value={day.closeTime}
                    onChange={(e) => updateDay(index, { closeTime: e.target.value })}
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
        {saving ? t("saving") : t("saveButton")}
      </button>
    </section>
  );
}
