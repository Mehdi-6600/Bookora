import {
  categoryForGroup,
  isKeywordGroup,
  type KeywordGroup,
  type ProspectCategory,
} from "@/lib/outreach/types";
import { foldText } from "@/lib/outreach/normalize";

export type MatchableKeyword = {
  id?: string;
  term: string;
  group: string;
  language: string;
  priority: number;
  enabled?: boolean;
};

export type KeywordMatch = {
  term: string;
  group: string;
  language: string;
  priority: number;
};

export type MatchResult = {
  matched: KeywordMatch[];
  /** 0-100 relevance score. */
  score: number;
  /** Best-matching group, or `null` when nothing matched. */
  group: KeywordGroup | null;
  category: ProspectCategory | null;
  matchedTerms: string[];
};

/**
 * How strongly each group suits appointment booking today.
 * Barbers and beauty salons take short, frequent, repeat bookings which is the
 * best fit for Bookora's current feature set; medical practices book too but
 * usually need intake forms and longer lead times.
 */
const GROUP_FIT_BONUS: Record<string, number> = {
  BARBER: 15,
  BEAUTY: 15,
  MEDICAL: 5,
};

const MAX_SCORE = 100;

/**
 * Match a candidate's public name / username / description against the
 * configured keyword list.
 *
 * The comparison is performed on folded text (see `foldText`) so Persian and
 * Arabic spelling variants, accents, punctuation and whitespace all compare
 * equal.
 */
export function matchKeywords(
  input: { name?: string | null; username?: string | null; description?: string | null },
  keywords: MatchableKeyword[]
): MatchResult {
  const haystack = foldText(
    [input.name, input.username, input.description]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join(" ")
  );

  if (haystack.length === 0) {
    return { matched: [], score: 0, group: null, category: null, matchedTerms: [] };
  }

  const matched: KeywordMatch[] = [];
  const seenTerms = new Set<string>();

  for (const keyword of keywords) {
    if (keyword.enabled === false) continue;

    const term = foldText(keyword.term);
    if (term.length === 0) continue;

    if (!haystack.includes(term)) continue;

    const dedupeToken = `${keyword.group}:${term}`;
    if (seenTerms.has(dedupeToken)) continue;
    seenTerms.add(dedupeToken);

    matched.push({
      term: keyword.term,
      group: keyword.group,
      language: keyword.language,
      priority: clampPriority(keyword.priority),
    });
  }

  if (matched.length === 0) {
    return { matched: [], score: 0, group: null, category: null, matchedTerms: [] };
  }

  const group = pickBestGroup(matched);

  let score = 0;
  for (const match of matched) {
    score += 10 * match.priority;
  }

  if (group) score += GROUP_FIT_BONUS[group] ?? 0;

  // A description that is present as well as a matching name is a small signal
  // that the public page really describes this trade.
  if (input.description && foldText(input.description).length > 0) score += 5;

  return {
    matched,
    score: Math.min(MAX_SCORE, Math.round(score)),
    group,
    category: group ? categoryForGroup(group) : null,
    matchedTerms: matched.map((match) => match.term),
  };
}

/** Choose the group with the highest summed priority; ties break on fit bonus. */
export function pickBestGroup(matches: KeywordMatch[]): KeywordGroup | null {
  const totals = new Map<string, number>();

  for (const match of matches) {
    const current = totals.get(match.group) ?? 0;
    totals.set(match.group, current + clampPriority(match.priority));
  }

  let best: string | null = null;
  let bestTotal = -1;
  let bestBonus = -1;

  for (const [group, total] of totals) {
    const bonus = GROUP_FIT_BONUS[group] ?? 0;
    if (total > bestTotal || (total === bestTotal && bonus > bestBonus)) {
      best = group;
      bestTotal = total;
      bestBonus = bonus;
    }
  }

  return best && isKeywordGroup(best) ? best : null;
}

function clampPriority(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(5, Math.max(1, Math.round(value)));
}

/** The seed keyword set for a fresh install. */
export const DEFAULT_KEYWORDS: Array<{
  term: string;
  group: KeywordGroup;
  language: string;
  priority: number;
}> = [
  // Barbers
  { term: "barber", group: "BARBER", language: "en", priority: 5 },
  { term: "barbershop", group: "BARBER", language: "en", priority: 5 },
  { term: "hairdresser", group: "BARBER", language: "en", priority: 4 },
  { term: "hairstylist", group: "BARBER", language: "en", priority: 4 },
  { term: "men's salon", group: "BARBER", language: "en", priority: 4 },
  { term: "mens salon", group: "BARBER", language: "en", priority: 4 },
  { term: "grooming", group: "BARBER", language: "en", priority: 2 },
  { term: "آرایشگر مردانه", group: "BARBER", language: "fa", priority: 5 },
  { term: "پیرایشگاه", group: "BARBER", language: "fa", priority: 5 },
  { term: "آرایشگاه مردانه", group: "BARBER", language: "fa", priority: 5 },
  { term: "سلمانی", group: "BARBER", language: "fa", priority: 4 },

  // Beauty
  { term: "beauty salon", group: "BEAUTY", language: "en", priority: 5 },
  { term: "makeup artist", group: "BEAUTY", language: "en", priority: 4 },
  { term: "nail technician", group: "BEAUTY", language: "en", priority: 4 },
  { term: "nail salon", group: "BEAUTY", language: "en", priority: 4 },
  { term: "lash artist", group: "BEAUTY", language: "en", priority: 4 },
  { term: "salon", group: "BEAUTY", language: "en", priority: 2 },
  { term: "سالن زیبایی", group: "BEAUTY", language: "fa", priority: 5 },
  { term: "ناخن کار", group: "BEAUTY", language: "fa", priority: 4 },
  { term: "ناخن‌کار", group: "BEAUTY", language: "fa", priority: 4 },
  { term: "میکاپ آرتیست", group: "BEAUTY", language: "fa", priority: 4 },
  { term: "آرایشگاه زنانه", group: "BEAUTY", language: "fa", priority: 5 },

  // Medical
  { term: "doctor", group: "MEDICAL", language: "en", priority: 3 },
  { term: "dentist", group: "MEDICAL", language: "en", priority: 3 },
  { term: "dermatologist", group: "MEDICAL", language: "en", priority: 4 },
  { term: "physiotherapist", group: "MEDICAL", language: "en", priority: 4 },
  { term: "clinic", group: "MEDICAL", language: "en", priority: 3 },
  { term: "پزشک", group: "MEDICAL", language: "fa", priority: 3 },
  { term: "دندانپزشک", group: "MEDICAL", language: "fa", priority: 3 },
  { term: "متخصص پوست", group: "MEDICAL", language: "fa", priority: 4 },
  { term: "فیزیوتراپی", group: "MEDICAL", language: "fa", priority: 4 },
  { term: "کلینیک", group: "MEDICAL", language: "fa", priority: 3 },
];
