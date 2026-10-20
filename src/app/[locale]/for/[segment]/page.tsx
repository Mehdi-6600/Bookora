import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { routing, type Locale } from "@/i18n/routing";
import { env } from "@/lib/env";
import {
  ACQUISITION_SEGMENTS,
  getAcquisitionPageCopy,
  type AcquisitionSegment,
  type MarketingLocale,
} from "@/lib/marketing/segments";
import { TrackableSignupLink } from "@/components/acquisition/trackable-signup-link";

const APP_URL = env.APP_URL.replace(/\/+$/, "");

function isAcquisitionSegment(value: string): value is AcquisitionSegment {
  return (ACQUISITION_SEGMENTS as readonly string[]).includes(value);
}

function getCanonicalUrl(locale: MarketingLocale, segment: AcquisitionSegment) {
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  return `${APP_URL}${prefix}/for/${segment}`;
}

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    ACQUISITION_SEGMENTS.map((segment) => ({ locale, segment }))
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; segment: string }>;
}): Promise<Metadata> {
  const { locale: localeParam, segment: segmentParam } = await params;
  const locale = routing.locales.includes(localeParam as Locale)
    ? (localeParam as MarketingLocale)
    : routing.defaultLocale;
  if (!isAcquisitionSegment(segmentParam)) return { title: "Bookora" };

  const copy = getAcquisitionPageCopy(locale, segmentParam);
  const canonical = getCanonicalUrl(locale, segmentParam);
  const languages = Object.fromEntries(
    routing.locales.map((language) => [
      language,
      getCanonicalUrl(language as MarketingLocale, segmentParam),
    ])
  );
  languages["x-default"] = getCanonicalUrl(routing.defaultLocale, segmentParam);

  return {
    title: { absolute: copy.pageTitle },
    description: copy.description,
    alternates: { canonical, languages },
    openGraph: {
      type: "website",
      siteName: "Bookora",
      title: copy.pageTitle,
      description: copy.description,
      url: canonical,
      locale: locale === "fa" ? "fa_IR" : locale === "ar" ? "ar" : "en_US",
      images: [{ url: "/bookora-og.png", width: 1200, height: 630, alt: "Bookora online booking" }],
    },
    twitter: {
      card: "summary_large_image",
      title: copy.pageTitle,
      description: copy.description,
      images: ["/bookora-og.png"],
    },
    robots: { index: true, follow: true },
  };
}

export default async function AcquisitionSegmentPage({
  params,
}: {
  params: Promise<{ locale: string; segment: string }>;
}) {
  const { locale: localeParam, segment: segmentParam } = await params;
  if (!isAcquisitionSegment(segmentParam)) notFound();
  const locale = routing.locales.includes(localeParam as Locale)
    ? (localeParam as MarketingLocale)
    : routing.defaultLocale;
  const copy = getAcquisitionPageCopy(locale, segmentParam);
  const canonical = getCanonicalUrl(locale, segmentParam);
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Bookora",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: canonical,
    description: copy.description,
    isAccessibleForFree: true,
    featureList: copy.benefits,
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <header className="mb-6 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 rounded-xl text-sm font-extrabold text-[#1A1F36] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4F5FE8]">
          <Image src="/29A89A41-FBA4-4470-A19D-51E3677E2E0A.png" alt="" width={36} height={36} className="rounded-lg" />
          Bookora
        </Link>
        <LocaleSwitcher />
      </header>

      <div className="rounded-3xl bg-[#B8D4F5] p-6 shadow-soft sm:p-10">
        <p className="text-sm font-bold uppercase tracking-wide text-[#4F5FE8]">
          Bookora · {copy.freePlan}
        </p>
        <h1 className="mt-3 text-3xl font-bold leading-tight text-[#1A1F36] sm:text-4xl">
          {copy.heading}
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-[#1A1F36]/80">
          {copy.intro}
        </p>

        <ul className="mt-6 space-y-3">
          {copy.benefits.map((benefit) => (
            <li key={benefit} className="flex gap-3 rounded-2xl bg-white/80 p-4 text-sm leading-6 text-[#1A1F36]">
              <span aria-hidden="true" className="mt-0.5 font-bold text-[#4F5FE8]">✓</span>
              <span>{benefit}</span>
            </li>
          ))}
        </ul>

        <div className="mt-6 rounded-2xl bg-white p-4 text-sm font-medium leading-6 text-[#1A1F36]/80">
          {copy.customersDoNotNeedTelegram}
        </div>

        {copy.medicalNote ? (
          <p className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            {copy.medicalNote}
          </p>
        ) : null}

        <TrackableSignupLink
          source={segmentParam}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-7 inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#4F5FE8] px-6 py-3 text-center font-bold text-white shadow-soft transition hover:bg-[#3e4ed4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A1F36]"
        >
          {copy.cta}
        </TrackableSignupLink>
        <p className="mt-3 text-xs leading-5 text-[#1A1F36]/70">{copy.setupNote}</p>
      </div>
    </main>
  );
}
