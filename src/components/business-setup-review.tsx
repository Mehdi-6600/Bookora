"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  CalendarDays,
  Clock3,
  Loader2,
  RefreshCw,
  Scissors,
} from "lucide-react";
import { formatPrice } from "@/lib/currency";

type SetupService = {
  id: string;
  name: string;
  description: string | null;
  price: string;
  currency: string;
  durationMinutes: number;
  active: boolean;
};

type WorkingHour = {
  dayOfWeek: number;
  enabled: boolean;
  openTime: string;
  closeTime: string;
  breakStart: string | null;
  breakEnd: string | null;
};

type Holiday = { id: string; date: string; reason: string | null };

type Props = {
  businessId: string;
  name: string;
  description: string | null;
  timezone: string;
  services: SetupService[];
  actionLabel: string;
  actionLoading: boolean;
  onComplete: () => void;
};

const CARD_MAIN = "rounded-3xl bg-[#B8D4F5] p-5 shadow-soft";
const BTN_PRIMARY =
  "btn-elevated flex w-full items-center justify-center gap-2 rounded-2xl bg-[#4F5FE8] px-4 py-3.5 text-sm font-bold text-white transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

export function BusinessSetupReview({
  businessId,
  name,
  description,
  timezone,
  services,
  actionLabel,
  actionLoading,
  onComplete,
}: Props) {
  const t = useTranslations("businessSetup");
  const tHours = useTranslations("workingHours");
  const tService = useTranslations("service");
  const locale = useLocale();
  const [hours, setHours] = useState<WorkingHour[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadReviewData() {
      try {
        setLoading(true);
        setError(null);
        const [hoursResponse, holidaysResponse] = await Promise.all([
          fetch(
            `/api/working-hours?businessId=${encodeURIComponent(businessId)}`,
            { cache: "no-store" }
          ),
          fetch(
            `/api/holidays?businessId=${encodeURIComponent(businessId)}`,
            { cache: "no-store" }
          ),
        ]);
        const [hoursData, holidaysData] = await Promise.all([
          hoursResponse.json(),
          holidaysResponse.json(),
        ]);
        if (!hoursResponse.ok || !holidaysResponse.ok) {
          throw new Error(
            hoursData?.error || holidaysData?.error || t("loadError")
          );
        }
        if (cancelled) return;
        setHours(
          Array.isArray(hoursData.workingHours) ? hoursData.workingHours : []
        );
        setHolidays(Array.isArray(holidaysData.holidays) ? holidaysData.holidays : []);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : t("loadError")
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadReviewData();
    return () => {
      cancelled = true;
    };
  }, [businessId, reloadKey, t]);

  const activeServices = services.filter((service) => service.active);
  const enabledHours = hours.filter((day) => day.enabled);
  const isReady = activeServices.length > 0 && enabledHours.length > 0;

  return (
    <section className={CARD_MAIN}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[#1A1F36]">{t("title")}</h2>
          <p className="mt-1 text-xs font-medium text-[#1A1F36]/65">
            {t("subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReloadKey((current) => current + 1)}
          disabled={loading}
          aria-label={t("refresh")}
          title={t("refresh")}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#4F5FE8] shadow-soft disabled:opacity-50"
        >
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </button>
      </header>

      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-[#FF4D5E] p-3 text-sm font-medium text-white">
          {error}
        </p>
      )}

      <div className="mt-4 space-y-3">
        <section className="rounded-2xl bg-white p-4 shadow-soft">
          <h3 className="text-sm font-bold text-[#1A1F36]">{t("business")}</h3>
          <p className="mt-1 text-sm font-semibold text-[#1A1F36]">{name}</p>
          {description && (
            <p className="mt-1 whitespace-pre-wrap text-xs text-[#1A1F36]/70">
              {description}
            </p>
          )}
          <p className="mt-2 text-[11px] text-[#1A1F36]/60">
            {t("timezone")}: <span dir="ltr">{timezone}</span>
          </p>
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-soft">
          <h3 className="flex items-center gap-2 text-sm font-bold text-[#1A1F36]">
            <Scissors className="h-4 w-4 text-[#4F5FE8]" />
            {t("services", { count: activeServices.length })}
          </h3>
          {services.length === 0 ? (
            <p className="mt-2 text-xs text-[#1A1F36]/60">{t("noServices")}</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {services.map((service) => (
                <li
                  key={service.id}
                  className="flex items-start justify-between gap-3 border-t border-[#1A1F36]/10 pt-2 first:border-0 first:pt-0"
                >
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-[#1A1F36]">
                      {service.name}
                      {!service.active && (
                        <span className="ms-1 text-xs font-normal text-[#1A1F36]/50">
                          {t("inactive")}
                        </span>
                      )}
                    </p>
                    {service.description && (
                      <p className="mt-0.5 text-xs text-[#1A1F36]/60">
                        {service.description}
                      </p>
                    )}
                    <p className="mt-0.5 text-[11px] text-[#1A1F36]/60">
                      {tService("minutes", { count: service.durationMinutes })}
                    </p>
                  </div>
                  <span dir="ltr" className="shrink-0 text-sm font-bold text-[#1A1F36]">
                    {formatPrice(service.price, service.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-soft">
          <h3 className="flex items-center gap-2 text-sm font-bold text-[#1A1F36]">
            <Clock3 className="h-4 w-4 text-[#4F5FE8]" />
            {t("workingHours")}
          </h3>
          {loading ? (
            <p className="mt-2 flex items-center gap-2 text-xs text-[#1A1F36]/60">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("loading")}
            </p>
          ) : enabledHours.length === 0 ? (
            <p className="mt-2 text-xs text-[#1A1F36]/60">{t("noWorkingDays")}</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {enabledHours.map((day) => (
                <li
                  key={day.dayOfWeek}
                  className="flex items-center justify-between gap-3 text-xs text-[#1A1F36]/80"
                >
                  <span>{tHours(`days.${day.dayOfWeek}`)}</span>
                  <span dir="ltr" className="tabular font-semibold">
                    {day.openTime}–{day.closeTime}
                    {day.breakStart && day.breakEnd && (
                      <span className="ms-2 font-normal text-[#1A1F36]/55">
                        ({day.breakStart}–{day.breakEnd})
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-soft">
          <h3 className="flex items-center gap-2 text-sm font-bold text-[#1A1F36]">
            <CalendarDays className="h-4 w-4 text-[#4F5FE8]" />
            {t("holidays")}
          </h3>
          {loading ? (
            <p className="mt-2 flex items-center gap-2 text-xs text-[#1A1F36]/60">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("loading")}
            </p>
          ) : holidays.length === 0 ? (
            <p className="mt-2 text-xs text-[#1A1F36]/60">{t("noHolidays")}</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {holidays.map((holiday) => (
                <li key={holiday.id} className="text-xs text-[#1A1F36]/80">
                  <span className="font-semibold">
                    {new Date(`${holiday.date}T00:00:00.000Z`).toLocaleDateString(
                      locale,
                      { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" }
                    )}
                  </span>
                  {holiday.reason && <span>: {holiday.reason}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {!isReady && !loading && (
        <p className="mt-4 rounded-xl bg-[#FCA311]/15 p-3 text-xs font-medium text-[#1A1F36]/75">
          {t("notReady")}
        </p>
      )}

      <button
        type="button"
        onClick={onComplete}
        disabled={!isReady || loading || actionLoading || Boolean(error)}
        className={BTN_PRIMARY + " mt-4"}
      >
        {actionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
        {actionLabel}
      </button>
    </section>
  );
}
