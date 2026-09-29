"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Check,
  Clock,
  Loader2,
  Power,
  Sun,
} from "lucide-react";

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

const CARD_MAIN =
  "rounded-3xl bg-[#B8D4F5] p-5 shadow-soft";

const CARD_DAY_ACTIVE =
  "rounded-2xl bg-white p-4 shadow-soft transition-all";

const CARD_DAY_INACTIVE =
  "rounded-2xl bg-white/50 p-4 shadow-soft transition-all";

const BTN_PRIMARY =
  "btn-elevated w-full rounded-2xl bg-[#4F5FE8] px-4 py-4 text-base font-bold text-white transition-transform active:scale-[0.98] disabled:opacity-50";

const INPUT_TIME =
  "w-full rounded-2xl bg-white px-3 py-3 text-base font-semibold text-[#1A1F36] tabular text-center outline-none shadow-soft";

const SECTION_ICON =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-soft";

const SECTION_TITLE = "text-base font-bold text-[#1A1F36]";

const BADGE_ACTIVE =
  "inline-flex items-center gap-1 rounded-full bg-[#34C759] px-2.5 py-1 text-[11px] font-bold text-white shadow-soft";

const BADGE_INACTIVE =
  "inline-flex items-center gap-1 rounded-full bg-[#1A1F36]/15 px-2.5 py-1 text-[11px] font-bold text-[#1A1F36]/60";

const LABEL_SMALL =
  "mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[#1A1F36]/60";

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

export function WorkingHoursEditor({
  businessId,
}: {
  businessId: string;
}) {
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
            typeof data === "object" &&
            data !== null &&
            "error" in data &&
            typeof data.error === "string"
              ? data.error
              : t("loading");
          throw new Error(apiError);
        }
        if (cancelled) return;
        const workingHours =
          typeof data === "object" &&
          data !== null &&
          "workingHours" in data &&
          Array.isArray(data.workingHours)
            ? data.workingHours
            : [];
        setDays(mergeWithDefaults(workingHours as WorkingHour[]));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t("loading"));
        }
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
        return dayLabels[day.dayOfWeek];
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
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : t("saved");
        throw new Error(apiError);
      }
      if (
        typeof data === "object" &&
        data !== null &&
        "workingHours" in data &&
        Array.isArray(data.workingHours)
      ) {
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
    <section className={CARD_MAIN}>
      {/* Header */}
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={SECTION_ICON}>
            <Clock className="h-5 w-5 text-[#4F5FE8]" />
          </span>
          <div className="min-w-0">
            <h2 className={SECTION_TITLE}>{t("title")}</h2>
            <p className="mt-0.5 text-xs font-medium text-[#1A1F36]/60">
              {t("subtitle")}
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-bold text-[#4F5FE8] shadow-soft">
          {enabledCount} / 7
        </span>
      </header>

      {/* Loading */}
      {loading && (
        <div className="mt-5 flex items-center justify-center gap-2 rounded-2xl bg-white py-4 text-sm font-medium text-[#1A1F36]/60 shadow-soft">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("loading")}
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="mt-5 rounded-2xl bg-[#FF4D5E] px-4 py-3 text-sm font-medium text-white shadow-soft">
          {error}
        </div>
      )}

      {/* Success */}
      {message && (
        <div className="mt-5 flex items-center gap-2 rounded-2xl bg-[#34C759] px-4 py-3 text-sm font-bold text-white shadow-soft">
          <Check className="h-4 w-4 shrink-0" />
          {message}
        </div>
      )}

      {/* Days */}
      {!loading && (
        <div className="mt-5 space-y-3">
          {days.map((day, index) => {
            const active = day.enabled;
            const cardCls = active ? CARD_DAY_ACTIVE : CARD_DAY_INACTIVE;
            const badgeCls = active ? BADGE_ACTIVE : BADGE_INACTIVE;
            return (
              <div key={day.dayOfWeek} className={cardCls}>
                {/* Row: switch + label + badge */}
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => updateDay(index, { enabled: !active })}
                    className="flex flex-1 items-center gap-3 text-start ring-focus"
                  >
                    {/* Switch */}
                    <span
                      role="switch"
                      aria-checked={active}
                      className={
                        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors " +
                        (active ? "bg-[#4F5FE8]" : "bg-[#1A1F36]/20")
                      }
                    >
                      <span
                        className={
                          "inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform " +
                          (active
                            ? "translate-x-6 rtl:-translate-x-6"
                            : "translate-x-1 rtl:-translate-x-1")
                        }
                      />
                    </span>

                    {/* Day name */}
                    <span
                      className={
                        "text-base font-bold " +
                        (active ? "text-[#1A1F36]" : "text-[#1A1F36]/40")
                      }
                    >
                      {dayLabels[day.dayOfWeek]}
                    </span>
                  </button>

                  {/* Badge */}
                  <span className={badgeCls}>
                    <Power className="h-3 w-3" />
                    {active ? t("active") : t("closed")}
                  </span>
                </div>

                {/* Time inputs (only when active) */}
                {active && (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div>
                      <label className={LABEL_SMALL}>{t("start")}</label>
                      <input
                        type="time"
                        value={day.openTime}
                        onChange={(e) =>
                          updateDay(index, { openTime: e.target.value })
                        }
                        className={INPUT_TIME}
                      />
                    </div>
                    <div>
                      <label className={LABEL_SMALL}>{t("end")}</label>
                      <input
                        type="time"
                        value={day.closeTime}
                        onChange={(e) =>
                          updateDay(index, { closeTime: e.target.value })
                        }
                        className={INPUT_TIME}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Save button */}
      <button
        type="button"
        onClick={save}
        disabled={saving || loading || !businessId}
        className={BTN_PRIMARY + " mt-5"}
      >
        {saving ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("saving")}
          </span>
        ) : (
          <span className="flex items-center justify-center gap-2">
            <Sun className="h-5 w-5" />
            {t("saveButton")}
          </span>
        )}
      </button>
    </section>
  );
}
