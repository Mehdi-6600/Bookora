"use client";

import { useEffect, useState } from "react";
import { TelegramAuthGate } from "@/components/telegram/auth-gate";
import { PLANS, PlanCode } from "@/lib/subscription/plans";
import { MANUAL_PAYMENT_SETTING_KEYS } from "@/lib/admin-settings";

type SettingRow = { key: string; value: string };

type PendingSubscription = {
  id: string;
  plan: string;
  receiptReference: string | null;
  receiptNote: string | null;
  createdAt: string;
  businessName: string | null;
  userName: string;
};

const SETTING_LABELS: Record<string, string> = {
  payment_card_number: "شماره کارت",
  payment_card_holder: "نام صاحب حساب",
  payment_bank_name: "نام بانک",
  payment_instructions: "توضیحات پرداخت",
};

function AdminDashboard({ isAdmin }: { isAdmin: boolean }) {
  const [settings, setSettings] = useState<SettingRow[]>(
    MANUAL_PAYMENT_SETTING_KEYS.map((key) => ({ key, value: "" }))
  );
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  const [pending, setPending] = useState<PendingSubscription[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const [message, setMessage] = useState<string | null>(null);

  async function loadSettings() {
    try {
      setLoadingSettings(true);
      const response = await fetch("/api/admin/settings", {
        cache: "no-store",
      });
      const data = await response.json();

      if (response.ok) {
        setSettings(data.settings);
      }
    } finally {
      setLoadingSettings(false);
    }
  }

  async function loadPending() {
    try {
      setLoadingPending(true);
      const response = await fetch("/api/admin/subscriptions", {
        cache: "no-store",
      });
      const data = await response.json();

      if (response.ok) {
        setPending(data.subscriptions);
      }
    } finally {
      setLoadingPending(false);
    }
  }

  useEffect(() => {
    if (isAdmin) {
      loadSettings();
      loadPending();
    }
  }, [isAdmin]);

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
        throw new Error(data?.error || "ذخیره ناموفق بود.");
      }

      setMessage("تنظیمات ذخیره شد.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ذخیره ناموفق بود.");
    } finally {
      setSavingSettings(false);
    }
  }

  async function review(id: string, action: "approve" | "reject") {
    try {
      setReviewingId(id);
      setMessage(null);

      const response = await fetch(`/api/admin/subscriptions/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "بررسی ناموفق بود.");
      }

      await loadPending();
      setMessage(action === "approve" ? "اشتراک فعال شد." : "درخواست رد شد.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "بررسی ناموفق بود.");
    } finally {
      setReviewingId(null);
    }
  }

  if (!isAdmin) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        دسترسی ندارید.
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 py-6">
      <h1 className="text-2xl font-bold">پنل ادمین</h1>

      {message && (
        <div className="rounded-xl border bg-card p-4 text-sm">{message}</div>
      )}

      <section className="space-y-3 rounded-2xl border bg-card p-5 shadow-sm">
        <h2 className="text-xl font-bold">اطلاعات پرداخت کارت‌به‌کارت</h2>

        {loadingSettings ? (
          <p className="text-sm text-muted-foreground">در حال بارگذاری...</p>
        ) : (
          <>
            {settings.map((setting, index) => (
              <div key={setting.key}>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {SETTING_LABELS[setting.key] || setting.key}
                </label>
                <input
                  value={setting.value}
                  onChange={(event) => {
                    const next = [...settings];
                    next[index] = { ...setting, value: event.target.value };
                    setSettings(next);
                  }}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none"
                />
              </div>
            ))}

            <button
              type="button"
              onClick={saveSettings}
              disabled={savingSettings}
              className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {savingSettings ? "در حال ذخیره..." : "ذخیره تنظیمات"}
            </button>
          </>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border bg-card p-5 shadow-sm">
        <h2 className="text-xl font-bold">
          درخواست‌های در انتظار تأیید ({pending.length})
        </h2>

        {loadingPending ? (
          <p className="text-sm text-muted-foreground">در حال بارگذاری...</p>
        ) : pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            درخواست در انتظاری وجود ندارد.
          </p>
        ) : (
          <div className="space-y-3">
            {pending.map((sub) => (
              <div key={sub.id} className="rounded-xl border p-4 text-sm">
                <p className="font-semibold">
                  {sub.userName} — {sub.businessName || "بدون کسب‌وکار"}
                </p>
                <p className="mt-1">
                  پلن: {PLANS[sub.plan as PlanCode]?.titleFa || sub.plan}
                </p>
                <p className="mt-1 text-muted-foreground">
                  کد رهگیری: {sub.receiptReference}
                </p>
                {sub.receiptNote && (
                  <p className="mt-1 text-muted-foreground">
                    یادداشت: {sub.receiptNote}
                  </p>
                )}

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => review(sub.id, "approve")}
                    disabled={reviewingId === sub.id}
                    className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  >
                    تأیید
                  </button>
                  <button
                    type="button"
                    onClick={() => review(sub.id, "reject")}
                    disabled={reviewingId === sub.id}
                    className="rounded-lg border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive disabled:opacity-50"
                  >
                    رد
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default function AdminPage() {
  return (
    <main className="min-h-screen px-4">
      <TelegramAuthGate>
        {(user) => <AdminDashboard isAdmin={user.isAdmin} />}
      </TelegramAuthGate>
    </main>
  );
}
