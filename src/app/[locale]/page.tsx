"use client";

import { useTranslations } from "next-intl";
import Image from "next/image";
import {
  ArrowRight,
  CalendarCheck,
  CheckCircle2,
  CreditCard,
  Send,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "@/components/locale-switcher";

const CARD_MAIN = "rounded-3xl bg-[#B8D4F5] p-6 shadow-soft";

const BTN_TELEGRAM =
  "btn-elevated flex w-full items-center justify-center gap-2 rounded-2xl bg-[#4F5FE8] px-5 py-4 text-base font-bold text-white transition-transform active:scale-[0.98]";

const BTN_PANEL =
  "flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-4 text-base font-bold text-[#1A1F36] shadow-soft transition-transform active:scale-[0.98]";

const FEATURE_TILE =
  "flex items-start gap-3 rounded-2xl bg-white p-4 shadow-soft";

const FEATURE_ICON =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#4F5FE8]/10";

const FEATURE_TITLE = "text-sm font-bold text-[#1A1F36]";

const FEATURE_DESC = "mt-0.5 text-xs font-medium text-[#1A1F36]/60";

const LOGO_SRC =
  "/29A89A41-FBA4-4470-A19D-51E3677E2E0A.png";

export default function LandingPage() {
  const t = useTranslations("home");

  const txtTitle = t("title");
  const txtSubtitle = t("subtitle");
  const txtGetStarted = t("getStarted");
  const txtFeature1Title = t("feature1Title");
  const txtFeature1Desc = t("feature1Desc");
  const txtFeature2Title = t("feature2Title");
  const txtFeature2Desc = t("feature2Desc");
  const txtFeature3Title = t("feature3Title");
  const txtFeature3Desc = t("feature3Desc");
  const txtOpenTelegram = t("openInTelegram");
  const txtOpenPanel = t("openPanel");
  const txtForBusiness = t("forBusiness");

  const telegramUrl = "https://t.me/Bookora_App_bot";

  return (
    <main className="mx-auto w-full max-w-md space-y-5 px-4 py-6">
      <div className="flex justify-end">
        <LocaleSwitcher />
      </div>

      <section className={CARD_MAIN}>
        <div className="flex flex-col items-center text-center">
          <span className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-3xl bg-white shadow-soft">
            <Image
              src={LOGO_SRC}
              alt={txtTitle}
              width={112}
              height={112}
              priority
              className="h-full w-full object-contain"
            />
          </span>

          <h1 className="mt-5 text-3xl font-bold tracking-tight text-[#1A1F36]">
            {txtTitle}
          </h1>

          <p className="mt-2 max-w-xs text-sm font-medium leading-7 text-[#1A1F36]/70">
            {txtSubtitle}
          </p>

          <a
            href={telegramUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={BTN_TELEGRAM + " mt-6"}
          >
            <Send className="h-5 w-5" />
            {txtOpenTelegram}
            <ArrowRight className="h-4 w-4" />
          </a>

          <Link href="/app" className={BTN_PANEL + " mt-3"}>
            {txtOpenPanel}
          </Link>
        </div>
      </section>

      <section className="space-y-3">
        <div className={FEATURE_TILE}>
          <span className={FEATURE_ICON}>
            <CalendarCheck className="h-5 w-5 text-[#4F5FE8]" />
          </span>
          <div className="min-w-0">
            <h2 className={FEATURE_TITLE}>{txtFeature1Title}</h2>
            <p className={FEATURE_DESC}>{txtFeature1Desc}</p>
          </div>
        </div>

        <div className={FEATURE_TILE}>
          <span className={FEATURE_ICON}>
            <Zap className="h-5 w-5 text-[#4F5FE8]" />
          </span>
          <div className="min-w-0">
            <h2 className={FEATURE_TITLE}>{txtFeature2Title}</h2>
            <p className={FEATURE_DESC}>{txtFeature2Desc}</p>
          </div>
        </div>

        <div className={FEATURE_TILE}>
          <span className={FEATURE_ICON}>
            <ShieldCheck className="h-5 w-5 text-[#4F5FE8]" />
          </span>
          <div className="min-w-0">
            <h2 className={FEATURE_TITLE}>{txtFeature3Title}</h2>
            <p className={FEATURE_DESC}>{txtFeature3Desc}</p>
          </div>
        </div>
      </section>

      <section className={CARD_MAIN}>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-soft">
            <CreditCard className="h-5 w-5 text-[#4F5FE8]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-[#1A1F36]">
              {txtForBusiness}
            </h2>
            <ul className="mt-3 space-y-2 text-sm font-medium text-[#1A1F36]/80">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#34C759]" />
                {txtFeature1Title}
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#34C759]" />
                {txtFeature2Title}
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#34C759]" />
                {txtFeature3Title}
              </li>
            </ul>
            <Link
              href="/app"
              className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-[#4F5FE8]"
            >
              {txtGetStarted}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
