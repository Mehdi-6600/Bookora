"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Send, ShieldCheck } from "lucide-react";
import { track } from "@/lib/funnel-client";

type TelegramUser = {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
  isAdmin: boolean;
};

type Props = {
  children: (user: TelegramUser) => React.ReactNode;
};

const MAX_ATTEMPTS = 40;
const RETRY_MS = 250;

export function TelegramAuthGate({ children }: Props) {
  const t = useTranslations("telegramAuth");
  const locale = useLocale();

  const [user, setUser] = useState<TelegramUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function authenticate(attemptNumber = 0) {
      try {
        const tg = window.Telegram?.WebApp;

        // The Telegram WebApp script and `initData` can both arrive a little
        // after first paint inside the Mini App, so poll briefly before giving
        // up instead of failing instantly.
        if (!tg || !tg.initData) {
          if (attemptNumber < MAX_ATTEMPTS) {
            timer = setTimeout(() => {
              authenticate(attemptNumber + 1);
            }, RETRY_MS);
            return;
          }

          if (!cancelled) {
            setError(!tg ? "sdkMissing" : "initDataMissing");
            setLoading(false);
          }
          return;
        }

        tg.ready();
        tg.expand();

        const response = await fetch("/api/auth/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({ initData: tg.initData }),
        });

        let data: { user?: TelegramUser; error?: string } = {};
        try {
          data = await response.json();
        } catch {
          if (!cancelled) {
            setError("serverUnreachable");
            setLoading(false);
          }
          return;
        }

        if (!response.ok || !data.user) {
          if (!cancelled) {
            setError("failed");
            setLoading(false);
          }
          return;
        }

        if (!cancelled) {
          setUser(data.user);
          setError(null);
          setLoading(false);
          track("registration_completed", { locale });
        }
      } catch {
        if (!cancelled) {
          setError("failed");
          setLoading(false);
        }
      }
    }

    authenticate();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl bg-[#B8D4F5] p-8 text-center shadow-elevated">
          <span className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-soft">
            <Loader2 className="h-8 w-8 animate-spin text-[#4F5FE8]" />
          </span>
          <p className="text-base font-bold text-[#1A1F36]">{t("loading")}</p>
        </div>
      </div>
    );
  }

  if (error) {
    const botUrl = "https://t.me/Bookora_App_bot";

    return (
      <div
        className="flex min-h-screen items-center justify-center p-6"
        dir={locale === "fa" || locale === "ar" ? "rtl" : "ltr"}
      >
        <div className="w-full max-w-md space-y-4 rounded-3xl bg-[#B8D4F5] p-8 text-center shadow-elevated">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#4F5FE8] shadow-soft">
            <ShieldCheck className="h-8 w-8 text-white" />
          </span>

          <h1 className="text-xl font-bold text-[#1A1F36]">{t("title")}</h1>
          <p className="text-sm font-medium leading-7 text-[#1A1F36]/70">
            {t(error)}
          </p>

          <a
            href={botUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track("signup_cta_click", { locale })}
            className="btn-elevated flex w-full items-center justify-center gap-2 rounded-2xl bg-[#4F5FE8] px-5 py-4 text-base font-bold text-white transition-transform active:scale-[0.98]"
          >
            <Send className="h-5 w-5" />
            {t("openInTelegram")}
          </a>

          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setError(null);
              setAttempt((value) => value + 1);
            }}
            className="w-full rounded-2xl bg-white px-5 py-3 text-sm font-bold text-[#1A1F36] shadow-soft transition-transform active:scale-[0.98]"
          >
            {t("retry")}
          </button>

          <p className="text-xs font-medium leading-6 text-[#1A1F36]/60">
            {t("whyTelegram")}
          </p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return <>{children(user)}</>;
}
