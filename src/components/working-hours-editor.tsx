"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Clock, Loader2 } from "lucide-react";

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

  const enabledCount = days.filter((day) => day.enabled).length;

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-soft">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Clock className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{t("title")}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {enabledCount} / 7
        </span>
      </header>

      <p className="mt-3 break-all text-[11px] text-muted-foreground/80">
        {t("businessId", { id: businessId })}
      </p>

      {loading && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-border/60 bg-background p-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("loading")}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {message && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-400">
          <Check className="h-4 w-4 shrink-0" />
          {message}
        </div>
      )}

      <div className="mt-4 space-y-2">
        {days.map((day, index) => {
          const active = day.enabled;
          return (
            <div
              key={day.dayOfWeek}
              className={`rounded-xl border p-3 transition-colors ${
                active
                  ? "border-border/60 bg-background"
                  : "border-border/40 bg-muted/20"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <label className="flex flex-1 cursor-pointer items-center gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={active}
                    onClick={() => updateDay(index, { enabled: !active })}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ring-focus ${
                      active ? "bg-primary" : "bg-muted-foreground/30"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform ${
                        active
                          ? "translate-x-4 rtl:-translate-x-4"
                          : "translate-x-0.5 rtl:-translate-x-0.5"
                      }`}
                    />
                  </button>
                  <span
                    className={`text-sm ${
                      active
                        ? "font-semibold text-foreground"
                        : "font-medium text-muted-foreground"
                    }`}
                  >
                    {dayLabels[day.dayOfWeek]}
                  </span>
                </label>

                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    active
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {active ? t("active") : t("closed")}
                </span>
              </div>

              {active && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="block text-xs">
                    <span className="mb-1 block text-muted-foreground">
                      {t("start")}
                    </span>
                    <input
                      type="time"
                      value={day.openTime}
                      onChange={(e) =>
                        updateDay(index, { openTime: e.target.value })
                      }
                      className="ring-focus w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm tabular outline-none"
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="mb-1 block text-muted-foreground">
                      {t("end")}
                    </span>
                    <input
                      type="time"
                      value={day.closeTime}
                      onChange={(e) =>
                        updateDay(index, { closeTime: e.target.value })
                      }
                      className="ring-focus w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm tabular outline-none"
                    />
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={save}
        disabled={saving || loading || !businessId}
        className="ring-focus mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        {saving ? t("saving") : t("saveButton")}
      </button>
    </section>
  );
}
