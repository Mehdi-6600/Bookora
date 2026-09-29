"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

const LOCALE_LABELS: Record<string, string> = {
  fa: "فا",
  en: "EN",
  ar: "عربي",
};

const BTN_ACTIVE = "btn-selected rounded-xl px-3 py-1.5 text-xs font-bold transition-all active:scale-95";

const BTN_IDLE =
  "rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-[#1A1F36] shadow-soft transition-all active:scale-95";

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  function switchTo(nextLocale: string) {
    router.replace(pathname, { locale: nextLocale });
  }

  return (
    <div className="flex shrink-0 gap-1.5 rounded-2xl bg-[#B8D4F5] p-1.5 shadow-soft">
      {routing.locales.map((code) => {
        const isActive = locale === code;
        return (
          <button
            key={code}
            type="button"
            onClick={() => switchTo(code)}
            className={isActive ? BTN_ACTIVE : BTN_IDLE}
          >
            {LOCALE_LABELS[code] || code}
          </button>
        );
      })}
    </div>
  );
}
