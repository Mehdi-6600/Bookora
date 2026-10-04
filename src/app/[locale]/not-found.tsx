"use client";

import { useTranslations } from "next-intl";
import { ArrowRight, Home, Search } from "lucide-react";
import { Link } from "@/i18n/navigation";

const CARD_MAIN = "rounded-3xl bg-[#B8D4F5] p-6 shadow-soft";

const BTN_PRIMARY =
  "btn-elevated flex w-full items-center justify-center gap-2 rounded-2xl bg-[#4F5FE8] px-5 py-4 text-base font-bold text-white transition-transform active:scale-[0.98]";

export default function NotFoundPage() {
  const t = useTranslations("notFound");

  const txtTitle = t("title");
  const txtSubtitle = t("subtitle");
  const txtBackHome = t("backHome");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center px-4 py-6">
      <section className={CARD_MAIN + " w-full"}>
        <div className="flex flex-col items-center text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-soft">
            <Search className="h-10 w-10 text-[#4F5FE8]" />
          </span>

          <p className="mt-5 text-5xl font-bold tracking-tight text-[#4F5FE8]">
            404
          </p>

          <h1 className="mt-3 text-xl font-bold text-[#1A1F36]">
            {txtTitle}
          </h1>

          <p className="mt-2 max-w-xs text-sm font-medium leading-7 text-[#1A1F36]/70">
            {txtSubtitle}
          </p>

          <Link href="/" className={BTN_PRIMARY + " mt-6"}>
            <Home className="h-5 w-5" />
            {txtBackHome}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </main>
  );
}
