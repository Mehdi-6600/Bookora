"use client";

import { useEffect, useState } from "react";

type Status = "loading" | "ready" | "error" | "outside-telegram";

export function TelegramAuthGate() {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<unknown>(null);
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData }),
      credentials: "include",
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.reason ?? data.error);
          setStatus("error");
          return;
        }
        setUser(data.user);
        setStatus("ready");
      })
      .catch((err) => {
        setError(err.message);
        setStatus("error");
      });
  }, []);

  if (status === "loading") {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  if (status === "outside-telegram") {
    return (
      <div className="text-center space-y-2">
        <p className="text-lg font-medium">این صفحه باید داخل تلگرام باز بشه</p>
        <p className="text-sm text-muted-foreground">
          از دکمه‌ی مینی‌اپ ربات استفاده کن.
        </p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="text-center space-y-2">
        <p className="text-lg font-medium text-destructive">خطا در ورود</p>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div className="text-center space-y-2">
      <p className="text-lg font-medium">خوش اومدی! 🎉</p>
      <pre className="text-xs bg-muted p-4 rounded-md text-left overflow-auto max-w-sm">
        {JSON.stringify(user, null, 2)}
      </pre>
    </div>
  );
}
