"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

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

export function TelegramAuthGate({ children }: Props) {
  const [user, setUser] = useState<TelegramUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function authenticate(attempt = 0) {
      try {
        const telegram = window.Telegram;
        const tg = telegram?.WebApp;

        if (!tg) {
          if (attempt < 40) {
            timer = setTimeout(() => {
              authenticate(attempt + 1);
            }, 250);
            return;
          }

          if (!cancelled) {
            setError(
              "Telegram WebApp SDK در دسترس نیست. Mini App را مستقیماً از داخل Telegram باز کنید."
            );
            setLoading(false);
          }

          return;
        }

        tg.ready();
        tg.expand();

        if (!tg.initData) {
          if (attempt < 40) {
            timer = setTimeout(() => {
              authenticate(attempt + 1);
            }, 250);
            return;
          }

          if (!cancelled) {
            setError(
              "اطلاعات احراز هویت Telegram دریافت نشد. Mini App را دوباره از داخل Telegram باز کنید."
            );
            setLoading(false);
          }

          return;
        }

        const response = await fetch("/api/auth/telegram", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({
            initData: tg.initData,
          }),
        });

        let data: {
          user?: TelegramUser;
          error?: string;
          reason?: string;
        } = {};

        try {
          data = await response.json();
        } catch {
          throw new Error(
            "پاسخ معتبر از سرور احراز هویت دریافت نشد."
          );
        }

        if (!response.ok) {
          throw new Error(
            data?.reason
              ? `${data.error || "احراز هویت Telegram ناموفق بود."}: ${data.reason}`
              : data?.error || "احراز هویت Telegram ناموفق بود."
          );
        }

        if (!data.user) {
          throw new Error(
            "کاربر احراز هویت شد اما اطلاعات کاربر از سرور دریافت نشد."
          );
        }

        if (!cancelled) {
          setUser(data.user);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "خطایی در احراز هویت رخ داد."
          );
          setLoading(false);
        }
      }
    }

    authenticate();

    return () => {
      cancelled = true;

      if (timer) {
        clearTimeout(timer);
      }
    };
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl bg-[#B8D4F5] p-8 text-center shadow-elevated">
          <span className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-soft">
            <Loader2 className="h-8 w-8 animate-spin text-[#4F5FE8]" />
          </span>

          <p className="text-base font-bold text-[#1A1F36]">
            در حال ورود به Bookora...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl bg-[#B8D4F5] p-8 text-center shadow-elevated">
          <span className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[#4F5FE8] shadow-soft">
            <ShieldCheck className="h-8 w-8 text-white" />
          </span>

          <h1 className="text-xl font-bold text-[#1A1F36]">
            ورود به Bookora
          </h1>

          <p className="mt-3 text-sm font-medium leading-7 text-[#1A1F36]/70">
            {error}
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <>{children(user)}</>;
}
