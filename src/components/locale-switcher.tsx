"use client";

import { useLocale } from "next-intl";
import { useParams, usePathname, useRouter } from "next/navigation";
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
  const params = useParams();

  function switchTo(nextLocale: string) {
    const segments = pathname.split("/").filter(Boolean);

    // اگر بخش اول مسیر یکی از locale های موجود باشد، جایگزین می‌شود؛
    // در غیر این صورت (مثلاً روی defaultLocale بدون پیشوند) locale جدید اضافه می‌شود.
    if (routing.locales.includes(segments[0] as (typeof routing.locales)[number])) {
      segments[0] = nextLocale;
    } else {
      segments.unshift(nextLocale);
    }

    const newPath =
      "/" +
      segments
        .filter((seg, index) => !(index === 0 && seg === routing.defaultLocale))
        .join("/");

    router.push(newPath || "/");
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
