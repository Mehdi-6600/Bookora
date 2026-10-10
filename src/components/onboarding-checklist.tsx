"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  Share2,
  Sparkles,
} from "lucide-react";
import { track } from "@/lib/funnel-client";

type Props = {
  businessId: string;
  hasActiveServices: boolean;
  bookingUrl: string;
};

/**
 * Short activation checklist.
 *
 * The goal is a shareable booking link as fast as possible: show what is done,
 * name the single next action, and put copy/share one tap away once the link
 * works. It hides itself permanently once every step is complete.
 */

const STORAGE_KEY = "bookora:onboarding-dismissed";

export function OnboardingChecklist({
  businessId,
  hasActiveServices,
  bookingUrl,
}: Props) {
  const t = useTranslations("onboarding");
  const locale = useLocale();

  const [hoursConfigured, setHoursConfigured] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(
          `/api/working-hours?businessId=${encodeURIComponent(businessId)}`,
          { cache: "no-store" }
        );
        if (!response.ok) return;
        const data = await response.json();
        const enabled = Array.isArray(data.workingHours)
          ? data.workingHours.some((day: { enabled: boolean }) => day.enabled)
          : false;
        if (cancelled) return;
        setHoursConfigured(enabled);
        if (enabled) track("working_hours_configured", { locale });
      } catch {
        if (!cancelled) setHoursConfigured(null);
      }
    }

    if (businessId) void load();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  const steps = [
    { key: "stepBusiness", done: true, label: t("stepBusiness") },
    { key: "stepService", done: hasActiveServices, label: t("stepService") },
    { key: "stepHours", done: hoursConfigured === true, label: t("stepHours") },
    { key: "stepShare", done: false, label: t("stepShare") },
  ];

  const linkReady = hasActiveServices && hoursConfigured === true;
  const firstPending = steps.find((step) => !step.done);

  if (dismissed) return null;

  async function copyLink() {
    const url = bookingUrl;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = url;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function shareLink() {
    const text = t("complete");

    // Inside Telegram, open the native share dialog for the link.
    const tg = window.Telegram?.WebApp;
    if (tg && typeof tg.openTelegramLink === "function") {
      const shareUrl =
        `https://t.me/share/url?url=${encodeURIComponent(bookingUrl)}` +
        `&text=${encodeURIComponent(text)}`;
      tg.openTelegramLink(shareUrl);
      return;
    }

    const nav = navigator as Navigator & {
      share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
    };

    if (typeof nav.share === "function") {
      void nav.share({ title: "Bookora", text, url: bookingUrl }).catch(() => {
        void copyLink();
      });
      return;
    }

    void copyLink();
  }

  return (
    <section className="rounded-3xl bg-[#B8D4F5] p-5 shadow-soft">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-soft">
          <Sparkles className="h-5 w-5 text-[#4F5FE8]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-[#1A1F36]">{t("title")}</h2>
          <p className="mt-0.5 text-xs font-medium text-[#1A1F36]/60">
            {t("subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setDismissed(true);
            try {
              window.localStorage.setItem(STORAGE_KEY, "1");
            } catch {
              // Ignore storage restrictions.
            }
          }}
          className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-[#1A1F36]/60 underline-offset-4 hover:underline"
        >
          {t("skip")}
        </button>
      </div>

      <ol className="mt-4 space-y-2">
        {steps.map((step) => (
          <li
            key={step.key}
            className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-soft"
          >
            <span
              className={
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full " +
                (step.done ? "bg-[#34C759]" : "bg-[#1A1F36]/10")
              }
            >
              {step.done ? (
                <Check className="h-4 w-4 text-white" />
              ) : (
                <ChevronRight className="h-4 w-4 text-[#1A1F36]/50" />
              )}
            </span>

            <span
              className={
                "min-w-0 flex-1 text-sm font-semibold " +
                (step.done ? "text-[#1A1F36]/50 line-through" : "text-[#1A1F36]")
              }
            >
              {step.label}
            </span>

            <span
              className={
                "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold " +
                (step.done
                  ? "bg-[#34C759] text-white"
                  : "bg-[#1A1F36]/10 text-[#1A1F36]/70")
              }
            >
              {step.done ? t("done") : t("todo")}
            </span>
          </li>
        ))}
      </ol>

      {hoursConfigured === null && (
        <p className="mt-3 flex items-center gap-2 text-xs font-medium text-[#1A1F36]/60">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("stepHours")}
        </p>
      )}

      {linkReady ? (
        <div className="mt-4">
          <p className="rounded-2xl bg-[#34C759] p-3.5 text-sm font-bold text-white shadow-soft">
            {t("complete")}
          </p>

          <p className="mt-3 break-all rounded-2xl bg-white px-4 py-3 text-sm font-bold text-[#1A1F36] shadow-soft">
            {bookingUrl}
          </p>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={copyLink}
              className="flex items-center justify-center gap-1.5 rounded-2xl bg-white px-3 py-3 text-xs font-bold text-[#1A1F36] shadow-soft transition-transform active:scale-[0.98]"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 text-[#34C759]" />
                  {t("copied")}
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  {t("copy")}
                </>
              )}
            </button>

            <button
              type="button"
              onClick={shareLink}
              className="btn-elevated flex items-center justify-center gap-1.5 rounded-2xl bg-[#4F5FE8] px-3 py-3 text-xs font-bold text-white transition-transform active:scale-[0.98]"
            >
              <Share2 className="h-4 w-4" />
              {t("share")}
            </button>

            <a
              href={bookingUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track("booking_link_opened", { locale })}
              className="flex items-center justify-center gap-1.5 rounded-2xl bg-white px-3 py-3 text-xs font-bold text-[#1A1F36] shadow-soft transition-transform active:scale-[0.98]"
            >
              <ExternalLink className="h-4 w-4" />
              {t("openLink")}
            </a>
          </div>
        </div>
      ) : (
        firstPending && (
          <p className="mt-4 rounded-2xl bg-white px-4 py-3 text-sm font-bold text-[#1A1F36] shadow-soft">
            {t("nextAction", { step: firstPending.label })}
          </p>
        )
      )}

    </section>
  );
}
