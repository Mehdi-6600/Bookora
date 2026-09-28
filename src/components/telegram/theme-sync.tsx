"use client";

import { useEffect } from "react";

type TelegramThemeParams = {
  bg_color?: string;
  secondary_bg_color?: string;
};

type TelegramWebAppWithTheme = {
  colorScheme?: "light" | "dark";
  themeParams?: TelegramThemeParams;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  onEvent?: (event: string, callback: () => void) => void;
  offEvent?: (event: string, callback: () => void) => void;
};

function getWebApp(): TelegramWebAppWithTheme | undefined {
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebAppWithTheme } }).Telegram
    ?.WebApp;
}

// Header/Background تلگرام و کلاس Dark Mode صفحه را با تم فعلی کاربر (که ممکن است
// در حین استفاده هم عوض شود، مثلاً با تغییر تم سیستم) هماهنگ نگه می‌دارد.
export function TelegramThemeSync() {
  useEffect(() => {
    function applyTheme() {
      const tg = getWebApp();
      if (!tg) return;

      const isDark = tg.colorScheme === "dark";
      document.documentElement.classList.toggle("dark", isDark);

      const bg = tg.themeParams?.bg_color;
      if (bg) {
        tg.setHeaderColor?.(bg);
        tg.setBackgroundColor?.(bg);
      }
    }

    applyTheme();

    const tg = getWebApp();
    tg?.onEvent?.("themeChanged", applyTheme);

    return () => {
      tg?.offEvent?.("themeChanged", applyTheme);
    };
  }, []);

  return null;
}
