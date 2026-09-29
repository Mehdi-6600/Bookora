"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  CalendarOff,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";

type TimeOff = {
  id: string;
  startAt: string;
  endAt: string;
  reason: string | null;
};

const CARD_MAIN = "rounded-3xl bg-[#B8D4F5] p-5 shadow-soft";

const CARD_INNER = "rounded-2xl bg-white p-4 shadow-soft";

const BTN_PRIMARY =
  "btn-elevated flex w-full items-center justify-center gap-2 rounded-2xl bg-[#4F5FE8] px-4 py-4 text-base font-bold text-white transition-transform active:scale-[0.98] disabled:opacity-50";

const BTN_DELETE =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#FF4D5E] text-white shadow-soft transition-transform active:scale-95";

const INPUT_BASE =
  "w-full rounded-2xl bg-white px-4 py-3 text-sm font-medium text-[#1A1F36] outline-none placeholder:text-[#1A1F36]/40 shadow-soft";

const SECTION_ICON =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-soft";

const SECTION_TITLE = "text-base font-bold text-[#1A1F36]";

const LABEL_SMALL =
  "mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[#1A1F36]/60";

const BOX_ERROR =
  "flex items-start gap-2 rounded-2xl bg-[#FF4D5E] p-3.5 text-sm font-medium text-white shadow-soft";

export function TimeOffPanel({ businessId }: { businessId: string }) {
  const t = useTranslations("timeOff");
  const locale = useLocale();

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
      const response = await fetch(
        `/api/time-off?businessId=${businessId}`,
        { cache: "no-store" }
      );
      const data = await response.json();
      if (response.ok) setItems(data.timeOffs);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  async function add() {
    if (!startAt || !endAt) {
      setError(t("requiredError"));
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
      if (!response.ok) throw new Error(data?.error || t("addError"));
      setStartAt("");
      setEndAt("");
      setReason("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("addError"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/time-off/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <section className={CARD_MAIN}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className={SECTION_ICON}>
          <CalendarOff className="h-5 w-5 text-[#4F5FE8]" />
        </span>
        <div className="min-w-0">
          <h2 className={SECTION_TITLE}>{t("title")}</h2>
          <p className="mt-0.5 text-xs font-medium text-[#1A1F36]/60">
            {t("subtitle")}
          </p>
        </div>
      </div>

      {/* Error */}
      {error && <div className={BOX_ERROR + " mt-4"}>{error}</div>}

      {/* Add form */}
      <div className={CARD_INNER + " mt-4"}>
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#4F5FE8]/10">
            <Plus className="h-4 w-4 text-[#4F5FE8]" />
          </span>
          <h3 className="text-sm font-bold text-[#1A1F36]">
            {t("addButton")}
          </h3>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL_SMALL}>{t("startLabel")}</label>
              <input
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                className={INPUT_BASE + " tabular"}
              />
            </div>
            <div>
              <label className={LABEL_SMALL}>{t("endLabel")}</label>
              <input
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                className={INPUT_BASE + " tabular"}
              />
            </div>
          </div>

          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("reasonPlaceholder")}
            className={INPUT_BASE}
          />

          <button
            type="button"
            onClick={add}
            disabled={saving}
            className={BTN_PRIMARY}
          >
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("adding")}
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <Plus className="h-5 w-5" />
                {t("addButton")}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-white py-6 text-sm font-medium text-[#1A1F36]/60 shadow-soft">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("loading")}
        </div>
      ) : items.length === 0 ? (
        <div className="mt-4 rounded-2xl bg-white py-8 text-center shadow-soft">
          <CalendarOff className="mx-auto h-6 w-6 text-[#1A1F36]/30" />
          <p className="mt-2 text-sm font-medium text-[#1A1F36]/50">
            {t("empty")}
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((item) => {
            const startLabel = new Date(item.startAt).toLocaleString(locale, {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
            const endLabel = new Date(item.endAt).toLocaleString(locale, {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });

            return (
              <article key={item.id} className={CARD_INNER}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#FCA311]/15">
                        <CalendarOff className="h-4 w-4 text-[#FCA311]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold text-[#1A1F36]">
                          <span className="tabular">{startLabel}</span>
                          <span className="text-[#1A1F36]/50">
                            {t("toLabel")}
                          </span>
                          <span className="tabular">{endLabel}</span>
                        </div>

                        {item.reason && (
                          <p className="mt-1.5 text-xs font-medium text-[#1A1F36]/70">
                            {item.reason}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => remove(item.id)}
                    aria-label={t("deleteButton")}
                    title={t("deleteButton")}
                    className={BTN_DELETE}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
