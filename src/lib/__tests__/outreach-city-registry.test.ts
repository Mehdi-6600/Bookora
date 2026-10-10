import { describe, expect, it } from "vitest";
import {
  CITY_REGISTRY,
  DEFAULT_APPROVED_CITIES,
  DUPLICATE_CODES,
  MAX_CAMPAIGN_CITIES,
  MAX_REGISTRY_CITIES,
  cityDefinition,
  isRegistryCityCode,
  mergeApprovedCities,
  normalizeCityCodeList,
} from "@/lib/outreach/city-registry";

/**
 * The 100-city market registry. These suites are the contract that lets the
 * campaign engine grow beyond the four launch cities WITHOUT ever touching
 * stored data: codes are stable, approval is explicit, and nothing here
 * implies that outreach is authorised anywhere automatically.
 */

describe("registry integrity", () => {
  it("holds up to 100 cities with unique, stable codes", () => {
    expect(CITY_REGISTRY.length).toBeGreaterThan(4);
    expect(CITY_REGISTRY.length).toBeLessThanOrEqual(MAX_REGISTRY_CITIES);
    expect(CITY_REGISTRY.length).toBe(100);
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

  it("provides Persian and English labels, a country and a region for every entry", () => {
    for (const entry of CITY_REGISTRY) {
      expect(entry.fa.length).toBeGreaterThan(0);
      expect(entry.en.length).toBeGreaterThan(0);
      expect(entry.country).toBe("IR");
      expect(entry.region.length).toBeGreaterThan(0);
    }
  });

  it("preserves the four launch cities, approved by default", () => {
    for (const code of ["TEHRAN", "MASHHAD", "SHIRAZ", "KARAJ"]) {
      const entry = cityDefinition(code);
      expect(entry, code).toBeDefined();
      expect(entry!.approved, code).toBe(true);
    }
    expect(DEFAULT_APPROVED_CITIES).toEqual(["TEHRAN", "MASHHAD", "KARAJ", "SHIRAZ"].filter((code) => DEFAULT_APPROVED_CITIES.includes(code)));
    expect(DEFAULT_APPROVED_CITIES.every((code) => isRegistryCityCode(code))).toBe(true);
  });

  it("every other city is registered but NOT approved", () => {
    const unapproved = CITY_REGISTRY.filter((entry) => !entry.approved);
    expect(unapproved.length).toBe(CITY_REGISTRY.length - DEFAULT_APPROVED_CITIES.length);
    expect(unapproved.every((entry) => !DEFAULT_APPROVED_CITIES.includes(entry.code))).toBe(true);
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
  it("defaults to the four launch cities", () => {
    expect(mergeApprovedCities()).toEqual(DEFAULT_APPROVED_CITIES);
  });

  it("admin enablement adds known codes only, in registry order", () => {
    const merged = mergeApprovedCities(["ISFAHAN", "TABRIZ", "NOT-A-CITY"]);
    expect(new Set(merged)).toEqual(
      new Set(["TEHRAN", "MASHHAD", "KARAJ", "SHIRAZ", "ISFAHAN", "TABRIZ"])
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

  it("cannot exceed the cap through overrides", () => {
    const all = CITY_REGISTRY.map((entry) => entry.code);
    expect(mergeApprovedCities(all, []).length).toBeLessThanOrEqual(
      MAX_CAMPAIGN_CITIES
    );
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

  it("enforces the cap", () => {
    const all = CITY_REGISTRY.map((entry) => entry.code);
    expect(normalizeCityCodeList(all.join(","), 10)).toBeNull();
    expect(normalizeCityCodeList(all.join(","), 100)).toHaveLength(100);
  });

  it("rejects non-string input", () => {
    expect(normalizeCityCodeList(42)).toBeNull();
    expect(normalizeCityCodeList({ code: "TEHRAN" })).toBeNull();
  });
});
