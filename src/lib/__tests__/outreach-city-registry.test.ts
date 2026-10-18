import { describe, expect, it } from "vitest";
import { OUTREACH_LANGUAGES } from "@/lib/outreach/types";
import {
  AUTO_APPROVED_CITY_CODES,
  AUTO_APPROVED_INTERNATIONAL_CITY_CODES,
  AUTO_APPROVED_IRANIAN_CITY_CODES,
  CITY_REGISTRY,
  DEFAULT_APPROVED_CITIES,
  INITIAL_LAUNCH_CITY_CODES,
  DUPLICATE_CODES,
  INTERNATIONAL_TELEGRAM_CANDIDATE_CODES,
  MAX_CAMPAIGN_CITIES,
  MAX_REGISTRY_CITIES,
  cityDefinition,
  outreachLanguagesForCity,
  isRegistryCityCode,
  mergeApprovedCities,
  normalizeCityCodeList,
} from "@/lib/outreach/city-registry";

/**
 * Iranian and global market registry. These suites ensure market readiness is
 * automatic where supported, stored codes remain stable, unsupported locales
 * stay blocked, and campaign/send limits cannot be bypassed.
 */

describe("registry integrity", () => {
  it("holds the Iranian base plus the global shortlist with unique, stable codes", () => {
    expect(CITY_REGISTRY.length).toBeGreaterThan(100);
    expect(CITY_REGISTRY.length).toBeLessThanOrEqual(MAX_REGISTRY_CITIES);
    expect(CITY_REGISTRY.length).toBe(130);
    const iranian = CITY_REGISTRY.filter((entry) => entry.country === "IR");
    const international = CITY_REGISTRY.filter((entry) => entry.country !== "IR");
    expect(iranian).toHaveLength(100);
    expect(new Set(international.map((entry) => entry.code))).toEqual(
      new Set(INTERNATIONAL_TELEGRAM_CANDIDATE_CODES)
    );
    expect(DUPLICATE_CODES).toEqual([]);
    expect(new Set(CITY_REGISTRY.map((entry) => entry.code)).size).toBe(
      CITY_REGISTRY.length
    );
  });

  it("uses only upper-ASCII codes (safe as DB values and API input)", () => {
    for (const entry of CITY_REGISTRY) {
      expect(entry.code).toMatch(/^[A-Z0-9_]{3,40}$/);
    }
  });

  it("provides Persian and English labels, an ISO country code and a region", () => {
    for (const entry of CITY_REGISTRY) {
      expect(entry.fa.length).toBeGreaterThan(0);
      expect(entry.en.length).toBeGreaterThan(0);
      expect(entry.country).toMatch(/^[A-Z]{2}$/);
      expect(entry.region.length).toBeGreaterThan(0);
    }
  });

  it("registers the selected international Telegram-candidate cities and local language metadata", () => {
    expect(INTERNATIONAL_TELEGRAM_CANDIDATE_CODES).toHaveLength(30);
    for (const code of INTERNATIONAL_TELEGRAM_CANDIDATE_CODES) {
      const city = cityDefinition(code);
      expect(city, code).toBeDefined();
      expect(city!.country).not.toBe("IR");
      expect(city!.approved).toBe(false);
      expect(city!.outreachLanguages?.length, code).toBeGreaterThan(0);
      expect(city!.outreachLanguages?.every((language) => /^[a-z]{2}$/.test(language))).toBe(true);
    }
  });

  it("keeps every international candidate attached to its intended country", () => {
    const expectedCountryByCode: Record<string, string> = {
      ISTANBUL: "TR",
      ANKARA: "TR",
      IZMIR: "TR",
      BURSA: "TR",
      MOSCOW: "RU",
      SAINT_PETERSBURG: "RU",
      KAZAN: "RU",
      NOVOSIBIRSK: "RU",
      TASHKENT: "UZ",
      SAMARKAND: "UZ",
      KYIV: "UA",
      KHARKIV: "UA",
      ODESA: "UA",
      CAIRO: "EG",
      ALEXANDRIA: "EG",
      SAO_PAULO: "BR",
      RIO_DE_JANEIRO: "BR",
      JAKARTA: "ID",
      KARACHI: "PK",
      LAHORE: "PK",
      ALMATY: "KZ",
      ASTANA: "KZ",
      BAKU: "AZ",
      TBILISI: "GE",
      YEREVAN: "AM",
      DUBAI: "AE",
      MUMBAI: "IN",
      DELHI: "IN",
      MINSK: "BY",
      BUENOS_AIRES: "AR",
    };

    expect(Object.keys(expectedCountryByCode).sort()).toEqual(
      [...INTERNATIONAL_TELEGRAM_CANDIDATE_CODES].sort()
    );
    for (const [code, country] of Object.entries(expectedCountryByCode)) {
      expect(cityDefinition(code)?.country, code).toBe(country);
    }
  });

  it("preserves the four initial launch cities as the static baseline", () => {
    expect(INITIAL_LAUNCH_CITY_CODES).toEqual(["TEHRAN", "MASHHAD", "KARAJ", "SHIRAZ"]);
    for (const code of INITIAL_LAUNCH_CITY_CODES) {
      const entry = cityDefinition(code);
      expect(entry, code).toBeDefined();
      expect(entry!.approved, code).toBe(true);
    }
  });

  it("auto-enables every Iranian city and only language-ready global candidates", () => {
    expect(AUTO_APPROVED_IRANIAN_CITY_CODES).toHaveLength(100);
    expect(AUTO_APPROVED_IRANIAN_CITY_CODES).toEqual(
      CITY_REGISTRY.filter((entry) => entry.country === "IR").map((entry) => entry.code)
    );
    expect(AUTO_APPROVED_INTERNATIONAL_CITY_CODES).toEqual([
      "CAIRO",
      "ALEXANDRIA",
      "KARACHI",
      "LAHORE",
      "DUBAI",
      "MUMBAI",
      "DELHI",
    ]);
    expect(AUTO_APPROVED_CITY_CODES).toHaveLength(107);
    expect(new Set(DEFAULT_APPROVED_CITIES)).toEqual(new Set(AUTO_APPROVED_CITY_CODES));
    expect(DEFAULT_APPROVED_CITIES.every((code) => isRegistryCityCode(code))).toBe(true);
    const internationalCandidates = new Set<string>(INTERNATIONAL_TELEGRAM_CANDIDATE_CODES);

    for (const entry of CITY_REGISTRY) {
      const languages = outreachLanguagesForCity(entry);
      expect(languages.length, entry.code).toBeGreaterThan(0);
      const hasSupportedLanguage = languages.some((language) =>
        (OUTREACH_LANGUAGES as readonly string[]).includes(language)
      );
      if (entry.country === "IR") expect(hasSupportedLanguage, entry.code).toBe(true);
      if (internationalCandidates.has(entry.code)) {
        expect(AUTO_APPROVED_INTERNATIONAL_CITY_CODES.includes(entry.code), entry.code).toBe(
          hasSupportedLanguage
        );
      }
    }
  });

  it("keeps all other candidates dormant instead of requiring a manual approval", () => {
    const staticallyApproved = CITY_REGISTRY.filter((entry) => entry.approved);
    expect(staticallyApproved.map((entry) => entry.code)).toEqual([...INITIAL_LAUNCH_CITY_CODES]);
    for (const code of INTERNATIONAL_TELEGRAM_CANDIDATE_CODES) {
      const city = cityDefinition(code)!;
      const ready = AUTO_APPROVED_INTERNATIONAL_CITY_CODES.includes(code);
      expect(DEFAULT_APPROVED_CITIES.includes(code), code).toBe(ready);
      expect(city.approved, code).toBe(false);
    }
  });

  it("aliases never collide with another city's canonical name", () => {
    // Two codes sharing a compacted alias would make exact resolution
    // ambiguous; the registry must stay a function, not a coin flip.
    const byAlias = new Map<string, string>();
    for (const entry of CITY_REGISTRY) {
      const names = [entry.fa, entry.en, ...entry.aliases].map((value) =>
        value.toLocaleLowerCase("en").replace(/[\s‌‍]/g, "")
      );
      for (const name of new Set(names)) {
        const previous = byAlias.get(name);
        if (previous && previous !== entry.code) {
          throw new Error(`alias "${name}" collides: ${previous} vs ${entry.code}`);
        }
        byAlias.set(name, entry.code);
      }
    }
    expect(byAlias.size).toBeGreaterThan(CITY_REGISTRY.length);
  });
});

describe("approval merging", () => {
  it("defaults to all Iran and supported-language global markets", () => {
    expect(mergeApprovedCities()).toEqual(DEFAULT_APPROVED_CITIES);
  });

  it("admin enablement adds known codes only, in registry order", () => {
    const merged = mergeApprovedCities(["ISFAHAN", "TABRIZ", "NOT-A-CITY"]);
    expect(new Set(merged)).toEqual(
      new Set([...DEFAULT_APPROVED_CITIES, "ISFAHAN", "TABRIZ"])
    );
    // Order follows the registry, not the (untrusted) order the admin sent.
    const registryOrder = CITY_REGISTRY.map((entry) => entry.code);
    const positions = merged.map((code) => registryOrder.indexOf(code));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("disable wins over enable, even for the launch cities", () => {
    const merged = mergeApprovedCities(["KARAJ"], ["KARAJ", "TEHRAN"]);
    expect(merged).not.toContain("KARAJ");
    expect(merged).not.toContain("TEHRAN");
    expect(merged).toContain("MASHHAD");
    expect(merged).toContain("SHIRAZ");
  });

  it("does not let saved overrides bypass the global language-readiness gate", () => {
    const unsupported = INTERNATIONAL_TELEGRAM_CANDIDATE_CODES.filter(
      (code) => !AUTO_APPROVED_INTERNATIONAL_CITY_CODES.includes(code)
    );
    const merged = mergeApprovedCities(unsupported);
    expect(merged).toEqual(DEFAULT_APPROVED_CITIES);
    const unsupportedSet = new Set<string>(unsupported);
    expect(merged.some((code) => unsupportedSet.has(code))).toBe(false);
  });

  it("keeps registry eligibility separate from the per-campaign cap", () => {
    const all = CITY_REGISTRY.map((entry) => entry.code);
    const approved = mergeApprovedCities(all, []);
    expect(approved).toHaveLength(
      CITY_REGISTRY.length -
        INTERNATIONAL_TELEGRAM_CANDIDATE_CODES.filter(
          (code) => !AUTO_APPROVED_INTERNATIONAL_CITY_CODES.includes(code)
        ).length
    );
    expect(approved.length).toBeGreaterThan(MAX_CAMPAIGN_CITIES);
  });
});

describe("city code list coercion (settings storage)", () => {
  it("upper-cases, trims and de-duplicates", () => {
    expect(normalizeCityCodeList(" tehran ,KARAJ, karaj ")).toEqual([
      "TEHRAN",
      "KARAJ",
    ]);
  });

  it("rejects the WHOLE list on any unknown code — no silent drops", () => {
    expect(normalizeCityCodeList("TEHRAN,SOMEWHERE")).toBeNull();
  });

  it("accepts arrays and comma lists equally, and empty means clear", () => {
    expect(normalizeCityCodeList(["TEHRAN"])).toEqual(["TEHRAN"]);
    expect(normalizeCityCodeList("")).toEqual([]);
    expect(normalizeCityCodeList([])).toEqual([]);
  });

  it("enforces caller caps while allowing the full registry when requested", () => {
    const all = CITY_REGISTRY.map((entry) => entry.code);
    expect(normalizeCityCodeList(all.join(","), 10)).toBeNull();
    expect(normalizeCityCodeList(all.join(","), MAX_CAMPAIGN_CITIES)).toBeNull();
    expect(normalizeCityCodeList(all.join(","), MAX_REGISTRY_CITIES)).toHaveLength(130);
  });

  it("rejects non-string input", () => {
    expect(normalizeCityCodeList(42)).toBeNull();
    expect(normalizeCityCodeList({ code: "TEHRAN" })).toBeNull();
  });
});
