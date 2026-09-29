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

// رنگ ثابت Bookora (هم‌رنگ لوگو) — همیشه روی header/background تلگرام اعمال می‌شود.
const BOOKORA_BG = "#0B1437";
const BOOKORA_HEADER = "#0B1437";

function getWebApp(): TelegramWebAppWithTheme | undefined {
  return (
    window as unknown as { Telegram?: { WebApp?: TelegramWebAppWithTheme } }
  ).Telegram?.WebApp;
}

// Bookora همیشه در تم تیره نمایش داده می‌شود (طبق طراحی برند).
// بنابراین کلاس `dark` همیشه روی <html> باقی می‌ماند و رنگ‌های
// header/background تلگرام هم با رنگ برند هماهنگ می‌شوند.
export function TelegramThemeSync() {
  useEffect(() => {
    function applyTheme() {
      const tg = getWebApp();

      // همیشه dark بماند — فارغ از theme تلگرام.
      document.documentElement.classList.add("dark");

      if (!tg) return;

      // رنگ هدر و پس‌زمینه‌ی تلگرام با رنگ برند هماهنگ شود.
      try {
        tg.setHeaderColor?.(BOOKORA_HEADER);
        tg.setBackgroundColor?.(BOOKORA_BG);
      } catch {
        // اگر Telegram API پشتیبانی نکرد، بی‌صدا رد شود.
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
