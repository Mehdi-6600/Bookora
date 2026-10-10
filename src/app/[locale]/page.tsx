"use client";

import { useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import {
  ArrowRight,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  Clock,
  CreditCard,
  Link2,
  Send,
  ShieldCheck,
  Store,
  Users,
  Zap,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { track } from "@/lib/funnel-client";

const CARD_MAIN = "rounded-3xl bg-[#B8D4F5] p-6 shadow-soft";
const CARD_INNER = "rounded-2xl bg-white p-4 shadow-soft";

const BTN_TELEGRAM =
  "btn-elevated flex w-full items-center justify-center gap-2 rounded-2xl bg-[#4F5FE8] px-5 py-4 text-base font-bold text-white transition-transform active:scale-[0.98]";

const BTN_PANEL =
  "flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-4 text-base font-bold text-[#1A1F36] shadow-soft transition-transform active:scale-[0.98]";

const FEATURE_TILE = "flex items-start gap-3 rounded-2xl bg-white p-4 shadow-soft";
const FEATURE_ICON =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#4F5FE8]/10";
const FEATURE_TITLE = "text-sm font-bold text-[#1A1F36]";
const FEATURE_DESC = "mt-0.5 text-xs font-medium text-[#1A1F36]/60";

const LOGO_SRC = "/29A89A41-FBA4-4470-A19D-51E3677E2E0A.png";

const TELEGRAM_URL = "https://t.me/Bookora_App_bot";

export default function LandingPage() {
  const t = useTranslations("home");
  const tNew = useTranslations("homeNew");
  const locale = useLocale();

  useEffect(() => {
    track("landing_view", { locale });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const steps = [
    { icon: Store, title: tNew("step1Title"), desc: tNew("step1Desc") },
    { icon: ClipboardList, title: tNew("step2Title"), desc: tNew("step2Desc") },
    { icon: Clock, title: tNew("step3Title"), desc: tNew("step3Desc") },
    { icon: Link2, title: tNew("step4Title"), desc: tNew("step4Desc") },
  ];

  const faqs = [
    { q: tNew("faq1Q"), a: tNew("faq1A") },
    { q: tNew("faq2Q"), a: tNew("faq2A") },
    { q: tNew("faq3Q"), a: tNew("faq3A") },
    { q: tNew("faq4Q"), a: tNew("faq4A") },
  ];

  return (
    <main className="mx-auto w-full max-w-md space-y-5 px-4 py-6">
      <div className="flex justify-end">
        <LocaleSwitcher />
      </div>

      {/* ---------- Hero: what it is, who it is for, how to start ---------- */}
      <section className={CARD_MAIN}>
        <div className="flex flex-col items-center text-center">
          <span className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-3xl bg-white shadow-soft">
            <Image
              src={LOGO_SRC}
              alt={t("title")}
              width={96}
              height={96}
              priority
              className="h-full w-full object-contain"
            />
          </span>

          <h1 className="mt-4 text-3xl font-bold tracking-tight text-[#1A1F36]">
            {t("title")}
          </h1>

          <p className="mt-2 text-sm font-bold text-[#1A1F36]">
            {tNew("valueProp")}
          </p>

          <p className="mt-2 text-xs font-medium text-[#1A1F36]/60">
            {tNew("whoFor")}
          </p>

          <a
            href={TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track("signup_cta_click", { locale })}
            className={BTN_TELEGRAM + " mt-5"}
          >
            <Send className="h-5 w-5" />
            {tNew("startFree")}
            <ArrowRight className="h-4 w-4" />
          </a>

          <Link href="/app" className={BTN_PANEL + " mt-3"}>
            {t("openPanel")}
          </Link>
        </div>
      </section>

      {/* ---------- How customers book ---------- */}
      <section className={CARD_MAIN}>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-soft">
            <Users className="h-5 w-5 text-[#4F5FE8]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-[#1A1F36]">
              {tNew("howCustomersBookTitle")}
            </h2>
            <p className="mt-1.5 text-sm font-medium leading-6 text-[#1A1F36]/80">
              {tNew("howCustomersBook")}
            </p>
          </div>
        </div>
      </section>

      {/* ---------- How owners manage availability ---------- */}
      <section className={CARD_MAIN}>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-soft">
            <CalendarCheck className="h-5 w-5 text-[#4F5FE8]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-[#1A1F36]">
              {tNew("howOwnersManageTitle")}
            </h2>
            <p className="mt-1.5 text-sm font-medium leading-6 text-[#1A1F36]/80">
              {tNew("howOwnersManage")}
            </p>
          </div>
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section className="space-y-3">
        <h2 className="px-1 text-base font-bold text-[#1A1F36]">
          {tNew("stepsTitle")}
        </h2>

        <div className={CARD_MAIN}>
          <ol className="space-y-3">
            {steps.map((step, index) => (
              <li key={step.title} className={CARD_INNER}>
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#4F5FE8]/10">
                    <step.icon className="h-5 w-5 text-[#4F5FE8]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-[#1A1F36]">
                      <span className="text-[#4F5FE8]">{index + 1}. </span>
                      {step.title}
                    </p>
                    <p className="mt-0.5 text-xs font-medium leading-5 text-[#1A1F36]/60">
                      {step.desc}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------- Free plan (verified against the implementation) ---------- */}
      <section className={CARD_MAIN}>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-soft">
            <CreditCard className="h-5 w-5 text-[#4F5FE8]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-[#1A1F36]">
              {tNew("freePlan")}
            </h2>

            <ul className="mt-3 space-y-2 text-sm font-medium text-[#1A1F36]/80">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#34C759]" />
                1 business
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#34C759]" />
                Unlimited services and prices
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#34C759]" />
                Unlimited bookings — no per-appointment fee
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#34C759]" />
                Working hours, breaks and days off
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#34C759]" />
                Optional deposits, paid directly to you
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#34C759]" />
                Instant Telegram notification for new bookings
              </li>
            </ul>

            <p className="mt-3 text-xs font-medium leading-6 text-[#1A1F36]/60">
              {tNew("freePlanBody")}
            </p>

            <a
              href={TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track("signup_cta_click", { locale })}
              className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-[#4F5FE8]"
            >
              {t("getStarted")}
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>

      {/* ---------- Trust tiles ---------- */}
      <section className="space-y-3">
        <div className={FEATURE_TILE}>
          <span className={FEATURE_ICON}>
            <CalendarCheck className="h-5 w-5 text-[#4F5FE8]" />
          </span>
          <div className="min-w-0">
            <h2 className={FEATURE_TITLE}>{t("feature1Title")}</h2>
            <p className={FEATURE_DESC}>{t("feature1Desc")}</p>
          </div>
        </div>

        <div className={FEATURE_TILE}>
          <span className={FEATURE_ICON}>
            <Zap className="h-5 w-5 text-[#4F5FE8]" />
          </span>
          <div className="min-w-0">
            <h2 className={FEATURE_TITLE}>{t("feature2Title")}</h2>
            <p className={FEATURE_DESC}>{t("feature2Desc")}</p>
          </div>
        </div>

        <div className={FEATURE_TILE}>
          <span className={FEATURE_ICON}>
            <ShieldCheck className="h-5 w-5 text-[#4F5FE8]" />
          </span>
          <div className="min-w-0">
            <h2 className={FEATURE_TITLE}>{t("feature3Title")}</h2>
            <p className={FEATURE_DESC}>{t("feature3Desc")}</p>
          </div>
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section className={CARD_MAIN}>
        <h2 className="text-base font-bold text-[#1A1F36]">{tNew("faqTitle")}</h2>
        <div className="mt-3 space-y-3">
          {faqs.map((faq) => (
            <div key={faq.q} className={CARD_INNER}>
              <p className="text-sm font-bold text-[#1A1F36]">{faq.q}</p>
              <p className="mt-1 text-xs font-medium leading-6 text-[#1A1F36]/70">
                {faq.a}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Final CTA ---------- */}
      <section className={CARD_MAIN}>
        <div className="flex flex-col items-center text-center">
          <p className="text-sm font-bold text-[#1A1F36]">
            {tNew("howToStart")}
          </p>

          <a
            href={TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track("signup_cta_click", { locale })}
            className={BTN_TELEGRAM + " mt-4"}
          >
            <Send className="h-5 w-5" />
            {tNew("startFree")}
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>
    </main>
  );
}
