import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { env } from "@/lib/env";
import { ACQUISITION_SEGMENTS } from "@/lib/marketing/segments";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = env.APP_URL.replace(/\/+$/, "");

  return routing.locales.flatMap((locale) => {
    const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
    return [
      {
        url: `${baseUrl}${prefix || "/"}`,
        changeFrequency: "weekly" as const,
        priority: 1,
      },
      ...ACQUISITION_SEGMENTS.map((segment) => ({
        url: `${baseUrl}${prefix}/for/${segment}`,
        changeFrequency: "monthly" as const,
        priority: 0.7,
      })),
    ];
  });
}
