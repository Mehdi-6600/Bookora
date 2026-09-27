"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

const LOCALE_LABELS: Record<string, string> = {
  fa: "فا",
  en: "EN",
  ar: "عربي",
};

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  function switchTo(nextLocale: string) {
    // pathname اینجا از next-intl گرفته شده و از قبل بدون پیشوند locale است؛
    // router.replace خودش پیشوند مناسب (یا نبود پیشوند برای en) و Cookie را مدیریت می‌کند.
    router.replace(pathname, { locale: nextLocale });
  }

  return (
    <div className="flex gap-1 rounded-lg border p-1 text-xs">
      {routing.locales.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => switchTo(code)}
          className={`rounded-md px-2 py-1 font-medium ${
            locale === code
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground"
          }`}
        >
          {LOCALE_LABELS[code] || code}
        </button>
      ))}
    </div>
  );
}
