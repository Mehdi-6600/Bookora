"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarOff, Loader2, Plus, Trash2 } from "lucide-react";

type Holiday = { id: string; date: string; reason: string | null };

const CARD_MAIN = "rounded-3xl bg-[#B8D4F5] p-5 shadow-soft";
const INPUT_BASE =
  "w-full rounded-2xl bg-white px-4 py-3 text-sm font-medium text-[#1A1F36] outline-none shadow-soft";

export function HolidayPanel({ businessId }: { businessId: string }) {
  const t = useTranslations("holiday");
  const locale = useLocale();
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const response = await fetch(
        `/api/holidays?businessId=${encodeURIComponent(businessId)}`,
        { cache: "no-store" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || t("loadError"));
      setHolidays(Array.isArray(data.holidays) ? data.holidays : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadError"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  async function addHoliday() {
    if (!date) {
      setError(t("dateRequired"));
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const response = await fetch("/api/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          date,
          reason: reason.trim() || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || t("saveError"));
      setDate("");
      setReason("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function removeHoliday(id: string) {
    try {
      setRemovingId(id);
      setError(null);
      const response = await fetch(`/api/holidays/${id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || t("removeError"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("removeError"));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section className={CARD_MAIN}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-soft">
          <CalendarOff className="h-5 w-5 text-[#4F5FE8]" />
        </span>
        <div>
          <h2 className="text-base font-bold text-[#1A1F36]">{t("title")}</h2>
          <p className="mt-1 text-xs font-medium text-[#1A1F36]/60">
            {t("subtitle")}
          </p>
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-4 rounded-2xl bg-[#FF4D5E] p-3.5 text-sm font-medium text-white">
          {error}
        </div>
      )}

      <div className="mt-4 space-y-3 rounded-2xl bg-white p-4 shadow-soft">
        <input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className={INPUT_BASE + " tabular"}
          aria-label={t("dateLabel")}
        />
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={500}
          placeholder={t("reasonPlaceholder")}
          className={INPUT_BASE}
        />
        <button
          type="button"
          onClick={addHoliday}
          disabled={saving}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#4F5FE8] px-4 py-3.5 text-sm font-bold text-white shadow-soft disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {saving ? t("saving") : t("addButton")}
        </button>
      </div>

      {loading ? (
        <div className="mt-4 flex justify-center rounded-2xl bg-white py-6 text-sm text-[#1A1F36]/60 shadow-soft">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : holidays.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-white p-4 text-center text-sm text-[#1A1F36]/60 shadow-soft">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {holidays.map((holiday) => (
            <li key={holiday.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-soft">
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#1A1F36]">
                  {new Date(`${holiday.date}T00:00:00.000Z`).toLocaleDateString(locale, {
                    timeZone: "UTC",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
                {holiday.reason && (
                  <p className="mt-1 break-words text-xs text-[#1A1F36]/65">{holiday.reason}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeHoliday(holiday.id)}
                disabled={removingId === holiday.id}
                aria-label={t("removeButton")}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FF4D5E] text-white disabled:opacity-50"
              >
                {removingId === holiday.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
