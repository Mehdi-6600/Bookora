"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  Crown,
  ExternalLink,
  FileText,
  Hash,
  Loader2,
  LogIn,
  Receipt,
  RefreshCw,
  Search,
  ShieldCheck,
  StickyNote,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { TelegramAuthGate } from "@/components/telegram/auth-gate";
import { MANUAL_PAYMENT_SETTING_KEYS } from "@/lib/admin-settings";

type SettingRow = { key: string; value: string };
type FilterKey = "PENDING" | "ACTIVE" | "REJECTED";
type TabKey = "requests" | "businesses";
type BizStatusKey = "ALL" | "ACTIVE" | "ARCHIVED";

type SubscriptionRow = {
  id: string;
  plan: string;
  status: string;
  receiptReference: string | null;
  receiptNote: string | null;
  adminNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  businessName: string | null;
  businessSlug: string | null;
  userName: string;
};

type BusinessRow = {
  id: string;
  name: string;
  slug: string;
  country: string | null;
  currency: string;
  status: string;
  createdAt: string;
  owner: {
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    telegramId: string;
  };
  counts: {
    services: number;
    bookings: number;
  };
};

type StatsPayload = {
  users: { total: number; last7d: number };
  businesses: { total: number; active: number; archived: number };
  bookings: { total: number; last7d: number; pendingPayment: number };
  subscriptions: { active: number; pending: number };
  payments: { pendingReview: number };
  generatedAt: string;
};

type MessageState = {
  kind: "ok" | "err";
  text: string;
} | null;

const FILTERS: FilterKey[] = ["PENDING", "ACTIVE", "REJECTED"];
const BIZ_STATUSES: BizStatusKey[] = ["ALL", "ACTIVE", "ARCHIVED"];

const CARD_MAIN = "rounded-3xl bg-[#B8D4F5] p-5 shadow-soft";

const CARD_INNER = "rounded-2xl bg-white p-4 shadow-soft";

const CARD_INNER_MUTED = "rounded-2xl bg-white/60 p-4 shadow-soft";

const BTN_PRIMARY =
  "btn-elevated flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[#34C759] px-3 py-3 text-sm font-bold text-white transition-transform active:scale-[0.98] disabled:opacity-50";

const BTN_DANGER =
  "flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[#FF4D5E] px-3 py-3 text-sm font-bold text-white shadow-soft transition-transform active:scale-[0.98] disabled:opacity-50";

const BTN_GHOST =
  "flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white px-3 py-3 text-sm font-bold text-[#1A1F36] shadow-soft transition-transform active:scale-[0.98] disabled:opacity-50";

const BTN_PILL_ACTIVE =
  "btn-selected shrink-0 rounded-2xl px-4 py-2.5 text-xs font-bold transition-all active:scale-95";

const BTN_PILL_IDLE =
  "shrink-0 rounded-2xl bg-white px-4 py-2.5 text-xs font-bold text-[#1A1F36] shadow-soft transition-all active:scale-95";

const BTN_TAB_ACTIVE =
  "btn-selected flex-1 rounded-2xl px-4 py-3 text-sm font-bold transition-all active:scale-[0.98]";

const BTN_TAB_IDLE =
  "flex-1 rounded-2xl bg-white px-4 py-3 text-sm font-bold text-[#1A1F36] shadow-soft transition-all active:scale-[0.98]";

const INPUT_BASE =
  "w-full rounded-2xl bg-white px-4 py-3 text-sm font-medium text-[#1A1F36] outline-none placeholder:text-[#1A1F36]/40 shadow-soft";

const INPUT_SEARCH =
  "w-full rounded-2xl bg-white px-4 py-3 ps-11 text-sm font-medium text-[#1A1F36] outline-none placeholder:text-[#1A1F36]/40 shadow-soft";

const SECTION_ICON =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-soft";

const SECTION_TITLE = "text-base font-bold text-[#1A1F36]";

const LABEL_SMALL =
  "text-[11px] font-bold uppercase tracking-wide text-[#1A1F36]/50";

const BOX_OK =
  "flex items-start gap-2 rounded-2xl bg-[#34C759] p-3.5 text-sm font-bold text-white shadow-soft";

const BOX_ERR =
  "flex items-start gap-2 rounded-2xl bg-[#FF4D5E] p-3.5 text-sm font-medium text-white shadow-soft";

const BADGE_OK =
  "inline-flex items-center gap-1 rounded-full bg-[#34C759] px-2.5 py-1 text-[10px] font-bold text-white shadow-soft";

const BADGE_WARN =
  "inline-flex items-center gap-1 rounded-full bg-[#FCA311] px-2.5 py-1 text-[10px] font-bold text-white shadow-soft";

const BADGE_BAD =
  "inline-flex items-center gap-1 rounded-full bg-[#FF4D5E] px-2.5 py-1 text-[10px] font-bold text-white shadow-soft";

const BADGE_MUTED =
  "inline-flex items-center gap-1 rounded-full bg-[#1A1F36]/15 px-2.5 py-1 text-[10px] font-bold text-[#1A1F36]/70";

function formatDate(value: string, locale: string): string {
  try {
    const date = new Date(value);
    const numberingLocale =
      locale === "fa" ? "fa-IR" : locale === "ar" ? "ar-EG" : "en-US";
    return new Intl.DateTimeFormat(numberingLocale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return value;
  }
}

function formatNumber(value: number, locale: string): string {
  try {
    const numberingLocale =
      locale === "fa" ? "fa-IR" : locale === "ar" ? "ar-EG" : "en-US";
    return new Intl.NumberFormat(numberingLocale).format(value);
  } catch {
    return String(value);
  }
}

function statusBadgeClass(status: string): string {
  if (status === "ACTIVE") return BADGE_OK;
  if (status === "REJECTED") return BADGE_BAD;
  return BADGE_WARN;
}

function bizStatusBadgeClass(status: string): string {
  if (status === "ACTIVE") return BADGE_OK;
  if (status === "ARCHIVED") return BADGE_MUTED;
  return BADGE_WARN;
}

function AdminDashboard({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations("admin");
  const tSub = useTranslations("subscription");
  const locale = useLocale();

  const [tab, setTab] = useState<TabKey>("requests");

  const [settings, setSettings] = useState<SettingRow[]>(
    MANUAL_PAYMENT_SETTING_KEYS.map((key) => ({ key, value: "" }))
  );
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  const [filter, setFilter] = useState<FilterKey>("PENDING");
  const [rows, setRows] = useState<SubscriptionRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const [bizStatus, setBizStatus] = useState<BizStatusKey>("ALL");
  const [bizQuery, setBizQuery] = useState("");
  const [bizRows, setBizRows] = useState<BusinessRow[]>([]);
  const [loadingBiz, setLoadingBiz] = useState(false);

  const [message, setMessage] = useState<MessageState>(null);

  async function loadSettings() {
    try {
      setLoadingSettings(true);
      const response = await fetch("/api/admin/settings", {
        cache: "no-store",
      });
      const data = await response.json();
      if (response.ok) setSettings(data.settings);
    } finally {
      setLoadingSettings(false);
    }
  }

  async function loadStats() {
    try {
      setLoadingStats(true);
      const response = await fetch("/api/admin/stats", {
        cache: "no-store",
      });
      const data = await response.json();
      if (response.ok) setStats(data);
    } finally {
      setLoadingStats(false);
    }
  }

  const loadRows = useCallback(async (which: FilterKey) => {
    try {
      setLoadingRows(true);
      const response = await fetch(
        "/api/admin/subscriptions?status=" + which,
        { cache: "no-store" }
      );
      const data = await response.json();
      if (response.ok) setRows(data.subscriptions || []);
    } finally {
      setLoadingRows(false);
    }
  }, []);

  const loadBusinesses = useCallback(
    async (which: BizStatusKey, query: string) => {
      try {
        setLoadingBiz(true);
        const params = new URLSearchParams();
        if (which !== "ALL") params.set("status", which);
        if (query.trim()) params.set("q", query.trim());
        const url =
          "/api/admin/businesses" +
          (params.toString() ? "?" + params.toString() : "");
        const response = await fetch(url, { cache: "no-store" });
        const data = await response.json();
        if (response.ok) setBizRows(data.businesses || []);
      } finally {
        setLoadingBiz(false);
      }
    },
    []
  );

  useEffect(() => {
    if (isAdmin) {
      loadSettings();
      loadStats();
    }
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin && tab === "requests") {
      loadRows(filter);
    }
  }, [isAdmin, tab, filter, loadRows]);

  useEffect(() => {
    if (isAdmin && tab === "businesses") {
      loadBusinesses(bizStatus, bizQuery);
    }
  }, [isAdmin, tab, bizStatus, bizQuery, loadBusinesses]);

  async function saveSettings() {
    try {
      setSavingSettings(true);
      setMessage(null);
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data && data.error ? data.error : t("saveError"));
      }
      setMessage({ kind: "ok", text: t("saved") });
    } catch (error) {
      const text = error instanceof Error ? error.message : t("saveError");
      setMessage({ kind: "err", text });
    } finally {
      setSavingSettings(false);
    }
  }

  async function review(
    id: string,
    action: "approve" | "reject",
    note?: string
  ) {
    try {
      setReviewingId(id);
      setMessage(null);
      const response = await fetch(
        "/api/admin/subscriptions/" + id + "/review",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            note: note && note.trim() ? note.trim() : null,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data && data.error ? data.error : t("reviewError"));
      }
      setRejectingId(null);
      setRejectNote("");
      await Promise.all([loadRows(filter), loadStats()]);
      const okText = action === "approve" ? t("approved") : t("rejected");
      setMessage({ kind: "ok", text: okText });
    } catch (error) {
      const text =
        error instanceof Error ? error.message : t("reviewError");
      setMessage({ kind: "err", text });
    } finally {
      setReviewingId(null);
    }
  }

  const txtTitle = t("title");
  const txtNoAccess = t("noAccess");
  const txtPaymentInfo = t("paymentInfoTitle");
  const txtLoading = t("loading");
  const txtSave = t("saveButton");
  const txtSaving = t("saving");
  const txtNoBusiness = t("noBusiness");
  const txtPlanLabel = t("planLabel");
  const txtReceiptLabel = t("receiptLabel");
  const txtNoteLabel = t("noteLabel");
  const txtApprove = t("approveButton");
  const txtReject = t("rejectButton");
  const txtSubmittedAt = t("submittedAt");
  const txtReviewedAt = t("reviewedAt");
  const txtAdminNote = t("adminNote");
  const txtViewBusiness = t("viewBusiness");
  const txtRejectPlaceholder = t("rejectNotePlaceholder");
  const txtCancel = tSub("cancelButton");
  const planMonthly = tSub("planMonthly");
  const planYearly = tSub("planYearly");

  const statTitle = t("statsTitle");
  const statUsers = t("statUsers");
  const statBusinesses = t("statBusinesses");
  const statBookings = t("statBookings");
  const statSubsActive = t("statSubsActive");
  const statSubsPending = t("statSubsPending");
  const statPaymentsPendingReview = t("statPaymentsPendingReview");
  const statLast7d = t("statLast7d");
  const statActive = t("statActive");
  const statArchived = t("statArchived");

  const tabRequests = t("tabRequests");
  const tabBusinesses = t("tabBusinesses");
  const bizTitle = t("bizTitle");
  const bizSearchPlaceholder = t("bizSearchPlaceholder");
  const bizEmpty = t("bizEmpty");
  const bizFilterAll = t("bizFilterAll");
  const bizFilterActive = t("bizFilterActive");
  const bizFilterArchived = t("bizFilterArchived");
  const bizServices = t("bizServices");
  const bizBookings = t("bizBookings");
  const bizOwner = t("bizOwner");
  const enterPanelText = t("enterPanelButton");

  const filterLabels: Record<FilterKey, string> = {
    PENDING: t("filterPending"),
    ACTIVE: t("filterApproved"),
    REJECTED: t("filterRejected"),
  };

  const filterEmpty: Record<FilterKey, string> = {
    PENDING: t("pendingEmpty"),
    ACTIVE: t("filterEmptyApproved"),
    REJECTED: t("filterEmptyRejected"),
  };

  const bizStatusLabels: Record<BizStatusKey, string> = {
    ALL: bizFilterAll,
    ACTIVE: bizFilterActive,
    ARCHIVED: bizFilterArchived,
  };

  const settingLabels: Record<string, string> = {
    payment_card_number: t("settingLabels.payment_card_number"),
    payment_card_holder: t("settingLabels.payment_card_holder"),
    payment_bank_name: t("settingLabels.payment_bank_name"),
    payment_instructions: t("settingLabels.payment_instructions"),
  };

  if (!isAdmin) {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center px-4">
        <div className={CARD_MAIN + " text-center"}>
          <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-soft">
            <ShieldCheck className="h-7 w-7 text-[#4F5FE8]" />
          </span>
          <p className="text-sm font-medium text-[#1A1F36]/60">
            {txtNoAccess}
          </p>
        </div>
      </div>
    );
  }

  const headerTitle = t("pendingTitle", { count: rows.length });

  const s = stats;
  const nf = (v: number) => formatNumber(v, locale);

  const tabRequestsCls = tab === "requests" ? BTN_TAB_ACTIVE : BTN_TAB_IDLE;
  const tabBusinessesCls =
    tab === "businesses" ? BTN_TAB_ACTIVE : BTN_TAB_IDLE;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      {/* Header */}
      <header className={CARD_MAIN}>
        <div className="flex items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white shadow-soft">
            <ShieldCheck className="h-6 w-6 text-[#4F5FE8]" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold tracking-tight text-[#1A1F36] sm:text-2xl">
              {txtTitle}
            </h1>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setTab("requests")}
            className={tabRequestsCls}
          >
            {tabRequests}
          </button>
          <button
            type="button"
            onClick={() => setTab("businesses")}
            className={tabBusinessesCls}
          >
            {tabBusinesses}
          </button>
        </div>
      </header>

      {/* Message */}
      {message && (
        <div className={message.kind === "ok" ? BOX_OK : BOX_ERR}>
          {message.kind === "ok" ? (
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <X className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* =================== REQUESTS TAB =================== */}
      {tab === "requests" && (
        <>
          {/* Stats */}
          <section className={CARD_MAIN}>
            <header className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className={SECTION_ICON}>
                  <Calendar className="h-5 w-5 text-[#4F5FE8]" />
                </span>
                <div>
                  <h2 className={SECTION_TITLE}>{statTitle}</h2>
                </div>
              </div>

              <button
                type="button"
                onClick={loadStats}
                disabled={loadingStats}
                aria-label={txtLoading}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-soft transition-transform active:scale-95 disabled:opacity-50"
              >
                <RefreshCw
                  className={
                    loadingStats
                      ? "h-4 w-4 animate-spin text-[#4F5FE8]"
                      : "h-4 w-4 text-[#4F5FE8]"
                  }
                />
              </button>
            </header>

            {loadingStats || !s ? (
              <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-white py-6 text-sm font-medium text-[#1A1F36]/60 shadow-soft">
                <Loader2 className="h-4 w-4 animate-spin" />
                {txtLoading}
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div className={CARD_INNER}>
                  <div className="flex items-center gap-2 text-[#1A1F36]/60">
                    <Users className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-bold uppercase tracking-wide">
                      {statUsers}
                    </span>
                  </div>
                  <div className="tabular mt-2 text-2xl font-bold text-[#1A1F36]">
                    {nf(s.users.total)}
                  </div>
                  <div className="mt-0.5 text-[10px] font-medium text-[#1A1F36]/50">
                    {statLast7d} +{nf(s.users.last7d)}
                  </div>
                </div>

                <div className={CARD_INNER}>
                  <div className="flex items-center gap-2 text-[#1A1F36]/60">
                    <Building2 className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-bold uppercase tracking-wide">
                      {statBusinesses}
                    </span>
                  </div>
                  <div className="tabular mt-2 text-2xl font-bold text-[#1A1F36]">
                    {nf(s.businesses.total)}
                  </div>
                  <div className="mt-0.5 text-[10px] font-medium text-[#1A1F36]/50">
                    {statActive} {nf(s.businesses.active)} · {statArchived}{" "}
                    {nf(s.businesses.archived)}
                  </div>
                </div>

                <div className={CARD_INNER}>
                  <div className="flex items-center gap-2 text-[#1A1F36]/60">
                    <Calendar className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-bold uppercase tracking-wide">
                      {statBookings}
                    </span>
                  </div>
                  <div className="tabular mt-2 text-2xl font-bold text-[#1A1F36]">
                    {nf(s.bookings.total)}
                  </div>
                  <div className="mt-0.5 text-[10px] font-medium text-[#1A1F36]/50">
                    {statLast7d} +{nf(s.bookings.last7d)}
                  </div>
                </div>

                <div className={CARD_INNER}>
                  <div className="flex items-center gap-2 text-[#1A1F36]/60">
                    <Crown className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-bold uppercase tracking-wide">
                      {statSubsActive}
                    </span>
                  </div>
                  <div className="tabular mt-2 text-2xl font-bold text-[#1A1F36]">
                    {nf(s.subscriptions.active)}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setFilter("PENDING")}
                  className={CARD_INNER + " text-start transition-transform active:scale-95"}
                >
                  <div className="flex items-center gap-2 text-[#FCA311]">
                    <Clock className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-bold uppercase tracking-wide">
                      {statSubsPending}
                    </span>
                  </div>
                  <div className="tabular mt-2 text-2xl font-bold text-[#FCA311]">
                    {nf(s.subscriptions.pending)}
                  </div>
                </button>

                <div className={CARD_INNER}>
                  <div className="flex items-center gap-2 text-[#1A1F36]/60">
                    <CreditCard className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-bold uppercase tracking-wide">
                      {statPaymentsPendingReview}
                    </span>
                  </div>
                  <div className="tabular mt-2 text-2xl font-bold text-[#1A1F36]">
                    {nf(s.payments.pendingReview)}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Payment settings */}
          <section className={CARD_MAIN}>
            <header className="flex items-start gap-3">
              <span className={SECTION_ICON}>
                <CreditCard className="h-5 w-5 text-[#4F5FE8]" />
              </span>
              <div>
                <h2 className={SECTION_TITLE}>{txtPaymentInfo}</h2>
              </div>
            </header>

            {loadingSettings ? (
              <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-white py-6 text-sm font-medium text-[#1A1F36]/60 shadow-soft">
                <Loader2 className="h-4 w-4 animate-spin" />
                {txtLoading}
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {settings.map((setting, index) => {
                  const label = settingLabels[setting.key] || setting.key;
                  return (
                    <div key={setting.key}>
                      <label className={LABEL_SMALL + " mb-1.5 block"}>
                        {label}
                      </label>
                      <input
                        value={setting.value}
                        onChange={(event) => {
                          const next = settings.slice();
                          next[index] = {
                            key: setting.key,
                            value: event.target.value,
                          };
                          setSettings(next);
                        }}
                        className={INPUT_BASE}
                      />
                    </div>
                  );
                })}

                <button
                  type="button"
                  onClick={saveSettings}
                  disabled={savingSettings}
                  className="btn-elevated flex w-full items-center justify-center gap-2 rounded-2xl bg-[#4F5FE8] px-4 py-4 text-base font-bold text-white transition-transform active:scale-[0.98] disabled:opacity-50"
                >
                  {savingSettings && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {savingSettings ? txtSaving : txtSave}
                </button>
              </div>
            )}
          </section>

          {/* Subscriptions */}
          <section className={CARD_MAIN}>
            <header className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className={SECTION_ICON}>
                  <Receipt className="h-5 w-5 text-[#4F5FE8]" />
                </span>
                <div>
                  <h2 className={SECTION_TITLE}>{headerTitle}</h2>
                </div>
              </div>

              <button
                type="button"
                onClick={() => loadRows(filter)}
                disabled={loadingRows}
                aria-label={txtLoading}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-soft transition-transform active:scale-95 disabled:opacity-50"
              >
                <RefreshCw
                  className={
                    loadingRows
                      ? "h-4 w-4 animate-spin text-[#4F5FE8]"
                      : "h-4 w-4 text-[#4F5FE8]"
                  }
                />
              </button>
            </header>

            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {FILTERS.map((key) => {
                const active = filter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilter(key)}
                    className={active ? BTN_PILL_ACTIVE : BTN_PILL_IDLE}
                  >
                    {filterLabels[key]}
                  </button>
                );
              })}
            </div>

            {loadingRows ? (
              <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-white py-6 text-sm font-medium text-[#1A1F36]/60 shadow-soft">
                <Loader2 className="h-4 w-4 animate-spin" />
                {txtLoading}
              </div>
            ) : rows.length === 0 ? (
              <div className="mt-4 rounded-2xl bg-white py-8 text-center shadow-soft">
                <CheckCircle2 className="mx-auto h-6 w-6 text-[#1A1F36]/30" />
                <p className="mt-2 text-sm font-medium text-[#1A1F36]/50">
                  {filterEmpty[filter]}
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {rows.map((sub) => {
                  const planLabel =
                    sub.plan === "PRO_MONTHLY"
                      ? planMonthly
                      : sub.plan === "PRO_YEARLY"
                      ? planYearly
                      : sub.plan;
                  const isPending = sub.status === "PENDING";
                  const badgeCls = statusBadgeClass(sub.status);
                  const statusLabel =
                    filterLabels[sub.status as FilterKey] || sub.status;
                  const businessText = sub.businessName || txtNoBusiness;
                  const submittedDate = formatDate(sub.createdAt, locale);
                  const reviewedDate = sub.reviewedAt
                    ? formatDate(sub.reviewedAt, locale)
                    : "";
                  const showReject = isPending && rejectingId === sub.id;
                  const showActions = isPending && rejectingId !== sub.id;

                  return (
                    <article key={sub.id} className={CARD_INNER}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-base font-bold text-[#1A1F36]">
                              {sub.userName}
                            </h3>
                            <span className={badgeCls}>{statusLabel}</span>
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-[#1A1F36]/70">
                            <span className="inline-flex items-center gap-1">
                              <Building2 className="h-3 w-3" />
                              {businessText}
                            </span>
                            <span className="opacity-50">•</span>
                            <span className="inline-flex items-center gap-1">
                              <CreditCard className="h-3 w-3" />
                              {planLabel}
                            </span>
                          </div>
                        </div>

                        {sub.businessSlug && (
                          <a
                            href={"/book/" + sub.businessSlug}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={txtViewBusiness}
                            title={txtViewBusiness}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#4F5FE8]/10 text-[#4F5FE8] transition-transform active:scale-95"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                      </div>

                      <div className="mt-3 space-y-1.5 text-xs">
                        <div className="flex items-start gap-2 text-[#1A1F36]/60">
                          <Calendar className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>
                            {txtSubmittedAt} {submittedDate}
                          </span>
                        </div>

                        {sub.receiptReference && (
                          <div className="flex items-start gap-2 text-[#1A1F36]/60">
                            <Hash className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span className="break-all" dir="ltr">
                              {sub.receiptReference}
                            </span>
                          </div>
                        )}

                        {sub.receiptNote && (
                          <div className="flex items-start gap-2 text-[#1A1F36]/60">
                            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span className="break-words">
                              {sub.receiptNote}
                            </span>
                          </div>
                        )}

                        {reviewedDate && (
                          <div className="flex items-start gap-2 text-[#1A1F36]/60">
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>
                              {txtReviewedAt} {reviewedDate}
                            </span>
                          </div>
                        )}

                        {sub.adminNote && (
                          <div className="flex items-start gap-2 text-[#1A1F36]/60">
                            <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span className="break-words">
                              {sub.adminNote}
                            </span>
                          </div>
                        )}
                      </div>

                      {showReject && (
                        <div className="mt-3 space-y-2">
                          <input
                            value={rejectNote}
                            onChange={(event) =>
                              setRejectNote(event.target.value)
                            }
                            placeholder={txtRejectPlaceholder}
                            className={INPUT_BASE}
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                review(sub.id, "reject", rejectNote)
                              }
                              disabled={reviewingId === sub.id}
                              className={BTN_DANGER}
                            >
                              {reviewingId === sub.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <XCircle className="h-4 w-4" />
                              )}
                              {txtReject}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRejectingId(null);
                                setRejectNote("");
                              }}
                              className={BTN_GHOST}
                            >
                              {txtCancel}
                            </button>
                          </div>
                        </div>
                      )}

                      {showActions && (
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => review(sub.id, "approve")}
                            disabled={reviewingId === sub.id}
                            className={BTN_PRIMARY}
                          >
                            {reviewingId === sub.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-4 w-4" />
                            )}
                            {txtApprove}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejectingId(sub.id);
                              setRejectNote("");
                            }}
                            disabled={reviewingId === sub.id}
                            className={BTN_DANGER}
                          >
                            <XCircle className="h-4 w-4" />
                            {txtReject}
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      {/* =================== BUSINESSES TAB =================== */}
      {tab === "businesses" && (
        <section className={CARD_MAIN}>
          <header className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className={SECTION_ICON}>
                <Building2 className="h-5 w-5 text-[#4F5FE8]" />
              </span>
              <div>
                <h2 className={SECTION_TITLE}>{bizTitle}</h2>
              </div>
            </div>

            <button
              type="button"
              onClick={() => loadBusinesses(bizStatus, bizQuery)}
              disabled={loadingBiz}
              aria-label={txtLoading}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-soft transition-transform active:scale-95 disabled:opacity-50"
            >
              <RefreshCw
                className={
                  loadingBiz
                    ? "h-4 w-4 animate-spin text-[#4F5FE8]"
                    : "h-4 w-4 text-[#4F5FE8]"
                }
              />
            </button>
          </header>

          <div className="relative mt-4">
            <Search className="pointer-events-none absolute inset-y-0 start-4 my-auto h-4 w-4 text-[#1A1F36]/40" />
            <input
              value={bizQuery}
              onChange={(event) => setBizQuery(event.target.value)}
              placeholder={bizSearchPlaceholder}
              className={INPUT_SEARCH}
            />
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {BIZ_STATUSES.map((key) => {
              const active = bizStatus === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setBizStatus(key)}
                  className={active ? BTN_PILL_ACTIVE : BTN_PILL_IDLE}
                >
                  {bizStatusLabels[key]}
                </button>
              );
            })}
          </div>

          {loadingBiz ? (
            <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-white py-6 text-sm font-medium text-[#1A1F36]/60 shadow-soft">
              <Loader2 className="h-4 w-4 animate-spin" />
              {txtLoading}
            </div>
          ) : bizRows.length === 0 ? (
            <div className="mt-4 rounded-2xl bg-white py-8 text-center shadow-soft">
              <Building2 className="mx-auto h-6 w-6 text-[#1A1F36]/30" />
              <p className="mt-2 text-sm font-medium text-[#1A1F36]/50">
                {bizEmpty}
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {bizRows.map((biz) => {
                const badgeCls = bizStatusBadgeClass(biz.status);
                const ownerName =
                  biz.owner.firstName ||
                  biz.owner.username ||
                  biz.owner.telegramId;
                const ownerUsername = biz.owner.username;
                const ownerLink = ownerUsername
                  ? "https://t.me/" + ownerUsername
                  : null;
                const bizLink = "/book/" + biz.slug;
                const createdDate = formatDate(biz.createdAt, locale);
                const panelLink = "/app?businessId=" + biz.id;

                return (
                  <article key={biz.id} className={CARD_INNER}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-base font-bold text-[#1A1F36]">
                            {biz.name}
                          </h3>
                          <span className={badgeCls}>
                            {biz.status === "ACTIVE"
                              ? statActive
                              : biz.status === "ARCHIVED"
                              ? statArchived
                              : biz.status}
                          </span>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-[#1A1F36]/70">
                          <span className="font-mono">
                            {"/book/" + biz.slug}
                          </span>
                          {biz.country && (
                            <>
                              <span className="opacity-50">•</span>
                              <span>{biz.country}</span>
                            </>
                          )}
                          <span className="opacity-50">•</span>
                          <span className="font-bold">{biz.currency}</span>
                        </div>
                      </div>

                      <div className="flex shrink-0 gap-2">
                        <a
                          href={panelLink}
                          aria-label={enterPanelText}
                          title={enterPanelText}
                          className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#4F5FE8] text-white shadow-soft transition-transform active:scale-95"
                        >
                          <LogIn className="h-4 w-4" />
                        </a>

                        <a
                          href={bizLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={txtViewBusiness}
                          title={txtViewBusiness}
                          className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#1A1F36]/10 text-[#1A1F36]/70 transition-transform active:scale-95"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </div>
                    </div>

                    <div className="mt-3 space-y-1.5 text-xs">
                      <div className="flex items-start gap-2 text-[#1A1F36]/70">
                        <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                          {bizOwner}:{" "}
                          {ownerLink ? (
                            <a
                              href={ownerLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-bold text-[#4F5FE8] underline-offset-2 hover:underline"
                            >
                              {ownerName}
                            </a>
                          ) : (
                            <span className="font-bold text-[#1A1F36]">
                              {ownerName}
                            </span>
                          )}
                        </span>
                      </div>

                      <div className="flex items-start gap-2 text-[#1A1F36]/70">
                        <Calendar className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{createdDate}</span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[#1A1F36]/70">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {bizServices}:{" "}
                          <span className="tabular font-bold text-[#1A1F36]">
                            {nf(biz.counts.services)}
                          </span>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {bizBookings}:{" "}
                          <span className="tabular font-bold text-[#1A1F36]">
                            {nf(biz.counts.bookings)}
                          </span>
                        </span>
                      </div>
                    </div>

                    <a
                      href={panelLink}
                      className="btn-elevated mt-3 flex items-center justify-center gap-2 rounded-2xl bg-[#4F5FE8] px-3 py-3 text-xs font-bold text-white transition-transform active:scale-[0.98]"
                    >
                      <LogIn className="h-3.5 w-3.5" />
                      {enterPanelText}
                    </a>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default function AdminPage() {
  return (
    <main className="min-h-screen">
      <TelegramAuthGate>
        {(currentUser) => (
          <AdminDashboard isAdmin={currentUser.isAdmin} />
        )}
      </TelegramAuthGate>
    </main>
  );
}
