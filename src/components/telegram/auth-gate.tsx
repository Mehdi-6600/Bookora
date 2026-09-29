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

  // ==================== LOADING ====================
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

  // ==================== ERROR ====================
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

          <p className="mt-3 text-sm font-medium text-[#1A1F36]/70">
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
