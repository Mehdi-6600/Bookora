import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Script from "next/script";
import { routing, type Locale } from "@/i18n/routing";
import { TelegramThemeSync } from "@/components/telegram/theme-sync";
import "../globals.css";

export const metadata: Metadata = {
  title: "Bookora",
  description: "Let customers book you.",
};

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
