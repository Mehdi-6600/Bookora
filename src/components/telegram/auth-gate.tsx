"use client";

import { useEffect, useState } from "react";

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
        const tg = window.Telegram?.WebApp;

        if (!tg) {
          if (attempt < 20) {
            timer = setTimeout(() => {
              authenticate(attempt + 1);
            }, 250);
            return;
          }

          if (!cancelled) {
            setError("این صفحه باید داخل تلگرام باز شود.");
            setLoading(false);
          }

          return;
        }

        tg.ready();
        tg.expand();

        if (!tg.initData) {
          if (attempt < 20) {
            timer = setTimeout(() => {
              authenticate(attempt + 1);
            }, 250);
            return;
          }

          if (!cancelled) {
            setError("اطلاعات احراز هویت تلگرام دریافت نشد.");
            setLoading(false);
          }

          return;
        }

        const response = await fetch("/api/auth/telegram", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            initData: tg.initData,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data?.reason
              ? `${data.error}: ${data.reason}`
              : data?.error || "احراز هویت تلگرام ناموفق بود."
          );
        }

        if (!cancelled) {
          setUser(data.user);
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
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />

          <p className="text-sm text-muted-foreground">
            در حال ورود به Bookora...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border bg-card p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold">ورود به Bookora</h1>

          <p className="mt-3 text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <>{children(user)}</>;
}
