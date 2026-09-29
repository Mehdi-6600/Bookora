"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import {
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Hash,
  Loader2,
  Phone,
  RefreshCw,
  Search,
  User,
  X,
  XCircle,
} from "lucide-react";
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
  payment: {
    id: string;
    status: string;
    transactionReference: string | null;
  } | null;
};

type FilterKey = "PENDING" | "CONFIRMED" | "ALL";

const CARD_MAIN = "rounded-3xl bg-[#B8D4F5] p-5 shadow-soft";

const BTN_PRIMARY =
  "btn-elevated flex w-full items-center justify-center gap-2 rounded-2xl bg-[#34C759] px-3 py-3 text-sm font-bold text-white transition-transform active:scale-[0.98] disabled:opacity-50";

const BTN_DANGER =
  "flex w-full items-center justify-center gap-2 rounded-2xl bg-[#FF4D5E] px-3 py-3 text-sm font-bold text-white shadow-soft transition-transform active:scale-[0.98] disabled:opacity-50";

const BTN_GHOST =
  "flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-3 py-3 text-sm font-bold text-[#1A1F36] shadow-soft transition-transform active:scale-[0.98] disabled:opacity-50";

const BTN_FILTER_ACTIVE =
  "btn-selected shrink-0 rounded-2xl px-4 py-2.5 text-xs font-bold transition-all active:scale-95";

const BTN_FILTER_IDLE =
  "shrink-0 rounded-2xl bg-white px-4 py-2.5 text-xs font-bold text-[#1A1F36] shadow-soft transition-all active:scale-95";

const INPUT_SEARCH =
  "w-full rounded-2xl bg-white px-4 py-3 ps-11 text-sm font-medium text-[#1A1F36] outline-none placeholder:text-[#1A1F36]/40";

const SECTION_ICON =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-soft";

const SECTION_TITLE = "text-base font-bold text-[#1A1F36]";

const LABEL_SMALL =
  "text-[11px] font-bold uppercase tracking-wide text-[#1A1F36]/50";

const BADGE_PENDING =
  "inline-flex items-center gap-1 rounded-full bg-[#FCA311] px-2.5 py-1 text-[10px] font-bold text-white shadow-soft";

const BADGE_CONFIRMED =
  "inline-flex items-center gap-1 rounded-full bg-[#34C759] px-2.5 py-1 text-[10px] font-bold text-white shadow-soft";

const BADGE_CANCELLED =
  "inline-flex items-center gap-1 rounded-full bg-[#1A1F36]/40 px-2.5 py-1 text-[10px] font-bold text-white shadow-soft";

const BADGE_MUTED =
  "inline-flex items-center gap-1 rounded-full bg-[#1A1F36]/15 px-2.5 py-1 text-[10px] font-bold text-[#1A1F36]/70";

export function BookingsPanel({ businessId }: { businessId: string }) {
  const t = useTranslations("bookingsPanel");
  const locale = useLocale();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const [filter, setFilter] = useState<FilterKey>("ALL");
  const [query, setQuery] = useState("");

  async function load() {
    try {
      setLoading(true);
      const response = await fetch(
        `/api/bookings?businessId=${businessId}`,
        { cache: "no-store" }
      );
      const data = await response.json();
      if (response.ok) setBookings(data.bookings);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  async function review(
    bookingId: string,
    paymentId: string,
    action: "approve" | "reject"
  ) {
    try {
      setReviewingId(paymentId);
      await fetch(
        `/api/bookings/${bookingId}/payments/${paymentId}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        }
      );
      await load();
    } finally {
      setReviewingId(null);
    }
  }

  const filtered = useMemo(() => {
    let list = bookings;

    if (filter === "PENDING") {
      list = list.filter(
        (b) => b.payment && b.payment.status === "PENDING"
      );
    } else if (filter === "CONFIRMED") {
      list = list.filter((b) => b.status === "CONFIRMED");
    }

    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (b) =>
          b.customerName.toLowerCase().includes(q) ||
          b.customerPhone.toLowerCase().includes(q) ||
          b.serviceName.toLowerCase().includes(q)
      );
    }

    return list;
  }, [bookings, filter, query]);

  const pendingCount = bookings.filter(
    (b) => b.payment && b.payment.status === "PENDING"
  ).length;

  const confirmedCount = bookings.filter(
    (b) => b.status === "CONFIRMED"
  ).length;

  const tz = "UTC";

  const filterLabels: Record<FilterKey, string> = {
    PENDING: t("filterPending"),
    CONFIRMED: t("filterConfirmed"),
    ALL: t("filterAll"),
  };

  const filterCounts: Record<FilterKey, number> = {
    PENDING: pendingCount,
    CONFIRMED: confirmedCount,
    ALL: bookings.length,
  };

  if (loading) {
    return (
      <section className={CARD_MAIN}>
        <div className="flex items-center justify-center gap-2 rounded-2xl bg-white py-6 text-sm font-medium text-[#1A1F36]/60 shadow-soft">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("loading")}
        </div>
      </section>
    );
  }

  return (
    <section className={CARD_MAIN}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={SECTION_ICON}>
            <Calendar className="h-5 w-5 text-[#4F5FE8]" />
          </span>
          <div className="min-w-0">
            <h2 className={SECTION_TITLE}>{t("title")}</h2>
            <p className="mt-0.5 text-xs font-medium text-[#1A1F36]/60">
              {bookings.length} {t("totalLabel")}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={load}
          aria-label={t("loading")}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-soft transition-transform active:scale-95"
        >
          <RefreshCw className="h-4 w-4 text-[#4F5FE8]" />
        </button>
      </div>

      {/* Search */}
      <div className="relative mt-4">
        <Search className="pointer-events-none absolute inset-y-0 start-4 my-auto h-4 w-4 text-[#1A1F36]/40" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className={INPUT_SEARCH}
        />
      </div>

      {/* Filters */}
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {(Object.keys(filterLabels) as FilterKey[]).map((key) => {
          const isActive = filter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={isActive ? BTN_FILTER_ACTIVE : BTN_FILTER_IDLE}
            >
              {filterLabels[key]}{" "}
              <span className="opacity-70">({filterCounts[key]})</span>
            </button>
          );
        })}
      </div>

      {/* Empty */}
      {filtered.length === 0 ? (
        <div className="mt-4 rounded-2xl bg-white py-8 text-center shadow-soft">
          <Calendar className="mx-auto h-6 w-6 text-[#1A1F36]/30" />
          <p className="mt-2 text-sm font-medium text-[#1A1F36]/50">
            {t("empty")}
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {filtered.map((b) => {
            const zoned = toZonedTime(new Date(b.startAt), tz);
            const dateLabel = format(zoned, "yyyy-MM-dd");
            const timeLabel = format(zoned, "HH:mm");

            const isPending = b.status === "PENDING_PAYMENT";
            const isConfirmed = b.status === "CONFIRMED";
            const isCancelled = b.status === "CANCELLED";

            let statusBadgeCls = BADGE_MUTED;
            let statusLabel = b.status;
            if (isPending) {
              statusBadgeCls = BADGE_PENDING;
              statusLabel = t("statusPending");
            } else if (isConfirmed) {
              statusBadgeCls = BADGE_CONFIRMED;
              statusLabel = t("statusConfirmed");
            } else if (isCancelled) {
              statusBadgeCls = BADGE_CANCELLED;
              statusLabel = t("statusCancelled");
            }

            return (
              <article
                key={b.id}
                className="rounded-2xl bg-white p-4 shadow-soft"
              >
                {/* Top: customer + status */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#4F5FE8]/10">
                        <User className="h-4 w-4 text-[#4F5FE8]" />
                      </span>
                      <h3 className="truncate text-base font-bold text-[#1A1F36]">
                        {b.customerName}
                      </h3>
                    </div>
                    <p className="mt-1 truncate text-xs font-medium text-[#1A1F36]/60">
                      {b.serviceName}
                    </p>
                  </div>
                  <span className={statusBadgeCls}>{statusLabel}</span>
                </div>

                {/* Info grid */}
                <div className="mt-3 space-y-1.5 text-xs">
                  <div className="flex items-center gap-2 text-[#1A1F36]/70">
                    <Calendar className="h-3.5 w-3.5 shrink-0" />
                    <span className="tabular">{dateLabel}</span>
                    <Clock className="ms-2 h-3.5 w-3.5 shrink-0" />
                    <span className="tabular font-semibold">{timeLabel}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#1A1F36]/70">
                    <Phone className="h-3.5 w-3.5 shrink-0" />
                    <span className="tabular" dir="ltr">
                      {b.customerPhone}
                    </span>
                  </div>
                </div>

                {/* Deposit */}
                {Number(b.depositDue) > 0 && (
                  <div className="mt-3 flex items-center justify-between rounded-2xl bg-[#4F5FE8]/8 px-3 py-2">
                    <span className={LABEL_SMALL}>
                      {t("depositLabelShort")}
                    </span>
                    <span className="tabular text-sm font-bold text-[#4F5FE8]">
                      {formatPrice(b.depositDue, b.currency)}
                    </span>
                  </div>
                )}

                {/* Payment review */}
                {b.payment && b.payment.status === "PENDING" && (
                  <div className="mt-3 rounded-2xl bg-[#FCA311]/10 p-3">
                    <div className="flex items-center gap-2">
                      <Hash className="h-3.5 w-3.5 shrink-0 text-[#FCA311]" />
                      <span className="text-[11px] font-bold uppercase tracking-wide text-[#FCA311]">
                        {t("receiptLabelShort")}
                      </span>
                    </div>
                    <p
                      className="mt-1 break-all font-mono text-sm font-bold text-[#1A1F36]"
                      dir="ltr"
                    >
                      {b.payment.transactionReference ||
                        t("receiptNotSent")}
                    </p>

                    {b.payment.transactionReference && (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            review(b.id, b.payment!.id, "approve")
                          }
                          disabled={reviewingId === b.payment.id}
                          className={BTN_PRIMARY}
                        >
                          {reviewingId === b.payment.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )}
                          {t("approveButton")}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            review(b.id, b.payment!.id, "reject")
                          }
                          disabled={reviewingId === b.payment.id}
                          className={BTN_DANGER}
                        >
                          <XCircle className="h-4 w-4" />
                          {t("rejectButton")}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
