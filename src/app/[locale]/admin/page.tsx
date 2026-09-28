"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  FileText,
  Hash,
  Loader2,
  Receipt,
  RotateCcw,
  ShieldCheck,
  StickyNote,
  X,
  XCircle,
} from "lucide-react";
import { TelegramAuthGate } from "@/components/telegram/auth-gate";
import { PLANS, PlanCode } from "@/lib/subscription/plans";
import { MANUAL_PAYMENT_SETTING_KEYS } from "@/lib/admin-settings";

type SettingRow = { key: string; value: string };

type FilterKey = "PENDING" | "ACTIVE" | "REJECTED";

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

const FILTERS: FilterKey[] = ["PENDING", "ACTIVE", "REJECTED"];

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

function statusBadgeClass(status: string): string {
  if (status === "ACTIVE") {
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  }
  if (status === "REJECTED") {
    return "bg-destructive/10 text-destructive";
  }
  return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
}

function AdminDashboard({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations("admin");
  const tSub = useTranslations("subscription");
  const locale = useLocale();

  const planLabels: Record<PlanCode, string> = {
    PRO_MONTHLY: tSub("planMonthly"),
    PRO_YEARLY: tSub("planYearly"),
  };

  const settingLabels: Record<string, string> = {
    payment_card_number: t("settingLabels.payment_card_number"),
    payment_card_holder: t("settingLabels.payment_card_holder"),
    payment_bank_name: t("settingLabels.payment_bank_name"),
    payment_instructions: t("settingLabels.payment_instructions"),
  };

  const [settings, setSettings] = useState<SettingRow[]>(
    MANUAL_PAYMENT_SETTING_KEYS.map((key) => ({ key, value: "" }))
  );
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  const [filter, setFilter] = useState<FilterKey>("PENDING");
  const [rows, setRows] = useState<SubscriptionRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const [message, setMessage] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

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

  const loadRows = useCallback(async (which: FilterKey) => {
    try {
      setLoadingRows(true);
      const response = await fetch(
        `/api/admin/subscriptions?status=${which}`,
        { cache: "no-store" }
      );
      const data = await response.json();
      if (response.ok) setRows(data.subscriptions || []);
    } finally {
      setLoadingRows(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      loadSettings();
    }
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin) {
      loadRows(filter);
    }
  }, [isAdmin, filter, loadRows]);

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
      if (!response.ok) throw new Error(data?.error || t("saveError"));
      setMessage({ kind: "ok", text: t("saved") });
    } catch (error) {
      setMessage({
        kind: "err",
        text: error instanceof Error ? error.message : t("saveError"),
      });
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
      const response = await fetch(`/api/admin/subscriptions/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          note: note && note.trim() ? note.trim() : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || t("reviewError"));
      setRejectingId(null);
      setRejectNote("");
      await loadRows(filter);
      setMessage({
        kind: "ok",
        text: action === "approve" ? t("approved") : t("rejected"),
      });
    } catch (error) {
      setMessage({
        kind: "err",
        text: error instanceof Error ? error.message : t("reviewError"),
      });
    } finally {
      setReviewingId(null);
    }
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center px-4">
        <div className="rounded-2xl border border-border/60 bg-card p-6 text-center shadow-soft">
          <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("noAccess")}</p>
        </div>
      </div>
    );
  }

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

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      <header className="rounded-2xl border border-border/60 bg-card p-5 shadow-soft">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {t("title")}
            </h1>
          </div>
        </div>
      </header>

      {message && (
        <div
          className={
            message.kind === "ok"
              ? "flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5 text-sm text-emerald-700 shadow-soft dark:text-emerald-400"
              : "flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3.5 text-sm text-destructive shadow-soft"
          }
        >
          {message.kind === "ok" ? (
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <X className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-soft">
        <header className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <CreditCard className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              {t("paymentInfoTitle")}
            </h2>
          </div>
        </header>

        {loadingSettings ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-border/60 bg-background p-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("loading")}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {settings.map((setting, index) => (
              <div key={setting.key}>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  {settingLabels[setting.key] || setting.key}
                </label>
                <input
                  value={setting.value}
                  onChange={(event) => {
                    const next = [...settings];
                    next[index] = { ...setting, value: event.target.value };
                    setSettings(next);
                  }}
                  className="ring-focus w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none"
                />
              </div>
            ))}

            <button
              type="button"
              onClick={saveSettings}
              disabled={savingSettings}
              className="ring-focus flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {savingSettings && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {savingSettings ? t("saving") : t("saveButton")}
            </button>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-soft">
        <header className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Receipt className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                {t("pendingTitle", { count: rows.length })}
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={() => loadRows(filter)}
            disabled={loadingRows}
            className="ring-focus rounded-lg border border-border/60 bg-background p-2 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
            aria-label={t("loading")}
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
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={
                  active
                    ? "ring-focus rounded-lg border border-primary bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors"
                    : "ring-focus rounded-lg border border-border/60 bg-background px-3 py-2 text-xs font-medium transition-colors hover:bg-muted"
                }
              >
                {filterLabels[key]}
              </button>
            );
          })}
        </div>

        {loadingRows ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-border/60 bg-background p-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("loading")}
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
                planLabels[sub.plan as PlanCode] || sub.plan;
              const isPending = sub.status === "PENDING";
              const badgeClass = statusBadgeClass(sub.status);

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
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${badgeClass}`}
                        >
                          {filterLabels[
                            sub.status as FilterKey
                          ] || sub.status}
                        </span>
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Building2 className="h-3 w-3" />
                          {sub.businessName || t("noBusiness")}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <CreditCard className="h-3 w-3" />
                          {planLabel}
                        </span>
                      </div>
                    </div>

                    {sub.businessSlug && (
                      <a
                        href={`/book/${sub.businessSlug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ring-focus shrink-0 rounded-lg border border-border/60 bg-background p-2 text-muted-foreground transition-colors hover:bg-muted"
                        aria-label={t("viewBusiness")}
                        title={t("viewBusiness")}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>

                  <dl className="mt-3 space-y-1.5 text-xs">
                    <div className="flex items-start gap-2 text-muted-foreground">
                      <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        {t("submittedAt", {
                          date: formatDate(sub.createdAt, locale),
                        })}
                      </span>
                    </div>

                    {sub.receiptReference && (
                      <div className="flex items-start gap-2 text-muted-foreground">
                        <Hash className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="break-all">
                          {t("receiptLabel", { ref: sub.receiptReference })}
                        </span>
                      </div>
                    )}

                    {sub.receiptNote && (
                      <div className="flex items-start gap-2 text-muted-foreground">
                        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="break-words">
                          {t("noteLabel", { note: sub.receiptNote })}
                        </span>
                      </div>
                    )}

                    {sub.reviewedAt && (
                      <div className="flex items-start gap-2 text-muted-foreground">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                          {t("reviewedAt", {
                            date: formatDate(sub.reviewedAt, locale),
                          })}
                        </span>
                      </div>
                    )}

                    {sub.adminNote && (
                      <div className="flex items-start gap-2 text-muted-foreground">
                        <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="break-words">
                          {t("adminNote", { note: sub.adminNote })}
                        </span>
                      </div>
                    )}
                  </dl>

                  {isPending && rejectingId === sub.id && (
                    <div className="mt-3 space-y-2">
                      <input
                        value={rejectNote}
                        onChange={(event) =>
                          setRejectNote(event.target.value)
                        }
                        placeholder={t("rejectNotePlaceholder")}
                        className="ring-focus w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => review(sub.id, "reject", rejectNote)}
                          disabled={reviewingId === sub.id}
                          className="ring-focus flex items-center justify-center gap-2 rounded-lg bg-destructive px-3 py-2 text-xs font-medium text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                          {reviewingId === sub.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5" />
                          )}
                          {t("rejectButton")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRejectingId(null);
                            setRejectNote("");
                          }}
                          className="ring-focus rounded-lg border border-border/60 bg-background px-3 py-2 text-xs font-medium transition-colors hover:bg-muted"
                        >
                          {tSub("cancelButton")}
                        </button>
                      </div>
                    </div>
                  )}

                  {isPending && rejectingId !== sub.id && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => review(sub.id, "approve")}
                        disabled={reviewingId === sub.id}
                        className="ring-focus flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        {reviewingId === sub.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        {t("approveButton")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRejectingId(sub.id);
                          setRejectNote("");
                        }}
                        disabled={reviewingId === sub.id}
                        className="ring-focus flex items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-background px-3 py-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/5 disabled:opacity-50"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        {t("rejectButton")}
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default function AdminPage() {
  return (
    <main className="min-h-screen">
      <TelegramAuthGate>
        {(userلی) => <AdminDashboard isAdmin={user.isAdmin} از />}
      </TelegramAuthGate>
    </main>
  );
}
