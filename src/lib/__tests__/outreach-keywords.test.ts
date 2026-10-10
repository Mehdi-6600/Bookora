import { describe, expect, it } from "vitest";
import {
  DEFAULT_KEYWORDS,
  matchKeywords,
  pickBestGroup,
  type MatchableKeyword,
} from "@/lib/outreach/keywords";

const keywords: MatchableKeyword[] = [
  { term: "barber", group: "BARBER", language: "en", priority: 5, enabled: true },
  { term: "barbershop", group: "BARBER", language: "en", priority: 5, enabled: true },
  { term: "beauty salon", group: "BEAUTY", language: "en", priority: 5, enabled: true },
  { term: "nail technician", group: "BEAUTY", language: "en", priority: 4, enabled: true },
  { term: "clinic", group: "MEDICAL", language: "en", priority: 3, enabled: true },
  { term: "آرایشگر مردانه", group: "BARBER", language: "fa", priority: 5, enabled: true },
  { term: "پیرایشگاه", group: "BARBER", language: "fa", priority: 5, enabled: true },
  { term: "سالن زیبایی", group: "BEAUTY", language: "fa", priority: 5, enabled: true },
  { term: "disabled keyword", group: "BEAUTY", language: "en", priority: 5, enabled: false },
];

describe("keyword matching", () => {
  it("matches an English business name", () => {
    const result = matchKeywords({ name: "Mehdi Barbershop" }, keywords);

    expect(result.group).toBe("BARBER");
    expect(result.category).toBe("BARBER");
    expect(result.matchedTerms).toContain("barbershop");
    expect(result.score).toBeGreaterThan(0);
  });

  it("matches a Persian business name", () => {
    const result = matchKeywords({ name: "آرایشگر مردانه مهدی" }, keywords);

    expect(result.group).toBe("BARBER");
    expect(result.matchedTerms).toContain("آرایشگر مردانه");
  });

  it("matches Persian text written with Arabic letter forms", () => {
    // "سالن زیبایی" written with Arabic yeh instead of Persian yeh.
    const arabicForms = "سالن زيبايي مریم";
    const result = matchKeywords({ name: arabicForms }, keywords);

    expect(result.group).toBe("BEAUTY");
    expect(result.matchedTerms).toContain("سالن زیبایی");
  });

  it("matches against the username and description too", () => {
    expect(
      matchKeywords({ name: "Studio 9", username: "nail_technician_9" }, keywords).group
    ).toBe("BEAUTY");
    expect(
      matchKeywords(
        { name: "Studio 9", description: "A small clinic for skin care" },
        keywords
      ).group
    ).toBe("MEDICAL");
  });

  it("returns no match for an unrelated business", () => {
    const result = matchKeywords({ name: "Corner Grocery Store" }, keywords);

    expect(result.matched).toHaveLength(0);
    expect(result.group).toBeNull();
    expect(result.score).toBe(0);
  });

  it("ignores disabled keywords", () => {
    const result = matchKeywords({ name: "Disabled Keyword Studio" }, keywords);

    expect(result.matched).toHaveLength(0);
  });

  it("caps the score at 100", () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      term: `kw${index}`,
      group: "BARBER",
      language: "en",
      priority: 5,
      enabled: true,
    }));

    const name = many.map((keyword) => keyword.term).join(" ");
    const result = matchKeywords({ name }, many);

    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("scores an exact barber higher than a generic medical match", () => {
    const barber = matchKeywords({ name: "barbershop" }, keywords).score;
    const clinic = matchKeywords({ name: "clinic" }, keywords).score;

    expect(barber).toBeGreaterThan(clinic);
  });

  it("adds a small bonus when a description is present", () => {
    const withDescription = matchKeywords(
      { name: "clinic", description: "Skin care clinic" },
      keywords
    ).score;
    const without = matchKeywords({ name: "clinic" }, keywords).score;

    expect(withDescription).toBeGreaterThan(without);
  });

  it("handles empty input without throwing", () => {
    const result = matchKeywords({}, keywords);
    expect(result.score).toBe(0);
    expect(result.group).toBeNull();
  });
});

describe("group selection", () => {
  it("picks the group with the highest summed priority", () => {
    expect(
      pickBestGroup([
        { term: "a", group: "MEDICAL", language: "en", priority: 2 },
        { term: "b", group: "BARBER", language: "en", priority: 5 },
      ])
    ).toBe("BARBER");
  });

  it("returns null for an empty match list", () => {
    expect(pickBestGroup([])).toBeNull();
  });
});

describe("default keyword set", () => {
  it("covers the documented barber, beauty and medical seed terms", () => {
    const groups = new Set(DEFAULT_KEYWORDS.map((keyword) => keyword.group));
    expect(groups).toEqual(new Set(["BARBER", "BEAUTY", "MEDICAL"]));

    const terms = DEFAULT_KEYWORDS.map((keyword) => keyword.term);
    for (const required of [
      "barber",
      "barbershop",
      "hairdresser",
      "hairstylist",
      "men's salon",
      "آرایشگر مردانه",
      "پیرایشگاه",
      "beauty salon",
      "makeup artist",
      "nail technician",
      "lash artist",
      "سالن زیبایی",
      "ناخن کار",
      "میکاپ آرتیست",
      "doctor",
      "dentist",
      "dermatologist",
      "physiotherapist",
      "clinic",
      "پزشک",
      "دندانپزشک",
      "متخصص پوست",
      "فیزیوتراپی",
      "کلینیک",
    ]) {
      expect(terms).toContain(required);
    }
  });

  it("uses unique (group, language, term) tuples so the DB unique index holds", () => {
    const keys = DEFAULT_KEYWORDS.map(
      (keyword) => `${keyword.group}|${keyword.language}|${keyword.term}`
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps every priority within the 1-5 range", () => {
    for (const keyword of DEFAULT_KEYWORDS) {
      expect(keyword.priority).toBeGreaterThanOrEqual(1);
      expect(keyword.priority).toBeLessThanOrEqual(5);
    }
  });
});
