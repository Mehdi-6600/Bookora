"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Building2,
  CalendarDays,
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
  RotateCcw,
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

const BADGE_OK = "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
const BADGE_BAD = "bg-destructive/10 text-destructive";
const BADGE_WARN = "bg-amber-500/10 text-amber-700 dark:text-amber-400";
const BADGE_MUTED = "bg-muted text-muted-foreground";

const BOX_OK =
  "flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5 text-sm text-emerald-700 shadow-soft dark:text-emerald-400";

const BOX_BAD =
  "flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3.5 text-sm text-destructive shadow-soft";

const BTN_PRIMARY =
  "ring-focus flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50";

const BTN_GHOST =
  "ring-focus flex items-center justify-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50";

const BTN_DANGER =
  "ring-focus flex items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-background px-3 py-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/5 disabled:opacity-50";

const BTN_DANGER_SOLID =
  "ring-focus flex items-center justify-center gap-2 rounded-lg bg-destructive px-3 py-2 text-xs font-medium text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50";

const INPUT_BASE =
  "ring-focus w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none";

const CARD_SECTION =
  "rounded-2xl border border-border/60 bg-card p-5 shadow-soft";

const ICON_TILE =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground";

const STAT_TILE = "rounded-xl border border-border/60 bg-background p-3";

const STAT_TILE_CLICKABLE =
  "ring-focus rounded-xl border border-border/60 bg-background p-3 text-start transition-colors hover:border-primary/40 hover:bg-muted/40";

const TAB_ACTIVE =
  "ring-focus flex-1 rounded-lg border border-primary bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors";

const TAB_IDLE =
  "ring-focus flex-1 rounded-lg border border-border/60 bg-background px-3 py-2 text-xs font-medium transition-colors hover:bg-muted";

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
        <div className={CARD_SECTION + " text-center"}>
          <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{txtNoAccess}</p>
        </div>
      </div>
    );
  }

  const headerTitle = t("pendingTitle", { count: rows.length });

  const messageBoxClass =
    message && message.kind === "ok" ? BOX_OK : BOX_BAD;

  const s = stats;
  const nf = (v: number) => formatNumber(v, locale);

  const tabRequestsCls = tab === "requests" ? TAB_ACTIVE : TAB_IDLE;
  const tabBusinessesCls = tab === "businesses" ? TAB_ACTIVE : TAB_IDLE;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      <header className={CARD_SECTION}>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
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

      {message && (
        <div className={messageBoxClass}>
          {message.kind === "ok" ? (
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <X className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {tab === "requests" && (
        <>
          <section className={CARD_SECTION}>
            <header className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className={ICON_TILE}>
                  <CalendarDays className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">
                    {statTitle}
                  </h2>
                </div>
              </div>

              <button
                type="button"
                onClick={loadStats}
                disabled={loadingStats}
                aria-label={txtLoading}
                className="ring-focus rounded-lg border border-border/60 bg-background p-2 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                <RotateCcw
                  className={
                    loadingStats ? "h-4 w-4 animate-spin" : "h-4 w-4"
                  }
                />
              </button>
            </header>

            {loadingStats || !s ? (
              <div
                className={
                  INPUT_BASE +
                  " mt-4 flex items-center gap-2 text-muted-foreground"
                }
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                {txtLoading}
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div className={STAT_TILE}>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-medium">
                      {statUsers}
                    </span>
                  </div>
                  <div className="tabular mt-1.5 text-lg font-semibold">
                    {nf(s.users.total)}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {statLast7d}
                    {" "}
                    +{nf(s.users.last7d)}
                  </div>
                </div>

                <div className={STAT_TILE}>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-medium">
                      {statBusinesses}
                    </span>
                  </div>
                  <div className="tabular mt-1.5 text-lg font-semibold">
                    {nf(s.businesses.total)}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {statActive}
                    {" "}
                    {nf(s.businesses.active)}
                    {" · "}
                    {statArchived}
                    {" "}
                    {nf(s.businesses.archived)}
                  </div>
                </div>

                <div className={STAT_TILE}>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-medium">
                      {statBookings}
                    </span>
                  </div>
                  <div className="tabular mt-1.5 text-lg font-semibold">
                    {nf(s.bookings.total)}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {statLast7d}
                    {" "}
                    +{nf(s.bookings.last7d)}
                  </div>
                </div>

                <div className={STAT_TILE}>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Crown className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-medium">
                      {statSubsActive}
                    </span>
                  </div>
                  <div className="tabular mt-1.5 text-lg font-semibold">
                    {nf(s.subscriptions.active)}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setFilter("PENDING")}
                  className={STAT_TILE_CLICKABLE}
                >
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-medium">
                      {statSubsPending}
                    </span>
                  </div>
                  <div className="tabular mt-1.5 text-lg font-semibold">
                    {nf(s.subscriptions.pending)}
                  </div>
                </button>

                <div className={STAT_TILE}>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <CreditCard className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-medium">
                      {statPaymentsPendingReview}
                    </span>
                  </div>
                  <div className="tabular mt-1.5 text-lg font-semibold">
                    {nf(s.payments.pendingReview)}
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className={CARD_SECTION}>
            <header className="flex items-start gap-3">
              <span className={ICON_TILE}>
                <CreditCard className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">
                  {txtPaymentInfo}
                </h2>
              </div>
            </header>

            {loadingSettings ? (
              <div
                className={
                  INPUT_BASE +
                  " mt-4 flex items-center gap-2 text-muted-foreground"
                }
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                {txtLoading}
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {settings.map((setting, index) => {
                  const label = settingLabels[setting.key] || setting.key;
                  return (
                    <div key={setting.key}>
                      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
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
                  className="ring-focus flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {savingSettings && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {savingSettings ? txtSaving : txtSave}
                </button>
              </div>
            )}
          </section>

          <section className={CARD_SECTION}>
            <header className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className={ICON_TILE}>
                  <Receipt className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">
                    {headerTitle}
                  </h2>
                </div>
              </div>

              <button
                type="button"
                onClick={() => loadRows(filter)}
                disabled={loadingRows}
                aria-label={txtLoading}
                className="ring-focus rounded-lg border border-border/60 bg-background p-2 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                <RotateCcw
                  className={
                    loadingRows ? "h-4 w-4 animate-spin" : "h-4 w-4"
                  }
                />
              </button>
            </header>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {FILTERS.map((key) => {
                const active = filter === key;
                const cls = active
                  ? "ring-focus rounded-lg border border-primary bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors"
                  : "ring-focus rounded-lg border border-border/60 bg-background px-3 py-2 text-xs font-medium transition-colors hover:bg-muted";
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilter(key)}
                    className={cls}
                  >
                    {filterLabels[key]}
                  </button>
                );
              })}
            </div>

            {loadingRows ? (
              <div
                className={
                  INPUT_BASE +
                  " mt-4 flex items-center gap-2 text-muted-foreground"
                }
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                {txtLoading}
              </div>
            ) : rows.length === 0 ? (
              <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/60 bg-muted/20 p-6 text-center">
                <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
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
                  const badgeClass = statusBadgeClass(sub.status);
                  const statusLabel =
                    filterLabels[sub.status as FilterKey] || sub.status;
                  const businessText = sub.businessName || txtNoBusiness;
                  const submittedDate = formatDate(sub.createdAt, locale);
                  const reviewedDate = sub.reviewedAt
                    ? formatDate(sub.reviewedAt, locale)
                    : "";
                  const receiptText = sub.receiptReference
                    ? txtReceiptLabel
                    : "";
                  const receiptValue = sub.receiptReference || "";
                  const noteText = sub.receiptNote ? txtNoteLabel : "";
                  const noteValue = sub.receiptNote || "";
                  const adminNoteText = sub.adminNote ? txtAdminNote : "";
                  const adminNoteValue = sub.adminNote || "";
                  const showReject = isPending && rejectingId === sub.id;
                  const showActions = isPending && rejectingId !== sub.id;

                  return (
                    <article
                      key={sub.id}
                      className="rounded-xl border border-border/60 bg-background p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate font-semibold">
                              {sub.userName}
                            </h3>
                            <span
                              className={
                                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium " +
                                badgeClass
                              }
                            >
                              {statusLabel}
                            </span>
                          </div>

                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Building2 className="h-3 w-3" />
                              {businessText}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <CreditCard className="h-3 w-3" />
                              {txtPlanLabel}
                              {" "}
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
                            className="ring-focus shrink-0 rounded-lg border border-border/60 bg-background p-2 text-muted-foreground transition-colors hover:bg-muted"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>

                      <div className="mt-3 space-y-1.5 text-xs">
                        <div className="flex items-start gap-2 text-muted-foreground">
                          <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>
                            {txtSubmittedAt}
                            {" "}
                            {submittedDate}
                          </span>
                        </div>

                        {receiptValue && (
                          <div className="flex items-start gap-2 text-muted-foreground">
                            <Hash className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span className="break-all">
                              {receiptText}
                              {" "}
                              {receiptValue}
                            </span>
                          </div>
                        )}

                        {noteValue && (
                          <div className="flex items-start gap-2 text-muted-foreground">
                            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span className="break-words">
                              {noteText}
                              {" "}
                              {noteValue}
                            </span>
                          </div>
                        )}

                        {reviewedDate && (
                          <div className="flex items-start gap-2 text-muted-foreground">
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>
                              {txtReviewedAt}
                              {" "}
                              {reviewedDate}
                            </span>
                          </div>
                        )}

                        {adminNoteValue && (
                          <div className="flex items-start gap-2 text-muted-foreground">
                            <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span className="break-words">
                              {adminNoteText}
                              {" "}
                              {adminNoteValue}
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
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                review(sub.id, "reject", rejectNote)
                              }
                              disabled={reviewingId === sub.id}
                              className={BTN_DANGER_SOLID}
                            >
                              {reviewingId === sub.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <XCircle className="h-3.5 w-3.5" />
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
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => review(sub.id, "approve")}
                            disabled={reviewingId === sub.id}
                            className={BTN_PRIMARY}
                          >
                            {reviewingId === sub.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-3.5 w-3.5" />
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
                            <XCircle className="h-3.5 w-3.5" />
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

      {tab === "businesses" && (
        <section className={CARD_SECTION}>
          <header className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className={ICON_TILE}>
                <Building2 className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">
                  {bizTitle}
                </h2>
              </div>
            </div>

            <button
              type="button"
              onClick={() => loadBusinesses(bizStatus, bizQuery)}
              disabled={loadingBiz}
              aria-label={txtLoading}
              className="ring-focus rounded-lg border border-border/60 bg-background p-2 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              <RotateCcw
                className={loadingBiz ? "h-4 w-4 animate-spin" : "h-4 w-4"}
              />
            </button>
          </header>

          <div className="relative mt-4">
            <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-muted-foreground" />
            <input
              value={bizQuery}
              onChange={(event) => setBizQuery(event.target.value)}
              placeholder={bizSearchPlaceholder}
              className={
                "ring-focus w-full rounded-lg border border-border/60 bg-background py-2 ps-9 pe-3 text-sm outline-none"
              }
            />
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {BIZ_STATUSES.map((key) => {
              const active = bizStatus === key;
              const cls = active
                ? "ring-focus rounded-lg border border-primary bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors"
                : "ring-focus rounded-lg border border-border/60 bg-background px-3 py-2 text-xs font-medium transition-colors hover:bg-muted";
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setBizStatus(key)}
                  className={cls}
                >
                  {bizStatusLabels[key]}
                </button>
              );
            })}
          </div>

          {loadingBiz ? (
            <div
              className={
                INPUT_BASE +
                " mt-4 flex items-center gap-2 text-muted-foreground"
              }
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              {txtLoading}
            </div>
          ) : bizRows.length === 0 ? (
            <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/60 bg-muted/20 p-6 text-center">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{bizEmpty}</p>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {bizRows.map((biz) => {
                const badgeClass = bizStatusBadgeClass(biz.status);
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
                  <article
                    key={biz.id}
                    className="rounded-xl border border-border/60 bg-background p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate font-semibold">
                            {biz.name}
                          </h3>
                          <span
                            className={
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium " +
                              badgeClass
                            }
                          >
                            {biz.status}
                          </span>
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="font-mono opacity-80">
                            {"/book/" + biz.slug}
                          </span>
                          {biz.country && (
                            <span className="opacity-50">•</span>
                          )}
                          {biz.country && <span>{biz.country}</span>}
                          <span className="opacity-50">•</span>
                          <span>{biz.currency}</span>
                        </div>
                      </div>

                      <div className="flex shrink-0 gap-2">
                        <a
                          href={panelLink}
                          aria-label={enterPanelText}
                          title={enterPanelText}
                          className="ring-focus rounded-lg border border-primary/40 bg-primary/5 p-2 text-primary transition-colors hover:bg-primary/10"
                        >
                          <LogIn className="h-3.5 w-3.5" />
                        </a>

                        <a
                          href={bizLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={txtViewBusiness}
                          title={txtViewBusiness}
                          className="ring-focus rounded-lg border border-border/60 bg-background p-2 text-muted-foreground transition-colors hover:bg-muted"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </div>

                    <div className="mt-3 space-y-1.5 text-xs">
                      <div className="flex items-start gap-2 text-muted-foreground">
                        <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                          {bizOwner}
                          {": "}
                          {ownerLink ? (
                            <a
                              href={ownerLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-foreground underline-offset-2 hover:underline"
                            >
                              {ownerName}
                            </a>
                          ) : (
                            <span className="font-medium text-foreground">
                              {ownerName}
                            </span>
                          )}
                        </span>
                      </div>

                      <div className="flex items-start gap-2 text-muted-foreground">
                        <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{createdDate}</span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {bizServices}
                          {": "}
                          <span className="tabular font-medium text-foreground">
                            {nf(biz.counts.services)}
                          </span>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays className="h-3 w-3" />
                          {bizBookings}
                          {": "}
                          <span className="tabular font-medium text-foreground">
                            {nf(biz.counts.bookings)}
                          </span>
                        </span>
                      </div>
                    </div>

                    <a
                      href={panelLink}
                      className="ring-focus mt-3 flex items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
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
