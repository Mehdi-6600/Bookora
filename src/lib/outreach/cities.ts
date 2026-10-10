/**
 * Approved market scope for the Bookora acquisition campaign.
 *
 * The campaign targets men's barbershops and women's hair & beauty salons in
 * exactly four Iranian cities. Everything here is deliberately explicit:
 *
 *  - `city` is stored as a stable CODE (TEHRAN / MASHHAD / SHIRAZ / KARAJ),
 *    never as free text, so reporting can group reliably.
 *  - Persian and Arabic letter forms are normalised before comparison, because
 *    real directory listings mix them freely (کرج vs كرج, شیراز vs شيراز).
 *  - Karaj is NEVER folded into Tehran. They are ~40 km apart but they are
 *    separate approved cities and must be reported separately. If a source
 *    mentions more than one approved city, the result is AMBIGUOUS and a human
 *    must assign it — we do not guess.
 */

export const APPROVED_CITIES = [
  "TEHRAN",
  "MASHHAD",
  "SHIRAZ",
  "KARAJ",
] as const;

export type CityCode = (typeof APPROVED_CITIES)[number];

export function isCityCode(value: unknown): value is CityCode {
  return (
    typeof value === "string" &&
    (APPROVED_CITIES as readonly string[]).includes(value)
  );
}

/** Business segments tracked separately in every report. */
export const BUSINESS_SEGMENTS = ["MENS_BARBER", "WOMENS_SALON"] as const;
export type BusinessSegment = (typeof BUSINESS_SEGMENTS)[number];

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
      en: "Women's hair & beauty salon",
      fa: "سالن زیبایی زنانه",
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

const CITY_DEFS: CityDef[] = [
  {
    code: "TEHRAN",
    fa: "تهران",
    en: "Tehran",
    aliases: ["تهران", "tehran", "teheran", "theran", "تهرون"],
  },
  {
    code: "MASHHAD",
    fa: "مشهد",
    en: "Mashhad",
    aliases: ["مشهد", "mashhad", "mashad", "meshed", "mashahd"],
  },
  {
    code: "SHIRAZ",
    fa: "شیراز",
    en: "Shiraz",
    aliases: ["شیراز", "shiraz", "shirz", "شيراز"],
  },
  {
    code: "KARAJ",
    fa: "کرج",
    en: "Karaj",
    aliases: ["کرج", "karaj", "kraj", "karadj", "كرج"],
  },
];

export const CITY_LABELS: Record<CityCode, { en: string; fa: string }> = {
  TEHRAN: { en: "Tehran", fa: "تهران" },
  MASHHAD: { en: "Mashhad", fa: "مشهد" },
  SHIRAZ: { en: "Shiraz", fa: "شیراز" },
  KARAJ: { en: "Karaj", fa: "کرج" },
};

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

  const compact = compactPersian(raw);

  // 1. Exact alias match wins outright and is high confidence.
  for (const def of CITY_DEFS) {
    for (const alias of def.aliases) {
      if (compact === compactPersian(alias)) {
        return { city: def.code, confidence: "HIGH" };
      }
    }
  }

  // 2. Otherwise scan the blob for any mention of an approved city.
  return detectCity(raw);
}

/**
 * Scan free text (a directory listing, an address, a bio) for an approved city.
 *
 * Returns AMBIGUOUS when more than one approved city is mentioned. This is the
 * Karaj-vs-Tehran guard: a listing that says "تهران، کرج" gets no automatic
 * assignment.
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

  for (const def of CITY_DEFS) {
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

/** Women's hair & beauty salon signals. */
const WOMENS_TERMS = [
  "آرایشگاه زنانه",
  "سالن زیبایی زنانه",
  "سالن زیبایی",
  "سالن رنگ و مش",
  "سالن کوتاهی مو",
  "سالن ناخن",
  "خدمات مژه و ابرو",
  "میکاپ و شینیون",
  "شینیون",
  "سالن عروس",
  "عروس",
  "کاشت ناخن",
  "میکاپ",
  "ناخن",
  "مژه",
  "ابرو",
  "beauty salon",
  "hair salon",
  "nail",
  "makeup",
  "bridal salon",
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

  const hasMens = MENS_TERMS.some((t) => compact.includes(compactPersian(t)));
  const hasWomens = WOMENS_TERMS.some((t) =>
    compact.includes(compactPersian(t))
  );

  if (hasMens && hasWomens) return { segment: null, reason: "AMBIGUOUS" };
  if (hasMens) return { segment: "MENS_BARBER", confidence: "HIGH" };
  if (hasWomens) return { segment: "WOMENS_SALON", confidence: "HIGH" };
  return { segment: null, reason: "NONE" };
}

/* -------------------------------------------------------------------------- */
/* Helpers used by the API layer                                               */
/* -------------------------------------------------------------------------- */

/** Parse a list of city codes, ignoring anything outside the approved set. */
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

/** Verification states. A discovery hit is not automatically a prospect. */
export const VERIFICATION_STATUSES = [
  "DISCOVERED",
  "VERIFIED",
  "REJECTED",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export function isVerificationStatus(
  value: unknown
): value is VerificationStatus {
  return (
    typeof value === "string" &&
    (VERIFICATION_STATUSES as readonly string[]).includes(value)
  );
}

export const VERIFICATION_LABELS: Record<
  VerificationStatus,
  { en: string; fa: string }
> = {
  DISCOVERED: { en: "Discovered", fa: "کشف‌شده" },
  VERIFIED: { en: "Verified", fa: "تأییدشده" },
  REJECTED: { en: "Rejected", fa: "ردشده" },
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
