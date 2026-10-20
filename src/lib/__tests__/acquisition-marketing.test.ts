import { describe, expect, it } from "vitest";
import {
  buildAcquisitionSignupUrl,
  BOOKORA_TELEGRAM_URL,
  getAcquisitionEventRef,
} from "@/lib/marketing/acquisition-links";
import {
  ACQUISITION_SEGMENTS,
  getAcquisitionPageCopy,
} from "@/lib/marketing/segments";
import { aggregateOrganicSourceSignals } from "@/lib/outreach/analytics";

describe("acquisition landing page copy", () => {
  it("has localized, target-specific copy for every intended business segment", () => {
    for (const locale of ["en", "fa", "ar"] as const) {
      for (const segment of ACQUISITION_SEGMENTS) {
        const copy = getAcquisitionPageCopy(locale, segment);
        expect(copy.pageTitle.length).toBeGreaterThan(20);
        expect(copy.heading).toContain(copy.audience);
        expect(copy.benefits).toHaveLength(3);
        expect(copy.customersDoNotNeedTelegram.length).toBeGreaterThan(20);
      }
    }
  });

  it("only adds the clinic data-minimization notice to the clinic page", () => {
    expect(getAcquisitionPageCopy("en", "clinics").medicalNote).toContain("Do not enter");
    expect(getAcquisitionPageCopy("fa", "barbers").medicalNote).toBeNull();
  });
});

describe("owner-initiated signup attribution", () => {
  it("opens the bot without a campaign ref and preserves explicit campaign attribution", () => {
    expect(buildAcquisitionSignupUrl()).toBe(BOOKORA_TELEGRAM_URL);
    expect(buildAcquisitionSignupUrl("listing_iranikoo")).toBe(
      `${BOOKORA_TELEGRAM_URL}?start=c-listing_iranikoo`
    );
    expect(getAcquisitionEventRef(null, "barbers")).toBe("seo_barbers");
    expect(getAcquisitionEventRef("launch_01", "barbers")).toBe("launch_01");
  });
});

describe("organic SEO source aggregation", () => {
  it("counts only first-party SEO page views and signup clicks", () => {
    expect(
      aggregateOrganicSourceSignals([
        { ref: "seo_barbers", event: "landing_view", count: 8 },
        { ref: "seo_barbers", event: "signup_cta_click", count: 2 },
        { ref: "seo_clinics", event: "landing_view", count: 4 },
        { ref: "seo_clinics", event: "campaign_view", count: 99 },
        { ref: "campaign_01", event: "landing_view", count: 10 },
        { ref: "seo_bad ref", event: "landing_view", count: 10 },
      ])
    ).toEqual([
      { source: "barbers", pageViews: 8, signupClicks: 2 },
      { source: "clinics", pageViews: 4, signupClicks: 0 },
    ]);
  });
});
