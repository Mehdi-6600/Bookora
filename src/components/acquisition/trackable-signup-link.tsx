"use client";

import { useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { track, readRefFromLocation } from "@/lib/funnel-client";
import {
  BOOKORA_TELEGRAM_URL,
  buildAcquisitionSignupUrl,
  getAcquisitionEventRef,
} from "@/lib/marketing/acquisition-links";
import type { MarketingLocale } from "@/lib/marketing/segments";

type Props = {
  source: string;
  children: ReactNode;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick">;

export function TrackableSignupLink({ source, children, ...props }: Props) {
  const locale = useLocale() as MarketingLocale;
  const [href, setHref] = useState(BOOKORA_TELEGRAM_URL);
  const [campaignRef, setCampaignRef] = useState<string | null>(null);

  useEffect(() => {
    const ref = readRefFromLocation();
    setCampaignRef(ref);
    setHref(buildAcquisitionSignupUrl(ref));

    const eventRef = getAcquisitionEventRef(ref, source);
    track("landing_view", { locale, ref: eventRef });
    if (ref) track("campaign_view", { locale, ref });
  }, [locale, source]);

  return (
    <a
      {...props}
      href={href}
      onClick={() => {
        track("signup_cta_click", {
          locale,
          ref: getAcquisitionEventRef(campaignRef, source),
        });
      }}
    >
      {children}
    </a>
  );
}
