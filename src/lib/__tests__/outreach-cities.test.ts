import { describe, expect, it } from "vitest";
import {
  compactPersian,
  detectCity,
  detectSegment,
  normalizePersian,
  parseCityList,
  parseSegmentList,
  resolveCity,
} from "@/lib/outreach/cities";
import {
  APPROVED_CITIES,
  CITY_REGISTRY,
  KNOWN_CITY_CODES,
  MAX_CAMPAIGN_CITIES,
  cityLabel,
  isCityCode,
  parseCampaignCities,
} from "@/lib/outreach/cities";

describe("Persian / Arabic normalisation", () => {
  it("folds Arabic letter forms onto Persian ones", () => {
    expect(normalizePersian("كرج")).toBe("کرج");
    expect(normalizePersian("شيراز")).toBe("شیراز");
    expect(normalizePersian("مدينة")).toBe("مدینه");
  });

  it("folds Persian and Arabic-Indic digits to ASCII", () => {
    expect(normalizePersian("۰۵۱۳۷۶۶۴")).toBe("05137664");
    expect(normalizePersian("٠٥١")).toBe("051");
  });

  it("strips harakat, tatweel and zero-width characters", () => {
    expect(normalizePersian("شیراز\u200c")).toBe("شیراز");
    expect(normalizePersian("تــهــران")).toBe("تهران");
  });

  it("compacts punctuation and spacing", () => {
    expect(compactPersian("  تهران، کرج  ")).toBe("تهرانکرج");
    expect(compactPersian("Tehran - Karaj")).toBe("tehrankaraj");
  });
});

describe("city resolution", () => {
  it("resolves exact Persian and English names", () => {
    expect(resolveCity("تهران")).toEqual({ city: "TEHRAN", confidence: "HIGH" });
    expect(resolveCity("مشهد")).toEqual({ city: "MASHHAD", confidence: "HIGH" });
    expect(resolveCity("شیراز")).toEqual({ city: "SHIRAZ", confidence: "HIGH" });
    expect(resolveCity("کرج")).toEqual({ city: "KARAJ", confidence: "HIGH" });
  });

  it("resolves codes case-insensitively and with surrounding space", () => {
    expect(resolveCity("  karaj ")).toEqual({ city: "KARAJ", confidence: "HIGH" });
    expect(resolveCity("KARAJ")).toEqual({ city: "KARAJ", confidence: "HIGH" });
  });

  it("resolves from a free-text address", () => {
    expect(
      resolveCity("مشهد، بلوار هاشمیه، هاشمیه ۴۱، پلاک ۶۲").city
    ).toBe("MASHHAD");
    expect(
      resolveCity("کرج، مهرشهر، بلوار ارم، نبش کوچه شبنم").city
    ).toBe("KARAJ");
    expect(
      resolveCity("شیراز، معالی آباد، نبش دوستان").city
    ).toBe("SHIRAZ");
  });

  it("never folds Karaj into Tehran, and flags both together as ambiguous", () => {
    expect(resolveCity("کرج").city).toBe("KARAJ");
    expect(resolveCity("تهران").city).toBe("TEHRAN");
    // A listing that mentions both cannot be auto-assigned.
    expect(resolveCity("تهران - کرج")).toEqual({
      city: null,
      reason: "AMBIGUOUS",
    });
    expect(resolveCity("سالن زیبایی کرج و تهران")).toEqual({
      city: null,
      reason: "AMBIGUOUS",
    });
  });

  it("returns NONE when no approved city appears", () => {
    expect(detectCity("اصفهان، خیابان چهارباغ")).toEqual({
      city: null,
      reason: "NONE",
    });
    expect(detectCity("")).toEqual({ city: null, reason: "NONE" });
    expect(detectCity(undefined)).toEqual({ city: null, reason: "NONE" });
  });

  it("does not match a Latin alias inside an unrelated word", () => {
    // "kraj" must not be found inside a longer token.
    expect(detectCity("karajville")).toEqual({ city: null, reason: "NONE" });
    expect(detectCity("best karaj salon").city).toBe("KARAJ");
  });
});

describe("segment detection", () => {
  it("classifies men's barbershop signals", () => {
    expect(detectSegment("آرایشگاه مردانه یونیک").segment).toBe("MENS_BARBER");
    expect(detectSegment("پیرایشگاه مردانه رخ").segment).toBe("MENS_BARBER");
    expect(detectSegment("باربر شاپ کات").segment).toBe("MENS_BARBER");
    expect(detectSegment("Barber Shop Cut").segment).toBe("MENS_BARBER");
  });

  it("classifies women's hair and beauty salon signals", () => {
    expect(detectSegment("سالن زیبایی زنانه لیاناز").segment).toBe(
      "WOMENS_SALON"
    );
    expect(detectSegment("سالن زیبایی شیراز").segment).toBe("WOMENS_SALON");
    expect(detectSegment("سالن ناخن").segment).toBe("WOMENS_SALON");
    expect(detectSegment("میکاپ و شینیون عروس").segment).toBe("WOMENS_SALON");
    expect(detectSegment("Beauty salon").segment).toBe("WOMENS_SALON");
  });

  it("flags mixed venues as ambiguous instead of guessing", () => {
    expect(detectSegment("سالن زیبایی و آرایشگاه مردانه")).toEqual({
      segment: null,
      reason: "AMBIGUOUS",
    });
  });

  it("returns NONE when there is no signal", () => {
    expect(detectSegment("کلینیک دندانپزشکی")).toEqual({
      segment: null,
      reason: "NONE",
    });
  });
});

describe("list parsing", () => {
  it("keeps registry-known cities and de-duplicates (approval is separate)", () => {
    // ISFAHAN is now a REGISTERED market, so the tolerant parser resolves it.
    // Whether a campaign MAY target it is the approval question — see the
    // strict `parseCampaignCities` suite below.
    expect(parseCityList(["TEHRAN", "karaj", "isfahan", "KARAJ"])).toEqual([
      "TEHRAN",
      "KARAJ",
      "ISFAHAN",
    ]);
    expect(parseCityList("کرج")).toEqual(["KARAJ"]);
    expect(parseCityList(null)).toEqual([]);
  });

  it("keeps the legacy four cities exactly as the default approval", () => {
    expect([...APPROVED_CITIES].sort()).toEqual(
      ["KARAJ", "MASHHAD", "SHIRAZ", "TEHRAN"]
    );
    // Old campaigns and prospect rows keep working: the codes are unchanged.
    expect(isCityCode("TEHRAN")).toBe(true);
    expect(isCityCode("KARAJ")).toBe(true);
    expect(cityLabel("TEHRAN", "fa")).toBe("تهران");
    expect(cityLabel("SHIRAZ", "en")).toBe("Shiraz");
  });

  it("never substitutes another city for an unknown code", () => {
    // Unknown codes render verbatim (the display layer cannot swap cities).
    expect(cityLabel("NOWHEREVILLE", "en")).toBe("NOWHEREVILLE");
    // …and strict parsing reports them instead of silently dropping.
    const parsed = parseCampaignCities(["TEHRAN", "NOWHEREVILLE"]);
    expect(parsed.unknown).toEqual(["NOWHEREVILLE"]);
    expect(parsed.cities).toEqual(["TEHRAN"]);
  });

  it("rejects unapproved registry cities explicitly, never silently", () => {
    const parsed = parseCampaignCities(["TEHRAN", "ISFAHAN"]);
    expect(parsed.cities).toEqual(["TEHRAN"]);
    expect(parsed.unapproved).toEqual(["ISFAHAN"]);
    const withApprovals = parseCampaignCities(["TEHRAN", "ISFAHAN"], [
      "TEHRAN",
      "ISFAHAN",
    ]);
    expect(withApprovals.cities).toEqual(["TEHRAN", "ISFAHAN"]);
    expect(withApprovals.unapproved).toEqual([]);
  });

  it("caps a campaign at MAX_CAMPAIGN_CITIES (100) approved cities", () => {
    const all = CITY_REGISTRY.map((entry) => entry.code);
    expect(CITY_REGISTRY.length).toBeLessThanOrEqual(MAX_CAMPAIGN_CITIES);

    // With every registered city approved, a full-list campaign is accepted.
    const full = parseCampaignCities(all, all);
    expect(full.tooMany).toBe(false);
    expect(full.cities).toHaveLength(MAX_CAMPAIGN_CITIES);

    // One code over the cap is rejected outright — not truncated silently.
    const over = parseCampaignCities([...all, "TEHRAN", "MASHHAD", "BAD-CODE"], all);
    expect(over.tooMany).toBe(true);
    expect(over.cities.length).toBeLessThanOrEqual(MAX_CAMPAIGN_CITIES);
  });

  it("resolves any registered city from exact admin input", () => {
    expect(resolveCity("اصفهان")).toEqual({ city: "ISFAHAN", confidence: "HIGH" });
    expect(resolveCity("  isfahan ")).toEqual({ city: "ISFAHAN", confidence: "HIGH" });
    expect(resolveCity("TABRIZ")).toEqual({ city: "TABRIZ", confidence: "HIGH" });
  });

  it("auto-DETECTION stays limited to the launch cities", () => {
    // Growing the registry to 100 cities must NOT widen what free-text
    // directory blobs auto-assign — an unapproved mention stays unassigned.
    expect(detectCity("اصفهان، خیابان چهارباغ")).toEqual({ city: null, reason: "NONE" });
    expect(detectCity("Isfahan Naghsh-e Javan")).toEqual({ city: null, reason: "NONE" });
    expect(detectCity("کرمان، خیابان انقلاب")).toEqual({ city: null, reason: "NONE" });
    expect(KNOWN_CITY_CODES.length).toBeGreaterThan(50);
  });

  it("keeps only known segments", () => {
    expect(
      parseSegmentList(["MENS_BARBER", "WOMENS_SALON", "DENTIST"])
    ).toEqual(["MENS_BARBER", "WOMENS_SALON"]);
    expect(parseSegmentList("WOMENS_SALON")).toEqual(["WOMENS_SALON"]);
  });
});
