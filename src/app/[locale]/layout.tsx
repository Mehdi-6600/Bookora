import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Script from "next/script";
import { routing, type Locale } from "@/i18n/routing";
import { TelegramThemeSync } from "@/components/telegram/theme-sync";
import { env } from "@/lib/env";
import "../globals.css";

const APP_URL = env.APP_URL.replace(/\/+$/, "");

/**
 * Per-locale metadata.
 *
 * Without this every shared link rendered the same generic title and
 * description, so a barbershop sharing its booking page gave customers no
 * reason to tap it.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const resolved = routing.locales.includes(locale as Locale)
    ? (locale as Locale)
    : routing.defaultLocale;

  const t = await getTranslations({ locale: resolved, namespace: "homeNew" });

  const description = t("valueProp");

  return {
    metadataBase: new URL(APP_URL),
    title: {
      default: "Bookora",
      template: "%s | Bookora",
    },
    description,
    applicationName: "Bookora",
    alternates: {
      canonical: resolved === routing.defaultLocale ? "/" : `/${resolved}`,
      languages: {
        en: "/",
        fa: "/fa",
        ar: "/ar",
        "x-default": "/",
      },
    },
    openGraph: {
      type: "website",
      siteName: "Bookora",
      title: "Bookora",
      description,
      url: APP_URL,
      images: [
        {
          url: "/bookora-og.png",
          width: 1200,
          height: 630,
          alt: "Bookora — online booking for your business",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Bookora",
      description,
      images: ["/bookora-og.png"],
    },
    robots: { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0B1437",
  viewportFit: "cover",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as Locale)) {
    notFound();
  }

  setRequestLocale(locale);

  const messages = await getMessages();
  const dir = locale === "fa" || locale === "ar" ? "rtl" : "ltr";

  return (
    <html
      lang={locale}
      dir={dir}
      className="dark"
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Script
          id="telegram-web-app"
          src="https://telegram.org/js/telegram-web-app.js?63"
          strategy="beforeInteractive"
        />

        <NextIntlClientProvider messages={messages}>
          <TelegramThemeSync />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
