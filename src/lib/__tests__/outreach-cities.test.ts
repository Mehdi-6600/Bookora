import { describe, expect, it } from "vitest";
import {
  AUTO_APPROVED_INTERNATIONAL_CITY_CODES,
  AUTO_APPROVED_IRANIAN_CITY_CODES,
  INITIAL_LAUNCH_CITY_CODES,
  INTERNATIONAL_TELEGRAM_CANDIDATE_CODES,
} from "@/lib/outreach/city-registry";
import {
  BUSINESS_SEGMENTS,
  cityDefinition,
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
  DEFAULT_CAMPAIGN_SEGMENTS,
  KNOWN_CITY_CODES,
  MAX_CAMPAIGN_CITIES,
  MAX_REGISTRY_CITIES,
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

  it("classifies women's hair salons and specialist beauty services separately", () => {
    expect(detectSegment("سالن زیبایی زنانه لیاناز").segment).toBe("WOMENS_SALON");
    expect(detectSegment("سالن زیبایی شیراز").segment).toBe("WOMENS_SALON");
    expect(detectSegment("Beauty salon").segment).toBe("WOMENS_SALON");

    expect(detectSegment("سالن ناخن").segment).toBe("WOMENS_BEAUTY");
    expect(detectSegment("میکاپ آرتیست").segment).toBe("WOMENS_BEAUTY");
    expect(detectSegment("lash artist and brow services").segment).toBe("WOMENS_BEAUTY");
    expect(detectSegment("پاکسازی پوست و فیشیال").segment).toBe("WOMENS_BEAUTY");
  });

  it("classifies doctors and medical practices without guessing on mixed profiles", () => {
    expect(detectSegment("مطب دکتر پوست").segment).toBe("MEDICAL_PRACTICE");
    expect(detectSegment("Family physician and dentist").segment).toBe("MEDICAL_PRACTICE");
    expect(detectSegment("عيادة طبيبة أسنان").segment).toBe("MEDICAL_PRACTICE");
    expect(detectSegment("Beauty salon and dental clinic")).toEqual({
      segment: null,
      reason: "AMBIGUOUS",
    });
  });

  it("flags mixed venues as ambiguous instead of guessing", () => {
    expect(detectSegment("سالن زیبایی و آرایشگاه مردانه")).toEqual({
      segment: null,
      reason: "AMBIGUOUS",
    });
  });

  it("returns NONE when there is no sector signal", () => {
    expect(detectSegment("فروشگاه پوشاک")).toEqual({
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

  it("rejects unsupported global markets explicitly, never silently", () => {
    const parsed = parseCampaignCities(["TEHRAN", "ISTANBUL"]);
    expect(parsed.cities).toEqual(["TEHRAN"]);
    expect(parsed.unapproved).toEqual(["ISTANBUL"]);
    const maliciousOverride = parseCampaignCities(["TEHRAN", "ISTANBUL"], [
      "TEHRAN",
      "ISTANBUL",
    ]);
    expect(maliciousOverride.cities).toEqual(["TEHRAN"]);
    expect(maliciousOverride.unapproved).toEqual(["ISTANBUL"]);
  });

  it("makes every Iranian registry city campaign-ready without an admin override", () => {
    expect(AUTO_APPROVED_IRANIAN_CITY_CODES).toHaveLength(100);
    for (const code of AUTO_APPROVED_IRANIAN_CITY_CODES) {
      expect(parseCampaignCities([code]).cities, code).toEqual([code]);
      expect(resolveCity(code).city, code).toBe(code);
    }
  });

  it("automatically enables only global candidates with a supported outreach language", () => {
    for (const code of INTERNATIONAL_TELEGRAM_CANDIDATE_CODES) {
      const isAutoReady = AUTO_APPROVED_INTERNATIONAL_CITY_CODES.includes(code);
      const defaultResult = parseCampaignCities([code]);
      if (isAutoReady) {
        expect(defaultResult.cities, code).toEqual([code]);
        expect(defaultResult.unapproved, code).toEqual([]);
      } else {
        expect(defaultResult.cities, code).toEqual([]);
        expect(defaultResult.unapproved, code).toEqual([code]);
      }

      const override = parseCampaignCities([code], [code]);
      expect(override.unknown, code).toEqual([]);
      if (isAutoReady) {
        expect(override.cities, code).toEqual([code]);
        expect(override.unapproved, code).toEqual([]);
      } else {
        expect(override.cities, code).toEqual([]);
        expect(override.unapproved, code).toEqual([code]);
      }
    }
  });

  it("supports a registry larger than the per-campaign city cap", () => {
    expect(CITY_REGISTRY.length).toBeLessThanOrEqual(MAX_REGISTRY_CITIES);
    expect(CITY_REGISTRY.length).toBeGreaterThan(MAX_CAMPAIGN_CITIES);

    // A campaign can mix global candidates and Iranian markets, but only after
    // each selected city appears in the reviewed approval list.
    const selected = [
      ...AUTO_APPROVED_INTERNATIONAL_CITY_CODES,
      ...AUTO_APPROVED_IRANIAN_CITY_CODES,
    ].slice(0, MAX_CAMPAIGN_CITIES);
    const full = parseCampaignCities(selected, selected);
    expect(full.tooMany).toBe(false);
    expect(full.cities).toHaveLength(MAX_CAMPAIGN_CITIES);
    expect(full.cities).toEqual(selected);
    expect(full.cities.slice(0, AUTO_APPROVED_INTERNATIONAL_CITY_CODES.length)).toEqual(
      [...AUTO_APPROVED_INTERNATIONAL_CITY_CODES]
    );

    // One distinct eligible city over the campaign cap is rejected outright — not silently truncated.
    const additional = AUTO_APPROVED_IRANIAN_CITY_CODES.find((code) => !selected.includes(code))!;
    const over = parseCampaignCities([...selected, additional], selected);
    expect(over.tooMany).toBe(true);
    expect(over.cities.length).toBeLessThanOrEqual(MAX_CAMPAIGN_CITIES);
  });

  it("resolves any registered city from exact admin input", () => {
    expect(resolveCity("اصفهان")).toEqual({ city: "ISFAHAN", confidence: "HIGH" });
    expect(resolveCity("  isfahan ")).toEqual({ city: "ISFAHAN", confidence: "HIGH" });
    expect(resolveCity("TABRIZ")).toEqual({ city: "TABRIZ", confidence: "HIGH" });
  });

  it("resolves every registered city from its canonical names and aliases", () => {
    for (const entry of CITY_REGISTRY) {
      const code = entry.code;
      expect(resolveCity(entry.en).city, entry.en).toBe(code);
      expect(resolveCity(entry.fa).city, entry.fa).toBe(code);
      for (const alias of entry.aliases) {
        expect(resolveCity(alias).city, `${code} alias ${alias}`).toBe(code);
      }
    }
  });

  it("auto-DETECTION stays limited to the launch cities", () => {
    // Growing the global registry must NOT widen what free-text directory
    // blobs auto-assign — an unapproved mention stays unassigned.
    expect(detectCity("اصفهان، خیابان چهارباغ")).toEqual({ city: null, reason: "NONE" });
    expect(detectCity("Isfahan Naghsh-e Javan")).toEqual({ city: null, reason: "NONE" });
    expect(detectCity("Istanbul hair salon in Türkiye")).toEqual({ city: null, reason: "NONE" });
    const initialLaunchCities = new Set<string>(INITIAL_LAUNCH_CITY_CODES);
    for (const entry of CITY_REGISTRY.filter(
      (city) => city.country === "IR" && !initialLaunchCities.has(city.code)
    )) {
      expect(detectCity(`${entry.en} beauty salon`), entry.code).toEqual({
        city: null,
        reason: "NONE",
      });
    }
    for (const code of INTERNATIONAL_TELEGRAM_CANDIDATE_CODES) {
      const city = cityDefinition(code)!;
      expect(detectCity(`${city.en} beauty salon`), code).toEqual({ city: null, reason: "NONE" });
    }
    expect(detectCity("کرمان، خیابان انقلاب")).toEqual({ city: null, reason: "NONE" });
    expect(KNOWN_CITY_CODES.length).toBeGreaterThan(50);
  });

  it("keeps only registered segments and includes the new target markets", () => {
    expect(DEFAULT_CAMPAIGN_SEGMENTS).toEqual(["MENS_BARBER", "WOMENS_SALON"]);
    expect(BUSINESS_SEGMENTS).toEqual([
      "MENS_BARBER",
      "WOMENS_SALON",
      "WOMENS_BEAUTY",
      "MEDICAL_PRACTICE",
    ]);
    expect(
      parseSegmentList([
        "MENS_BARBER",
        "WOMENS_SALON",
        "WOMENS_BEAUTY",
        "MEDICAL_PRACTICE",
        "DENTIST",
      ])
    ).toEqual(["MENS_BARBER", "WOMENS_SALON", "WOMENS_BEAUTY", "MEDICAL_PRACTICE"]);
    expect(parseSegmentList("WOMENS_SALON")).toEqual(["WOMENS_SALON"]);
  });
});
