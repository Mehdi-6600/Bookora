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

const TELEGRAM_SCRIPT_ID = "telegram-web-app";
const TELEGRAM_SCRIPT_URL =
  "https://telegram.org/js/telegram-web-app.js?63";

function getTelegramWebApp() {
  return window.Telegram?.WebApp;
}

function waitForTelegramWebApp(
  timeoutMs = 15000
): Promise<NonNullable<ReturnType<typeof getTelegramWebApp>>> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const check = () => {
      const tg = getTelegramWebApp();

      if (tg) {
        resolve(tg);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        reject(
          new Error(
            "Telegram WebApp SDK بارگذاری نشد. لطفاً Mini App را دوباره باز کنید."
          )
        );
        return;
      }

      window.setTimeout(check, 100);
    };

    check();
  });
}

function ensureTelegramScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (getTelegramWebApp()) {
      resolve();
      return;
    }

    const existingScript = document.getElementById(
      TELEGRAM_SCRIPT_ID
    ) as HTMLScriptElement | null;

    if (existingScript) {
      const startedAt = Date.now();

      const checkExisting = () => {
        if (getTelegramWebApp()) {
          resolve();
          return;
        }

        if (Date.now() - startedAt >= 5000) {
          const fallbackScript = document.createElement("script");
          fallbackScript.id = `${TELEGRAM_SCRIPT_ID}-fallback`;
          fallbackScript.src = TELEGRAM_SCRIPT_URL;
          fallbackScript.async = false;

          fallbackScript.onload = () => resolve();
          fallbackScript.onerror = () =>
            reject(
              new Error(
                "بارگذاری Telegram WebApp SDK ناموفق بود."
              )
            );

          document.head.appendChild(fallbackScript);
          return;
        }

        window.setTimeout(checkExisting, 100);
      };

      existingScript.addEventListener("load", () => resolve(), {
        once: true,
      });

      existingScript.addEventListener(
        "error",
        () => {
          const fallbackScript = document.createElement("script");
          fallbackScript.id = `${TELEGRAM_SCRIPT_ID}-fallback`;
          fallbackScript.src = TELEGRAM_SCRIPT_URL;
          fallbackScript.async = false;

          fallbackScript.onload = () => resolve();
          fallbackScript.onerror = () =>
            reject(
              new Error(
                "بارگذاری Telegram WebApp SDK ناموفق بود."
              )
            );

          document.head.appendChild(fallbackScript);
        },
        { once: true }
      );

      checkExisting();
      return;
    }

    const script = document.createElement("script");

    script.id = TELEGRAM_SCRIPT_ID;
    script.src = TELEGRAM_SCRIPT_URL;
    script.async = false;

    script.onload = () => resolve();

    script.onerror = () =>
      reject(
        new Error(
          "بارگذاری Telegram WebApp SDK ناموفق بود."
        )
      );

    document.head.appendChild(script);
  });
}

export function TelegramAuthGate({ children }: Props) {
  const [user, setUser] = useState<TelegramUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function authenticate() {
      try {
        await ensureTelegramScript();

        const tg = await waitForTelegramWebApp();

        if (cancelled) {
          return;
        }

        tg.ready();
        tg.expand();

        if (!tg.initData) {
          throw new Error(
            "اطلاعات احراز هویت تلگرام دریافت نشد."
          );
        }

        const response = await fetch(
          "/api/auth/telegram",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            credentials: "include",
            cache: "no-store",
            body: JSON.stringify({
              initData: tg.initData,
            }),
          }
        );

        let data: {
          user?: TelegramUser;
          error?: string;
          reason?: string;
        } = {};

        try {
          data = await response.json();
        } catch {
          throw new Error(
            "پاسخ نامعتبر از سرور دریافت شد."
          );
        }

        if (!response.ok) {
          throw new Error(
            data.reason
              ? `${data.error || "احراز هویت ناموفق بود."}: ${data.reason}`
              : data.error ||
                  "احراز هویت تلگرام ناموفق بود."
          );
        }

        if (!data.user) {
          throw new Error(
            "اطلاعات کاربر از سرور دریافت نشد."
          );
        }

        if (!cancelled) {
          setUser(data.user);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (cancelled) {
          return;
        }

        setError(
          err instanceof Error
            ? err.message
            : "خطایی در احراز هویت رخ داد."
        );

        setLoading(false);
      }
    }

    authenticate();

    return () => {
      cancelled = true;
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
