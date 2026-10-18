/**
 * Approved market scope for the Bookora acquisition campaign.
 *
 * Everything city-related flows through the central registry in
 * `city-registry.ts` — this module keeps the historical public API stable
 * while the underlying list grows to 150 registered cities; a campaign is
 * still capped at 100 selected cities.
 *
 *  - `city` is stored as a stable CODE (e.g. TEHRAN / MASHHAD / SHIRAZ /
 *    KARAJ / ISFAHAN …), never as free text, so reporting can group reliably
 *    and old campaigns keep working when new cities are registered.
 *  - Persian and Arabic letter forms are normalised before comparison, because
 *    real directory listings mix them freely (کرج vs كرج, شیراز vs شيراز).
 *  - Karaj is NEVER folded into Tehran. They are ~40 km apart but they are
 *    separate approved cities and must be reported separately. If a source
 *    mentions more than one detectable city, the result is AMBIGUOUS and a
 *    human must assign it — we do not guess.
 *  - Free-text DETECTION remains limited to the original four Iranian launch
 *    cities even when a market becomes campaign-eligible; this avoids silently
 *    widening the discovery pipeline's misclassification surface. Exact input
 *    (an admin typing "اصفهان" or
 *    "ISFAHAN") resolves across the whole registry.
 */

import {
  AUTO_APPROVED_CITY_CODES,
  AUTO_APPROVED_INTERNATIONAL_CITY_CODES,
  AUTO_APPROVED_IRANIAN_CITY_CODES,
  CITY_REGISTRY,
  DEFAULT_APPROVED_CITIES,
  INITIAL_LAUNCH_CITY_CODES,
  MAX_CAMPAIGN_CITIES,
  MAX_REGISTRY_CITIES,
  cityDefinition,
  outreachLanguagesForCity,
  isRegistryCityCode,
  isCampaignEligibleCityCode,
  mergeApprovedCities,
  normalizeCityCodeList,
  registryCityCodes,
} from "@/lib/outreach/city-registry";

export {
  AUTO_APPROVED_CITY_CODES,
  AUTO_APPROVED_INTERNATIONAL_CITY_CODES,
  AUTO_APPROVED_IRANIAN_CITY_CODES,
  CITY_REGISTRY,
  DEFAULT_APPROVED_CITIES,
  INITIAL_LAUNCH_CITY_CODES,
  MAX_CAMPAIGN_CITIES,
  MAX_REGISTRY_CITIES,
  cityDefinition,
  outreachLanguagesForCity,
  isRegistryCityCode,
  isCampaignEligibleCityCode,
  mergeApprovedCities,
  normalizeCityCodeList,
  registryCityCodes,
};

/**
 * Legacy fallback for campaigns with no explicit city selection. Keep it at
 * the original four launch cities so old empty campaigns never widen silently.
 * Other language-ready markets may be auto-eligible for explicit campaign
 * targeting via DEFAULT_APPROVED_CITIES.
 */
export const APPROVED_CITIES = INITIAL_LAUNCH_CITY_CODES;

/**
 * Every code the database may legitimately contain. Stored rows keep working
 * even if their city is later disabled — disabling a market only prevents NEW
 * selections; it never rewrites or deletes history.
 */
export const KNOWN_CITY_CODES = registryCityCodes();

export type CityCode = string;

/** Is this a code the registry knows (approved or not)? */
export function isCityCode(value: unknown): value is CityCode {
  return isRegistryCityCode(value);
}

export function cityLabel(
  code: string,
  lang: "en" | "fa"
): string {
  const def = cityDefinition(code);
  if (def) return lang === "fa" ? def.fa : def.en;
  // Unknown code: show it verbatim. Never substitute another city's name.
  return code;
}

/** Registry labels for every known code (legacy consumers keep working). */
export const CITY_LABELS: Record<string, { en: string; fa: string }> =
  Object.fromEntries(
    CITY_REGISTRY.map((entry) => [entry.code, { en: entry.en, fa: entry.fa }])
  );

/** Business segments tracked separately in every report. */
export const BUSINESS_SEGMENTS = [
  "MENS_BARBER",
  "WOMENS_SALON",
  "WOMENS_BEAUTY",
  "MEDICAL_PRACTICE",
] as const;
export type BusinessSegment = (typeof BUSINESS_SEGMENTS)[number];

/** Legacy campaign default retained so adding new segments never widens old campaigns. */
export const DEFAULT_CAMPAIGN_SEGMENTS: readonly BusinessSegment[] = [
  "MENS_BARBER",
  "WOMENS_SALON",
];

export function isBusinessSegment(value: unknown): value is BusinessSegment {
  return (
    typeof value === "string" &&
    (BUSINESS_SEGMENTS as readonly string[]).includes(value)
  );
}

export const SEGMENT_LABELS: Record<BusinessSegment, { en: string; fa: string }> =
  {
    MENS_BARBER: {
      en: "Men's barbershop",
      fa: "آرایشگاه مردانه",
    },
    WOMENS_SALON: {
      en: "Women's hair salon",
      fa: "آرایشگاه زنانه",
    },
    WOMENS_BEAUTY: {
      en: "Women's beauty services",
      fa: "خدمات زیبایی بانوان",
    },
    MEDICAL_PRACTICE: {
      en: "Medical practice",
      fa: "مطب و خدمات پزشکی",
    },
  };

/* -------------------------------------------------------------------------- */
/* Persian / Arabic normalisation                                              */
/* -------------------------------------------------------------------------- */

const ARABIC_TO_PERSIAN: Array<[string, string]> = [
  ["ي", "ی"], // Arabic yeh          -> Persian yeh
  ["ى", "ی"], // alef maksura        -> Persian yeh
  ["ك", "ک"], // Arabic kaf          -> Persian keheh
  ["ۀ", "ه"], // heh with yeh above  -> heh
  ["ة", "ه"], // teh marbuta         -> heh
  ["ؤ", "و"],
  ["إ", "ا"],
  ["أ", "ا"],
  ["آ", "آ"],
  ["ٱ", "ا"],
];

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Characters that carry no meaning and break naive comparisons. */
const IGNORED = /[ً-ْٰـ\u200b-\u200f\u061c\u0640]/g; // harakat, tatweel, ZW*, ALM

/**
 * Fold a string so that Persian and Arabic spellings of the same word compare
 * equal. Also folds Latin case, digits and whitespace.
 */
export function normalizePersian(input: string): string {
  let out = input;

  for (const [from, to] of ARABIC_TO_PERSIAN) {
    out = out.split(from).join(to);
  }

  out = out.replace(IGNORED, "");

  // Persian/Arabic-Indic digits -> ASCII
  out = out
    .split("")
    .map((ch) => {
      const p = PERSIAN_DIGITS.indexOf(ch);
      if (p !== -1) return String(p);
      const a = ARABIC_DIGITS.indexOf(ch);
      if (a !== -1) return String(a);
      return ch;
    })
    .join("");

  return out.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Strip punctuation, symbols and spacing entirely — used for dense Persian
 * substring checks, where spacing inside a compound word is not meaningful.
 */
export function compactPersian(input: string): string {
  return normalizePersian(input)
    .replace(/[\p{P}\p{S}\p{C}]/gu, "")
    .replace(/[^a-z0-9\u0600-\u06ff]/g, "");
}

/* -------------------------------------------------------------------------- */
/* City aliases                                                                */
/* -------------------------------------------------------------------------- */

type CityDef = {
  code: CityCode;
  fa: string;
  en: string;
  /** Aliases are compared after `compactPersian`. */
  aliases: string[];
};

function registryDefs(codes: readonly string[]): CityDef[] {
  return codes
    .map((code) => cityDefinition(code))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .map((entry) => ({
      code: entry.code,
      fa: entry.fa,
      en: entry.en,
      aliases: [entry.fa, entry.en, ...entry.aliases],
    }));
}

/**
 * DETECTION universe: the default-approved cities only. Auto-assignment must
 * stay as conservative as it was when the campaign covered four cities, even
 * after the registry expands. Admin-approved extras are matched for
 * exact input (below) but never guessed from free text.
 */
const DETECTION_DEFS: CityDef[] = registryDefs(INITIAL_LAUNCH_CITY_CODES);

/** Exact-resolution universe: every registered city, approved or not. */
const ALL_CITY_DEFS: CityDef[] = registryDefs(KNOWN_CITY_CODES);

/** Legacy export kept for compatibility; now registry-derived and wider. */
export const CITY_DEFS = ALL_CITY_DEFS;

/** "Ambiguous" is a first-class result: it means a human must decide. */
export type CityResolution =
  | { city: CityCode; confidence: "HIGH" }
  | { city: null; reason: "NONE" | "AMBIGUOUS" };

/**
 * Resolve a city from a user-supplied value (an admin typing "کرج", "karaj",
 * "KARAJ", " مشهد ") or from a free-text blob such as a directory address.
 */
export function resolveCity(input: unknown): CityResolution {
  if (typeof input !== "string") return { city: null, reason: "NONE" };
  const raw = input.trim();
  if (raw.length === 0) return { city: null, reason: "NONE" };

  // 0. A canonical code passes through untouched — including codes with
  //    underscores (BANDAR_ABBAS, MASJED_SOLEYMAN), whose display names use
  //    spaces. Stored campaign data must round-trip through this function.
  const asCode = raw.toLocaleUpperCase("en");
  if (isCityCode(asCode)) return { city: asCode, confidence: "HIGH" };

  const compact = compactPersian(raw);

  // 1. Exact alias match against the WHOLE registry wins outright. An
  //    unapproved city still resolves to its own code here — approval is a
  //    targeting question, enforced by `parseCampaignCities`, never by
  //    substituting a different city.
  for (const def of ALL_CITY_DEFS) {
    for (const alias of def.aliases) {
      if (compact === compactPersian(alias)) {
        return { city: def.code, confidence: "HIGH" };
      }
    }
  }

  // 2. Otherwise scan the blob, but only against the detectable (default
  //    approved) cities. Anything else stays UNASSIGNED for a human.
  return detectCity(raw);
}

/**
 * Scan free text (a directory listing, an address, a bio) for a detectable
 * city (the original launch set — see `DETECTION_DEFS`).
 *
 * Returns AMBIGUOUS when more than one detectable city is mentioned. This is
 * the Karaj-vs-Tehran guard: a listing that says "تهران، کرج" gets no
 * automatic assignment.
 */
export function detectCity(text: unknown): CityResolution {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { city: null, reason: "NONE" };
  }

  // Latin aliases are matched against the space-preserving form so that "kraj"
  // inside "karajville" does not match. Persian aliases are matched against the
  // compacted form, because Persian compounds are written with variable spacing.
  const spaced = normalizePersian(text);
  const compact = compactPersian(text);
  const hits = new Set<CityCode>();

  for (const def of DETECTION_DEFS) {
    for (const alias of def.aliases) {
      const needle = compactPersian(alias);
      if (hits.has(def.code)) continue;

      if (/^[a-z0-9]+$/.test(needle)) {
        const re = new RegExp(`(^|[^a-z0-9])${needle}([^a-z0-9]|$)`);
        if (re.test(spaced)) hits.add(def.code);
      } else if (compact.includes(needle)) {
        hits.add(def.code);
      }
    }
  }

  if (hits.size === 1) {
    const [only] = [...hits];
    return { city: only, confidence: "HIGH" };
  }
  if (hits.size > 1) return { city: null, reason: "AMBIGUOUS" };
  return { city: null, reason: "NONE" };
}

/* -------------------------------------------------------------------------- */
/* Segment detection                                                           */
/* -------------------------------------------------------------------------- */

/** Men's barbershop signals. */
const MENS_TERMS = [
  "آرایشگاه مردانه",
  "پیرایشگاه مردانه",
  "پیرایش مردانه",
  "سلمانی",
  "باربر شاپ",
  "باربرشاپ",
  "هیرکات",
  "اصلاح موی مردانه",
  "آرایشگاه آقایان",
  "سالن آقایان",
  "barber",
  "barbershop",
  "men salon",
  "mens salon",
  "men's salon",
];

/** General women's hair salons and hairdressing signals. */
const WOMENS_SALON_TERMS = [
  "آرایشگاه زنانه",
  "آرایشگر زنانه",
  "آرایشگاه بانوان",
  "آرایشگر بانوان",
  "سالن بانوان",
  "سالن مو زنانه",
  "سالن زیبایی زنانه",
  "سالن زیبایی",
  "beauty salon",
  "سالن رنگ و مش",
  "سالن کوتاهی مو",
  "شینیون",
  "سالن عروس",
  "عروس",
  "hair salon",
  "women's hair salon",
  "women's hairdresser",
  "ladies hair salon",
  "women's salon",
  "womens salon",
  "bridal salon",
];

/** Specialized women's beauty services, kept separate for campaign reporting. */
const WOMENS_BEAUTY_TERMS = [
  "سالن ناخن",
  "ناخن کار",
  "ناخن‌کار",
  "ناخنکار",
  "طراح ناخن",
  "کاشت ناخن",
  "خدمات مژه و ابرو",
  "مژه کار",
  "میکاپ و شینیون",
  "میکاپ آرتیست",
  "میکاپ",
  "اکستنشن مژه",
  "لیفت مژه",
  "پاکسازی پوست",
  "فیشیال",
  "اپیلاسیون",
  "ابرو",
  "مژه",
  "اسپا",
  "nail technician",
  "nail tech",
  "nail artist",
  "nail designer",
  "nail salon",
  "makeup artist",
  "lash artist",
  "eyelash extensions",
  "brow artist",
  "esthetician",
  "cosmetologist",
  "beauty therapist",
  "facial",
  "skincare",
  "waxing",
];

/** Publicly described medical practices and independent clinicians. */
const MEDICAL_TERMS = [
  "doctor",
  "physician",
  "general practitioner",
  "medical practice",
  "surgeon",
  "gynecologist",
  "ob/gyn",
  "urologist",
  "neurologist",
  "dentist",
  "dental clinic",
  "dermatologist",
  "pediatrician",
  "ophthalmologist",
  "psychologist",
  "physiotherapist",
  "clinic",
  "پزشک",
  "پزشک عمومی",
  "پزشک متخصص",
  "دکتر",
  "مطب",
  "جراح",
  "متخصص زنان",
  "اورولوژیست",
  "دندانپزشک",
  "دندان پزشکی",
  "متخصص پوست",
  "متخصص کودکان",
  "چشم پزشک",
  "روانشناس",
  "فیزیوتراپیست",
  "کلینیک",
  "طبيب",
  "طبيبة",
  "عيادة",
  "طبيب أسنان",
  "طبيبة أسنان",
];

export type SegmentResolution =
  | { segment: BusinessSegment; confidence: "HIGH" }
  | { segment: null; reason: "NONE" | "AMBIGUOUS" };

/**
 * Classify a business from its public name / description.
 *
 * "سالن زیبایی" alone maps to WOMENS_SALON because that is how women's salons
 * are listed; a men's salon says "آرایشگاه مردانه" or "پیرایشگاه". If the text
 * explicitly contains strong signals for BOTH, it is AMBIGUOUS (some venues
 * have separate men's and women's sections) and a human decides.
 */
export function detectSegment(text: unknown): SegmentResolution {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { segment: null, reason: "NONE" };
  }

  const compact = compactPersian(text);
  const includesAny = (terms: string[]) =>
    terms.some((term) => compact.includes(compactPersian(term)));

  const matched: BusinessSegment[] = [];
  if (includesAny(MENS_TERMS)) matched.push("MENS_BARBER");
  if (includesAny(WOMENS_SALON_TERMS)) matched.push("WOMENS_SALON");
  if (includesAny(WOMENS_BEAUTY_TERMS)) matched.push("WOMENS_BEAUTY");
  if (includesAny(MEDICAL_TERMS)) matched.push("MEDICAL_PRACTICE");

  if (matched.length > 1) return { segment: null, reason: "AMBIGUOUS" };
  if (matched.length === 1) return { segment: matched[0], confidence: "HIGH" };
  return { segment: null, reason: "NONE" };
}

/* -------------------------------------------------------------------------- */
/* Helpers used by the API layer                                               */
/* -------------------------------------------------------------------------- */

/** Parse a list of city codes, ignoring anything the registry does not know. */
export function parseCityList(value: unknown): CityCode[] {
  const arr = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const out = new Set<CityCode>();
  for (const item of arr) {
    if (isCityCode(item)) out.add(item);
    else if (typeof item === "string") {
      const resolved = resolveCity(item);
      if (resolved.city) out.add(resolved.city);
    }
  }
  return [...out];
}

export function parseSegmentList(value: unknown): BusinessSegment[] {
  const arr = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
  const out = new Set<BusinessSegment>();
  for (const item of arr) {
    if (isBusinessSegment(item)) out.add(item);
  }
  return [...out];
}

/* -------------------------------------------------------------------------- */
/* Campaign targeting                                                          */
/* -------------------------------------------------------------------------- */

export type CampaignCityParse = {
  cities: CityCode[];
  /** Codes that are not in the registry at all. */
  unknown: string[];
  /** Registry codes not enabled by the automatic locale policy or an override. */
  unapproved: string[];
  /** The list was longer than MAX_CAMPAIGN_CITIES. */
  tooMany: boolean;
};

/**
 * Strict, reviewable parse of the cities a campaign selects.
 *
 * Unlike `parseCityList` (tolerant, used for stored data and display), this
 * NEVER drops or substitutes a value silently: unknown codes and unapproved
 * codes are reported back so the API can reject them explicitly.
 */
export function parseCampaignCities(
  value: unknown,
  approvedCodes: readonly string[] = DEFAULT_APPROVED_CITIES
): CampaignCityParse {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  // Never let a caller-supplied approval list bypass the language-readiness gate.
  const approved = new Set(approvedCodes.filter(isCampaignEligibleCityCode));
  const cities: CityCode[] = [];
  const unknown: string[] = [];
  const unapproved: string[] = [];
  let tooMany = false;

  const seenInput = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string" || item.trim().length === 0) continue;
    const resolved = resolveCity(item);
    const code = resolved.city;
    if (!code) {
      const label = String(item).trim().slice(0, 40);
      if (!seenInput.has(label)) unknown.push(label);
      seenInput.add(label);
      continue;
    }
    if (seenInput.has(`code:${code}`)) continue;
    seenInput.add(`code:${code}`);

    if (!approved.has(code)) {
      if (!unapproved.includes(code)) unapproved.push(code);
      continue;
    }
    if (cities.length >= MAX_CAMPAIGN_CITIES) {
      tooMany = true;
      continue;
    }
    cities.push(code);
  }
  if (raw.length > MAX_CAMPAIGN_CITIES) tooMany = true;

  return { cities, unknown, unapproved, tooMany };
}

/**
 * The effective approved-city list for this deployment: registry defaults
 * merged with the administrator overrides stored in `admin_settings`
 * (`outreach.cities_enabled` / `outreach.cities_disabled`). A read failure
 * propagates: falling back to defaults could re-enable a disabled market.
 */
export async function getEffectiveApprovedCities(): Promise<string[]> {
  // Imported lazily so the pure module stays dependency-light for tests.
  const { getCityApprovalOverrides } = await import("@/lib/outreach/settings");
  const { enabled, disabled } = await getCityApprovalOverrides();
  return mergeApprovedCities(enabled, disabled);
}

import {
  VERIFICATION_STATUSES,
  type VerificationStatus,
  isVerificationStatus,
  VERIFICATION_LABELS,
} from "@/lib/outreach/types";

/** Verification states. A discovery hit is not automatically a prospect. */
// Re-exported from types.ts for backward compatibility.
export {
  VERIFICATION_STATUSES,
  type VerificationStatus,
  isVerificationStatus,
  VERIFICATION_LABELS,
};

/** How likely this business is to benefit from online booking. */
export const BOOKING_RELEVANCE = ["HIGH", "MEDIUM", "LOW"] as const;
export type BookingRelevance = (typeof BOOKING_RELEVANCE)[number];

export function isBookingRelevance(
  value: unknown
): value is BookingRelevance {
  return (
    typeof value === "string" &&
    (BOOKING_RELEVANCE as readonly string[]).includes(value)
  );
}
