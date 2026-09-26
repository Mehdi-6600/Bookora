"use client";

import { useEffect, useState } from "react";

type Status = "loading" | "ready" | "error" | "outside-telegram";

type AuthUser = {
  id: string;
  telegramId: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  languageCode: string | null;
  isAdmin: boolean;
};

type Props = {
  children: (user: AuthUser) => React.ReactNode;
};

export function TelegramAuthGate({ children }: Props) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;

    if (!tg) {
      setStatus("outside-telegram");
      return;
    }

    tg.ready();
    tg.expand();

    const initData = tg.initData;

    if (!initData) {
      setStatus("outside-telegram");
      return;
    }

    fetch("/api/auth/telegram", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ initData }),
      credentials: "include",
    })
      .then(async (res) => {
        const data = await res.json();

        if (!res.ok || data.error) {
          throw new Error(data.reason ?? data.error ?? "Authentication failed");
        }

        return data;
      })
      .then((data) => {
        setUser(data.user);
        setStatus("ready");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Authentication failed");
        setStatus("error");
      });
  }, []);

  if (status === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-foreground" />
          <p className="text-sm text-muted-foreground">Loading Bookora...</p>
        </div>
      </div>
    );
  }

  if (status === "outside-telegram") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
          <div className="mb-4 text-4xl">📱</div>
          <h1 className="text-xl font-bold">Bookora Mini App</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            این بخش باید از داخل مینی‌اپ تلگرام Bookora باز شود.
          </p>
        </div>
      </div>
    );
  }

  if (status === "error" || !user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-destructive/30 bg-card p-8 text-center shadow-sm">
          <div className="mb-4 text-4xl">⚠️</div>
          <h1 className="text-xl font-bold">خطا در ورود</h1>
          <p className="mt-3 break-words text-sm text-muted-foreground">
            {error ?? "Authentication failed"}
          </p>
        </div>
      </div>
    );
  }

  return <>{children(user)}</>;
}
