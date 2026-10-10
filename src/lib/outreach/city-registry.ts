/**
 * Bookora market registry — the single source of truth for cities.
 *
 * Design rules (these mirror the campaign safety rules in `campaigns.ts`):
 *
 *  - A city is stored and communicated as a stable CODE (upper ASCII,
 *    `[A-Z0-9_]+`), never as free text. Codes of existing campaigns and
 *    prospects are never renamed or reused, so history stays queryable
 *    while the registry grows.
 *  - The registry can hold up to 100 cities (`MAX_REGISTRY_CITIES`); a
 *    campaign may select up to 100 of them (`MAX_CAMPAIGN_CITIES`).
 *  - `approved` marks the cities an administrator has signed off for
 *    outreach. The four launch cities are approved by default; every
 *    other entry starts DISABLED and only an administrator can approve
 *    it (Admin → Outreach → Campaigns → Markets, persisted in
 *    `admin_settings` as `outreach.cities_enabled` /
 *    `outreach.cities_disabled`).
 *  - Free-text city DETECTION (auto-assigning a discovery hit to a city)
 *    is deliberately limited to the default-approved set so a 100-city
 *    registry cannot widen the misclassification surface. Exact admin
 *    input ("اصفهان", "Isfahan", "ISFAHAN") resolves across the whole
 *    registry; an unapproved city then fails campaign validation with an
 *    explicit error — it is never silently swapped for another city.
 *
 * This is market configuration only. It asserts nothing about specific
 * businesses and never implies that outreach in a city is authorised;
 * unapproved cities are simply *known*, not *usable*.
 */

export type CityDefinition = {
  /** Stable code stored in the database. Never reused, never renamed. */
  code: string;
  /** Persian display name. */
  fa: string;
  /** English display name. */
  en: string;
  /** ISO 3166 alpha-2 country code; the registry is Iran-only for now. */
  country: string;
  /** Province / region label for admin surfaces and reports. */
  region: string;
  /** Default approval state — `true` only for the launch cities. */
  approved: boolean;
  /** Extra spellings, matched after `compactPersian`. */
  aliases: readonly string[];
};

export const MAX_REGISTRY_CITIES = 100;
export const MAX_CAMPAIGN_CITIES = 100;

export const CITY_REGISTRY: readonly CityDefinition[] = [
  {
    code: "TEHRAN",
    fa: "تهران",
    en: "Tehran",
    country: "IR",
    region: "Tehran",
    approved: true,
    aliases: ["teheran", "theran", "تهرون"],
  },
  {
    code: "MASHHAD",
    fa: "مشهد",
    en: "Mashhad",
    country: "IR",
    region: "Razavi Khorasan",
    approved: true,
    aliases: ["mashad", "meshed", "mashahd"],
  },
  {
    code: "ISFAHAN",
    fa: "اصفهان",
    en: "Isfahan",
    country: "IR",
    region: "Isfahan",
    approved: false,
    aliases: ["esfahan", "spahan"],
  },
  {
    code: "KARAJ",
    fa: "کرج",
    en: "Karaj",
    country: "IR",
    region: "Alborz",
    approved: true,
    aliases: ["kraj", "karadj", "كرج"],
  },
  {
    code: "SHIRAZ",
    fa: "شیراز",
    en: "Shiraz",
    country: "IR",
    region: "Fars",
    approved: true,
    aliases: ["shirz", "شيراز"],
  },
  {
    code: "TABRIZ",
    fa: "تبریز",
    en: "Tabriz",
    country: "IR",
    region: "East Azerbaijan",
    approved: false,
    aliases: ["tavriz"],
  },
  {
    code: "AHVAZ",
    fa: "اهواز",
    en: "Ahvaz",
    country: "IR",
    region: "Khuzestan",
    approved: false,
    aliases: ["ahwaz"],
  },
  {
    code: "QOM",
    fa: "قم",
    en: "Qom",
    country: "IR",
    region: "Qom",
    approved: false,
    aliases: ["ghom", "qum"],
  },
  {
    code: "KERMANSHAH",
    fa: "کرمانشاه",
    en: "Kermanshah",
    country: "IR",
    region: "Kermanshah",
    approved: false,
    aliases: ["beharestan"],
  },
  {
    code: "URMIA",
    fa: "ارومیه",
    en: "Urmia",
    country: "IR",
    region: "West Azerbaijan",
    approved: false,
    aliases: ["orumiyeh", "oroumieh"],
  },
  {
    code: "RASHT",
    fa: "رشت",
    en: "Rasht",
    country: "IR",
    region: "Gilan",
    approved: false,
    aliases: [],
  },
  {
    code: "KERMAN",
    fa: "کرمان",
    en: "Kerman",
    country: "IR",
    region: "Kerman",
    approved: false,
    aliases: [],
  },
  {
    code: "HAMADAN",
    fa: "همدان",
    en: "Hamadan",
    country: "IR",
    region: "Hamadan",
    approved: false,
    aliases: ["hamedan", "ekbatana"],
  },
  {
    code: "KHORRAMABAD",
    fa: "خرم‌آباد",
    en: "Khorramabad",
    country: "IR",
    region: "Lorestan",
    approved: false,
    aliases: ["khorram abad", "خرم آباد"],
  },
  {
    code: "ARDEBIL",
    fa: "اردبیل",
    en: "Ardabil",
    country: "IR",
    region: "Ardabil",
    approved: false,
    aliases: [],
  },
  {
    code: "BANDAR_ABBAS",
    fa: "بندرعباس",
    en: "Bandar Abbas",
    country: "IR",
    region: "Hormozgan",
    approved: false,
    aliases: ["bandarabbas", "bender abbas"],
  },
  {
    code: "ZAHEDAN",
    fa: "زاهدان",
    en: "Zahedan",
    country: "IR",
    region: "Sistan and Baluchestan",
    approved: false,
    aliases: [],
  },
  {
    code: "YASOUJ",
    fa: "یاسوج",
    en: "Yasuj",
    country: "IR",
    region: "Kohgiluyeh and Boyer-Ahmad",
    approved: false,
    aliases: ["yasooj"],
  },
  {
    code: "BOJNURD",
    fa: "بجنورد",
    en: "Bojnord",
    country: "IR",
    region: "North Khorasan",
    approved: false,
    aliases: ["bojnurd", "bojnoured"],
  },
  {
    code: "SANANDAJ",
    fa: "سنندج",
    en: "Sanandaj",
    country: "IR",
    region: "Kurdistan",
    approved: false,
    aliases: ["senandaj"],
  },
  {
    code: "ZANJAN",
    fa: "زنجان",
    en: "Zanjan",
    country: "IR",
    region: "Zanjan",
    approved: false,
    aliases: [],
  },
  {
    code: "GORGAN",
    fa: "گرگان",
    en: "Gorgan",
    country: "IR",
    region: "Golestan",
    approved: false,
    aliases: ["jorjan"],
  },
  {
    code: "QAZVIN",
    fa: "قزوین",
    en: "Qazvin",
    country: "IR",
    region: "Qazvin",
    approved: false,
    aliases: ["ghazvin", "kazvin"],
  },
  {
    code: "SARI",
    fa: "ساری",
    en: "Sari",
    country: "IR",
    region: "Mazandaran",
    approved: false,
    aliases: [],
  },
  {
    code: "ARAK",
    fa: "اراک",
    en: "Arak",
    country: "IR",
    region: "Markazi",
    approved: false,
    aliases: ["soltanabad"],
  },
  {
    code: "BUSHEHR",
    fa: "بوشهر",
    en: "Bushehr",
    country: "IR",
    region: "Bushehr",
    approved: false,
    aliases: ["bushir"],
  },
  {
    code: "ZABOL",
    fa: "زابل",
    en: "Zabol",
    country: "IR",
    region: "Sistan and Baluchestan",
    approved: false,
    aliases: [],
  },
  {
    code: "BIRJAND",
    fa: "بیرجند",
    en: "Birjand",
    country: "IR",
    region: "South Khorasan",
    approved: false,
    aliases: ["birdjand"],
  },
  {
    code: "SEMNAN",
    fa: "سمنان",
    en: "Semnan",
    country: "IR",
    region: "Semnan",
    approved: false,
    aliases: [],
  },
  {
    code: "SHAHREZA",
    fa: "شهرضا",
    en: "Shahreza",
    country: "IR",
    region: "Isfahan",
    approved: false,
    aliases: [],
  },
  {
    code: "KASHAN",
    fa: "کاشان",
    en: "Kashan",
    country: "IR",
    region: "Isfahan",
    approved: false,
    aliases: [],
  },
  {
    code: "VARAMIN",
    fa: "ورامین",
    en: "Varamin",
    country: "IR",
    region: "Tehran",
    approved: false,
    aliases: ["veramin"],
  },
  {
    code: "SHAHRIAR",
    fa: "شهریار",
    en: "Shahriar",
    country: "IR",
    region: "Tehran",
    approved: false,
    aliases: ["shahriyar"],
  },
  {
    code: "MALARD",
    fa: "ملارد",
    en: "Malard",
    country: "IR",
    region: "Alborz",
    approved: false,
    aliases: ["mallard"],
  },
  {
    code: "QARCHAK",
    fa: "قرچک",
    en: "Qarchak",
    country: "IR",
    region: "Tehran",
    approved: false,
    aliases: ["gharchak"],
  },
  {
    code: "ANDISHEH",
    fa: "اندیشه",
    en: "Andisheh",
    country: "IR",
    region: "Tehran",
    approved: false,
    aliases: ["andishe"],
  },
  {
    code: "PAKDASHT",
    fa: "پاکدشت",
    en: "Pakdasht",
    country: "IR",
    region: "Tehran",
    approved: false,
    aliases: [],
  },
  {
    code: "HASHTGERD",
    fa: "هشتگرد",
    en: "Hashtgerd",
    country: "IR",
    region: "Alborz",
    approved: false,
    aliases: ["kishkarud"],
  },
  {
    code: "KHORRAMSHAHR",
    fa: "خرمشهر",
    en: "Khorramshahr",
    country: "IR",
    region: "Khuzestan",
    approved: false,
    aliases: ["mahammerah", "khorram shahr"],
  },
  {
    code: "ABADAN",
    fa: "آبادان",
    en: "Abadan",
    country: "IR",
    region: "Khuzestan",
    approved: false,
    aliases: [],
  },
  {
    code: "DEZFUL",
    fa: "دزفول",
    en: "Dezful",
    country: "IR",
    region: "Khuzestan",
    approved: false,
    aliases: ["dezfool"],
  },
  {
    code: "SHUSHTAR",
    fa: "شوشتر",
    en: "Shushtar",
    country: "IR",
    region: "Khuzestan",
    approved: false,
    aliases: ["sustar"],
  },
  {
    code: "BEHBAHAN",
    fa: "بهبهان",
    en: "Behbahan",
    country: "IR",
    region: "Khuzestan",
    approved: false,
    aliases: ["behbehan"],
  },
  {
    code: "IZEH",
    fa: "ایذه",
    en: "Izeh",
    country: "IR",
    region: "Khuzestan",
    approved: false,
    aliases: ["eydun"],
  },
  {
    code: "MASJED_SOLEYMAN",
    fa: "مسجدسلیمان",
    en: "Masjed Soleyman",
    country: "IR",
    region: "Khuzestan",
    approved: false,
    aliases: ["مسجد سلیمان"],
  },
  {
    code: "BORUJERD",
    fa: "بروجرد",
    en: "Borujerd",
    country: "IR",
    region: "Lorestan",
    approved: false,
    aliases: ["boroujerd"],
  },
  {
    code: "NAHAVAND",
    fa: "نهاوند",
    en: "Nahavand",
    country: "IR",
    region: "Hamadan",
    approved: false,
    aliases: ["nehavand"],
  },
  {
    code: "MALAYER",
    fa: "ملایر",
    en: "Malayer",
    country: "IR",
    region: "Hamadan",
    approved: false,
    aliases: [],
  },
  {
    code: "KHOY",
    fa: "خوی",
    en: "Khoy",
    country: "IR",
    region: "West Azerbaijan",
    approved: false,
    aliases: ["khaloy"],
  },
  {
    code: "MIANDOAB",
    fa: "میاندوآب",
    en: "Miandoab",
    country: "IR",
    region: "West Azerbaijan",
    approved: false,
    aliases: [],
  },
  {
    code: "MAHABAD",
    fa: "مهاباد",
    en: "Mahabad",
    country: "IR",
    region: "West Azerbaijan",
    approved: false,
    aliases: [],
  },
  {
    code: "MARAGHEH",
    fa: "مراغه",
    en: "Maragheh",
    country: "IR",
    region: "East Azerbaijan",
    approved: false,
    aliases: ["maraghe", "maragha"],
  },
  {
    code: "KHALKHAL",
    fa: "خلخال",
    en: "Khalkhal",
    country: "IR",
    region: "Ardabil",
    approved: false,
    aliases: [],
  },
  {
    code: "PARSABAD",
    fa: "پارس‌آباد",
    en: "Parsabad",
    country: "IR",
    region: "Ardabil",
    approved: false,
    aliases: ["pars abad", "پارس آباد"],
  },
  {
    code: "MARIVAN",
    fa: "مریوان",
    en: "Marivan",
    country: "IR",
    region: "Kurdistan",
    approved: false,
    aliases: [],
  },
  {
    code: "SAQQEZ",
    fa: "سقز",
    en: "Saqqez",
    country: "IR",
    region: "Kurdistan",
    approved: false,
    aliases: ["saghez"],
  },
  {
    code: "BANEH",
    fa: "بانه",
    en: "Baneh",
    country: "IR",
    region: "Kurdistan",
    approved: false,
    aliases: [],
  },
  {
    code: "GONBAD_QABUS",
    fa: "گنبدکاوس",
    en: "Gonbad-e Qabus",
    country: "IR",
    region: "Golestan",
    approved: false,
    aliases: ["gonbadkavus", "گنبد کاووس"],
  },
  {
    code: "BABOL",
    fa: "بابول",
    en: "Babol",
    country: "IR",
    region: "Mazandaran",
    approved: false,
    aliases: ["barforush"],
  },
  {
    code: "AMOL",
    fa: "آمل",
    en: "Amol",
    country: "IR",
    region: "Mazandaran",
    approved: false,
    aliases: ["ameol"],
  },
  {
    code: "QAEM_SHAHR",
    fa: "قائم‌شهر",
    en: "Qaem Shahr",
    country: "IR",
    region: "Mazandaran",
    approved: false,
    aliases: ["qaimshahr", "قائم شهر"],
  },
  {
    code: "BEHSHAHAR",
    fa: "بهشهر",
    en: "Behshahr",
    country: "IR",
    region: "Mazandaran",
    approved: false,
    aliases: ["ashraf"],
  },
  {
    code: "NEKA",
    fa: "نکا",
    en: "Neka",
    country: "IR",
    region: "Mazandaran",
    approved: false,
    aliases: [],
  },
  {
    code: "CHALUS",
    fa: "چالوس",
    en: "Chalus",
    country: "IR",
    region: "Mazandaran",
    approved: false,
    aliases: [],
  },
  {
    code: "LAHIJAN",
    fa: "لاهیجان",
    en: "Lahijan",
    country: "IR",
    region: "Gilan",
    approved: false,
    aliases: ["lalejan"],
  },
  {
    code: "ASTARA",
    fa: "آستارا",
    en: "Astara",
    country: "IR",
    region: "Gilan",
    approved: false,
    aliases: [],
  },
  {
    code: "BANDAR_ANZALI",
    fa: "بندرانزلی",
    en: "Bandar-e Anzali",
    country: "IR",
    region: "Gilan",
    approved: false,
    aliases: ["enzeli", "bandaranzali"],
  },
  {
    code: "JIROFT",
    fa: "جیرفت",
    en: "Jiroft",
    country: "IR",
    region: "Kerman",
    approved: false,
    aliases: ["jiruft"],
  },
  {
    code: "RAFSANJAN",
    fa: "رفسنجان",
    en: "Rafsanjan",
    country: "IR",
    region: "Kerman",
    approved: false,
    aliases: ["rafzenjan"],
  },
  {
    code: "SIRJAN",
    fa: "سیرجان",
    en: "Sirjan",
    country: "IR",
    region: "Kerman",
    approved: false,
    aliases: [],
  },
  {
    code: "BAM",
    fa: "بم",
    en: "Bam",
    country: "IR",
    region: "Kerman",
    approved: false,
    aliases: [],
  },
  {
    code: "NISHAPUR",
    fa: "نیشابور",
    en: "Nishapur",
    country: "IR",
    region: "Razavi Khorasan",
    approved: false,
    aliases: ["neishabour", "nishabor"],
  },
  {
    code: "SABZEVAR",
    fa: "سبزوار",
    en: "Sabzevar",
    country: "IR",
    region: "Razavi Khorasan",
    approved: false,
    aliases: ["sabzavar"],
  },
  {
    code: "TORBAT_HEYDARIEH",
    fa: "تربت‌حیدریه",
    en: "Torbat-e Heydarieh",
    country: "IR",
    region: "Razavi Khorasan",
    approved: false,
    aliases: ["torbat heydarieh"],
  },
  {
    code: "TORBAT_JAM",
    fa: "تربت‌جام",
    en: "Torbat-e Jam",
    country: "IR",
    region: "Razavi Khorasan",
    approved: false,
    aliases: ["torbat jam"],
  },
  {
    code: "KASHMAR",
    fa: "کاشمر",
    en: "Kashmar",
    country: "IR",
    region: "Razavi Khorasan",
    approved: false,
    aliases: ["kashmer"],
  },
  {
    code: "QUCHAN",
    fa: "قوچان",
    en: "Quchan",
    country: "IR",
    region: "Razavi Khorasan",
    approved: false,
    aliases: ["ghuchan", "guchan"],
  },
  {
    code: "KHAF",
    fa: "خواف",
    en: "Khaf",
    country: "IR",
    region: "Razavi Khorasan",
    approved: false,
    aliases: [],
  },
  {
    code: "SARAKHS",
    fa: "سرخس",
    en: "Sarakhs",
    country: "IR",
    region: "Razavi Khorasan",
    approved: false,
    aliases: [],
  },
  {
    code: "ESFARAYEN",
    fa: "اسفراین",
    en: "Esfarayen",
    country: "IR",
    region: "North Khorasan",
    approved: false,
    aliases: ["esfarain"],
  },
  {
    code: "FERDOWS",
    fa: "فردوس",
    en: "Ferdows",
    country: "IR",
    region: "South Khorasan",
    approved: false,
    aliases: ["tabas-e ferdows"],
  },
  {
    code: "CHABAHAR",
    fa: "چابهار",
    en: "Chabahar",
    country: "IR",
    region: "Sistan and Baluchestan",
    approved: false,
    aliases: ["chabahar port"],
  },
  {
    code: "IRANSHAHR",
    fa: "ایران‌شهر",
    en: "Iranshahr",
    country: "IR",
    region: "Sistan and Baluchestan",
    approved: false,
    aliases: ["farahabad", "ایران شهر"],
  },
  {
    code: "KHASH",
    fa: "خاش",
    en: "Khash",
    country: "IR",
    region: "Sistan and Baluchestan",
    approved: false,
    aliases: [],
  },
  {
    code: "QESHM",
    fa: "قشم",
    en: "Qeshm",
    country: "IR",
    region: "Hormozgan",
    approved: false,
    aliases: ["keshm"],
  },
  {
    code: "MINAB",
    fa: "میناب",
    en: "Minab",
    country: "IR",
    region: "Hormozgan",
    approved: false,
    aliases: [],
  },
  {
    code: "JAHROM",
    fa: "جهرم",
    en: "Jahrom",
    country: "IR",
    region: "Fars",
    approved: false,
    aliases: [],
  },
  {
    code: "KAZERUN",
    fa: "کازرون",
    en: "Kazerun",
    country: "IR",
    region: "Fars",
    approved: false,
    aliases: ["kaserun"],
  },
  {
    code: "ABADEH",
    fa: "آباده",
    en: "Abadeh",
    country: "IR",
    region: "Fars",
    approved: false,
    aliases: ["abade"],
  },
  {
    code: "SHAHREKORD",
    fa: "شهرکرد",
    en: "Shahrekord",
    country: "IR",
    region: "Chaharmahal and Bakhtiari",
    approved: false,
    aliases: ["shahrekoord"],
  },
  {
    code: "YAZD",
    fa: "یزد",
    en: "Yazd",
    country: "IR",
    region: "Yazd",
    approved: false,
    aliases: ["jezd"],
  },
  {
    code: "ARDAKAN",
    fa: "اردکان",
    en: "Ardakan",
    country: "IR",
    region: "Yazd",
    approved: false,
    aliases: [],
  },
  {
    code: "MEYBOD",
    fa: "میبد",
    en: "Meybod",
    country: "IR",
    region: "Yazd",
    approved: false,
    aliases: ["maybod"],
  },
  {
    code: "SAVEH",
    fa: "ساوه",
    en: "Saveh",
    country: "IR",
    region: "Markazi",
    approved: false,
    aliases: ["sava"],
  },
  {
    code: "KHOMEIN",
    fa: "خمین",
    en: "Khomein",
    country: "IR",
    region: "Markazi",
    approved: false,
    aliases: ["khomaini"],
  },
  {
    code: "MAHALLAT",
    fa: "محلات",
    en: "Mahallat",
    country: "IR",
    region: "Markazi",
    approved: false,
    aliases: ["nuqab"],
  },
  {
    code: "NAJAFABAD",
    fa: "نجف‌آباد",
    en: "Najafabad",
    country: "IR",
    region: "Isfahan",
    approved: false,
    aliases: ["najaf abad", "نجف آباد"],
  },
  {
    code: "ILAM",
    fa: "ایلام",
    en: "Ilam",
    country: "IR",
    region: "Ilam",
    approved: false,
    aliases: [],
  },
  {
    code: "DELIJAN",
    fa: "دلیجان",
    en: "Delijan",
    country: "IR",
    region: "Markazi",
    approved: false,
    aliases: [],
  },
  {
    code: "FUMAN",
    fa: "فومن",
    en: "Fuman",
    country: "IR",
    region: "Gilan",
    approved: false,
    aliases: [],
  },
];

if (CITY_REGISTRY.length > MAX_REGISTRY_CITIES) {
  throw new Error(
    `CITY_REGISTRY exceeds MAX_REGISTRY_CITIES (${MAX_REGISTRY_CITIES})`
  );
}

const REGISTRY_BY_CODE = new Map<string, CityDefinition>(
  CITY_REGISTRY.map((entry) => [entry.code, entry])
);

/**
 * Duplicate-code guard evaluated at module load. A duplicate would make
 * `mergeApprovedCities` and every label lookup ambiguous, which is worse
 * than a startup failure for a registry this small.
 */
const DUPLICATE_CODES: string[] = (() => {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const entry of CITY_REGISTRY) {
    if (seen.has(entry.code)) dupes.add(entry.code);
    seen.add(entry.code);
  }
  return [...dupes];
})();

export function cityDefinition(code: string): CityDefinition | undefined {
  return REGISTRY_BY_CODE.get(code);
}

export function isRegistryCityCode(value: unknown): value is string {
  return typeof value === "string" && REGISTRY_BY_CODE.has(value);
}

export function registryCityCodes(): string[] {
  return CITY_REGISTRY.map((entry) => entry.code);
}

/** Cities approved for outreach by default, in registry order. */
export const DEFAULT_APPROVED_CITIES: string[] = CITY_REGISTRY.filter(
  (entry) => entry.approved
).map((entry) => entry.code);

/**
 * Merge registry defaults with administrator overrides into the
 * effective approved set. Pure and order-stable so it can be unit
 * tested and reused by every surface (validation, UI, reports).
 *
 *  - `enabledExtra`  force-approves registry codes (an admin pressed
 *    "approve"), and can never enable a code that is not in the registry.
 *  - `disabledCodes` force-rejects registry codes (an admin pressed
 *    "disable"); disabling wins over enabling so a kill switch is reliable.
 *
 * Unknown codes in the overrides are ignored *here*; the API layer
 * rejects them with an explicit error and never substitutes another city.
 */
export function mergeApprovedCities(
  enabledExtra: readonly string[] = [],
  disabledCodes: readonly string[] = []
): string[] {
  const disabled = new Set(disabledCodes);
  const approved = new Set<string>();
  for (const entry of CITY_REGISTRY) {
    if (entry.approved && !disabled.has(entry.code)) approved.add(entry.code);
  }
  for (const code of enabledExtra) {
    if (REGISTRY_BY_CODE.has(code) && !disabled.has(code)) approved.add(code);
  }
  return CITY_REGISTRY.map((entry) => entry.code).filter((code) => approved.has(code));
}

/**
 * Validate a comma/space separated list of registry codes.
 *
 * Returns `null` when ANY entry is unknown, the input is not a list/string, or
 * the list exceeds `max` codes — callers (settings coercion, API validation)
 * then reject the whole payload explicitly. Valid entries are upper-cased and
 * de-duplicated in the order given. An empty result means "clear the setting".
 */
export function normalizeCityCodeList(
  value: unknown,
  max: number = MAX_REGISTRY_CITIES
): string[] | null {
  const arr = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,""\s]+/)
      : null;
  if (arr === null) return null;

  const out: string[] = [];
  for (const item of arr) {
    if (typeof item !== "string") return null;
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    const code = trimmed.toUpperCase();
    if (!REGISTRY_BY_CODE.has(code)) return null;
    if (!out.includes(code)) out.push(code);
    if (out.length > max) return null;
  }
  return out;
}

export { DUPLICATE_CODES };

