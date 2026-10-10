import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  buildDedupeKey,
  buildSuppressionIdentifier,
  normalizeTelegramUsername,
  validatePublicProfileUrl,
} from "@/lib/outreach/normalize";
import {
  matchKeywords,
  resolveKeywordSet,
  type KeywordSetSource,
  type MatchableKeyword,
} from "@/lib/outreach/keywords";
import { isKeywordGroup, normalizeLanguage } from "@/lib/outreach/types";
import {
  DISCOVERY_SOURCES,
  feedSource,
  readManualSeed,
  type RawCandidate,
  type SourceIssue,
} from "@/lib/outreach/sources";
import { isSuppressed } from "@/lib/outreach/eligibility";
import { resolveCity, detectCity, detectSegment } from "@/lib/outreach/cities";
import { recordAuditEvent } from "@/lib/outreach/audit";
import { runDateFor, type OutreachSettings } from "@/lib/outreach/settings";

/** Hard ceiling on rows read from sources in one run (before dedupe). */
const SOURCE_FETCH_CAP = 1000;

/**
 * Why discovery cannot find anything right now. Stable codes: the admin UI maps
 * them to translated next-step messages.
 */
export const DISCOVERY_BLOCKERS = [
  "discovery_disabled",
  "zero_daily_limit",
  "daily_limit_reached",
  "keywords_disabled",
  "no_input_source",
  "no_valid_input",
  "source_unavailable",
  "no_candidates",
  "no_keyword_match",
  "all_duplicates",
  "no_eligible_candidates",
] as const;

export type DiscoveryBlocker = (typeof DISCOVERY_BLOCKERS)[number];

export type DiscoveryStatus = "OK" | "BLOCKED" | "FAILED" | "SKIPPED";

export type DiscoverySummary = {
  runDate: string;
  timezone: string;
  status: DiscoveryStatus;
  discovered: number;
  matched: number;
  duplicates: number;
  excluded: number;
  /** Rows read from all enabled sources before filtering. */
  inputCount: number;
  /** Source rows rejected as invalid (bad URL, no name). */
  rejectedInputs: number;
  /** Newly discovered candidates whose city could not be resolved. */
  unknownCity: number;
  /** Newly discovered candidates with no supported segment evidence. */
  unknownSegment: number;
  keywordSource: KeywordSetSource | null;
  enabledKeywords: number;
  /** Remaining daily allowance before this run started. */
  remainingBefore: number;
  blockers: DiscoveryBlocker[];
  sourceIssues: SourceIssue[];
  error?: string;
};

export type ExclusionReason =
  | "no_keyword_match"
  | "below_min_score"
  | "duplicate_candidate"
  | "existing_prospect"
  | "existing_customer"
  | "suppressed";

function dateOnlyUTC(runDate: string): Date {
  return new Date(
    Date.UTC(Number(runDate.slice(0, 4)), Number(runDate.slice(5, 7)) - 1, Number(runDate.slice(8, 10)))
  );
}

async function loadKeywordRows(): Promise<MatchableKeyword[]> {
  return prisma.discoveryKeyword.findMany({
    orderBy: [{ priority: "desc" }, { term: "asc" }],
    select: {
      term: true,
      group: true,
      language: true,
      priority: true,
      enabled: true,
    },
  });
}

export type DiscoveryPreflight = {
  runDate: string;
  discoveredOn: Date;
  discoveredToday: number;
  remaining: number;
  keywordSet: ReturnType<typeof resolveKeywordSet>;
  seed: { candidates: number; rejected: number };
  feedUsable: boolean;
  blockers: DiscoveryBlocker[];
};

/**
 * Everything that decides whether a run may start, computed without writing.
 * Shared by the scheduled job, the on-demand run and the diagnostics endpoint so
 * they can never disagree.
 */
export async function collectDiscoveryPreflight(
  settings: OutreachSettings,
  now: Date = new Date()
): Promise<DiscoveryPreflight> {
  const runDate = runDateFor(settings.timezone, now);
  const discoveredOn = dateOnlyUTC(runDate);

  const [discoveredToday, keywordRows, seed] = await Promise.all([
    prisma.discoveryCandidate.count({ where: { discoveredOn } }),
    loadKeywordRows(),
    readManualSeed(),
  ]);

  const keywordSet = resolveKeywordSet(keywordRows);
  const feedUsable = feedSource.isEnabled(settings);
  const remaining = Math.max(0, settings.dailyDiscoveryLimit - discoveredToday);

  const blockers: DiscoveryBlocker[] = [];
  if (!settings.enabled) blockers.push("discovery_disabled");
  if (settings.dailyDiscoveryLimit <= 0) {
    blockers.push("zero_daily_limit");
  } else if (remaining <= 0) {
    blockers.push("daily_limit_reached");
  }
  if (keywordSet.source === "configured" && keywordSet.keywords.length === 0) {
    blockers.push("keywords_disabled");
  }
  if (seed.candidates.length === 0 && !feedUsable) {
    blockers.push(seed.rejected > 0 ? "no_valid_input" : "no_input_source");
  }

  return {
    runDate,
    discoveredOn,
    discoveredToday,
    remaining,
    keywordSet,
    seed: { candidates: seed.candidates.length, rejected: seed.rejected },
    feedUsable,
    blockers,
  };
}

async function isExistingCustomer(candidate: RawCandidate): Promise<boolean> {
  const username = normalizeTelegramUsername(candidate.telegramUsername);
  if (username) {
    const user = await prisma.user.findFirst({
      where: { telegramUsername: { equals: username, mode: "insensitive" } },
      select: { id: true },
    });
    if (user) return true;
  }

  if (candidate.publicUrl) {
    const host = safeHost(candidate.publicUrl);
    if (host) {
      const business = await prisma.business.findFirst({
        where: {
          OR: [
            { website: { contains: host, mode: "insensitive" } },
            { instagram: { contains: host, mode: "insensitive" } },
          ],
        },
        select: { id: true },
      });
      if (business) return true;
    }
  }

  return false;
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function emptySummary(
  runDate: string,
  timezone: string,
  status: DiscoveryStatus,
  extra: Partial<DiscoverySummary> = {}
): DiscoverySummary {
  return {
    runDate,
    timezone,
    status,
    discovered: 0,
    matched: 0,
    duplicates: 0,
    excluded: 0,
    inputCount: 0,
    rejectedInputs: 0,
    unknownCity: 0,
    unknownSegment: 0,
    keywordSource: null,
    enabledKeywords: 0,
    remainingBefore: 0,
    blockers: [],
    sourceIssues: [],
    ...extra,
  };
}

class DiscoverySourceError extends Error {
  constructor(public readonly issues: string) {
    super("DiscoverySourceError");
    this.name = "DiscoverySourceError";
  }
}

/**
 * Run one discovery cycle.
 *
 *  - `scheduled` (cron): idempotent per run date. A date that already finished
 *    (OK or FAILED) is skipped.
 *  - `manual` (admin "Run discovery now"): may run again on the same date. The
 *    daily allowance still applies because it counts every candidate already
 *    discovered for that date, and duplicates are never re-created.
 *
 * Blocked runs return `BLOCKED` with named blockers and never import anything.
 * A run whose only input failed returns `FAILED`, never a silent success.
 */
export async function runDailyDiscovery(options: {
  settings: OutreachSettings;
  now?: Date;
  mode?: "scheduled" | "manual";
}): Promise<DiscoverySummary> {
  const now = options.now ?? new Date();
  const settings = options.settings;
  const mode = options.mode ?? "scheduled";

  const preflight = await collectDiscoveryPreflight(settings, now);
  const { runDate } = preflight;

  const existing = await prisma.discoveryRun.findUnique({
    where: { runDate },
    select: { id: true, status: true },
  });

  if (mode === "scheduled" && existing && (existing.status === "OK" || existing.status === "FAILED")) {
    return emptySummary(runDate, settings.timezone, "SKIPPED");
  }

  const base = {
    remainingBefore: preflight.remaining,
    keywordSource: preflight.keywordSet.source,
    enabledKeywords: preflight.keywordSet.keywords.length,
  };

  if (preflight.blockers.length > 0) {
    // Record the blocked attempt, but never overwrite a finished run's numbers.
    const blockedError = preflight.blockers.join(",").slice(0, 900);
    if (!existing) {
      await prisma.discoveryRun.create({
        data: {
          runDate,
          timezone: settings.timezone,
          status: "BLOCKED",
          startedAt: now,
          finishedAt: now,
          error: blockedError,
        },
      });
    } else if (existing.status === "BLOCKED") {
      await prisma.discoveryRun.update({
        where: { id: existing.id },
        data: { error: blockedError, finishedAt: now },
      });
    }
    return emptySummary(runDate, settings.timezone, "BLOCKED", {
      ...base,
      blockers: preflight.blockers,
    });
  }

  const resumingFinishedRun = mode === "manual" && existing !== null;
  const run = await prisma.discoveryRun.upsert({
    where: { runDate },
    update: { status: "RUNNING", startedAt: now, error: null },
    create: { runDate, timezone: settings.timezone, status: "RUNNING", startedAt: now },
  });

  try {
    const raw: RawCandidate[] = [];
    const sourceIssues: SourceIssue[] = [];
    let rejectedInputs = 0;

    for (const source of DISCOVERY_SOURCES) {
      if (!source.isEnabled(settings)) continue;
      const result = await source.fetch(SOURCE_FETCH_CAP, settings);
      raw.push(...result.candidates);
      rejectedInputs += result.rejected;
      if (result.issue) sourceIssues.push(result.issue);
    }

    // A feed that failed while nothing else produced input is a pipeline failure.
    if (raw.length === 0 && sourceIssues.length > 0) {
      throw new DiscoverySourceError(sourceIssues.join(","));
    }

    const keywords = preflight.keywordSet.keywords;
    const remaining = preflight.remaining;

    let discovered = 0;
    let duplicates = 0;
    let excluded = 0;
    let noKeywordMatch = 0;
    let unknownCity = 0;
    let unknownSegment = 0;
    const seen = new Set<string>();

    for (const candidate of raw) {
      if (discovered >= remaining) break;

      const match = matchKeywords(
        {
          name: candidate.publicName,
          username: candidate.telegramUsername,
          description: candidate.description,
        },
        keywords
      );

      if (!match.group || match.matched.length === 0) {
        excluded += 1;
        noKeywordMatch += 1;
        continue;
      }

      if (match.score < settings.minScore) {
        excluded += 1;
        continue;
      }

      // Normalize city to a registry code. A listing's own city field wins;
      // otherwise look for an unambiguous city in the public text. Nothing is
      // guessed: unknown or ambiguous stays null and is reported.
      const text = [candidate.publicName, candidate.description ?? ""].join(" ");
      const cityResolution = candidate.city ? resolveCity(candidate.city) : detectCity(text);
      const city = cityResolution.city;
      if (!city) unknownCity += 1;
      if (!detectSegment(text).segment) unknownSegment += 1;

      const dedupeKey = buildDedupeKey({
        telegramUsername: candidate.telegramUsername,
        publicUrl: candidate.publicUrl,
        publicName: candidate.publicName,
        city: city ?? candidate.city ?? null,
      });

      if (seen.has(dedupeKey)) {
        duplicates += 1;
        continue;
      }
      seen.add(dedupeKey);

      const [existingCandidate, existingProspect] = await Promise.all([
        prisma.discoveryCandidate.findUnique({
          where: { dedupeKey },
          select: { id: true },
        }),
        prisma.outreachProspect.findUnique({
          where: { dedupeKey },
          select: { id: true },
        }),
      ]);

      if (existingCandidate || existingProspect) {
        duplicates += 1;
        continue;
      }

      if (
        await isSuppressed([
          buildSuppressionIdentifier({
            telegramUsername: candidate.telegramUsername,
            publicUrl: candidate.publicUrl,
          }),
        ])
      ) {
        excluded += 1;
        continue;
      }

      if (await isExistingCustomer(candidate)) {
        excluded += 1;
        continue;
      }

      const group = isKeywordGroup(match.group) ? match.group : "OTHER";

      try {
        await prisma.discoveryCandidate.create({
          data: {
            publicName: candidate.publicName,
            publicUrl: candidate.publicUrl ?? null,
            description: candidate.description ?? null,
            source: candidate.source,
            sourceRef: candidate.sourceRef ?? null,
            group,
            matchedTerms: match.matchedTerms.join(", ").slice(0, 500),
            score: match.score,
            city,
            language: normalizeLanguage(candidate.language),
            dedupeKey,
            status: "NEW",
            discoveredOn: preflight.discoveredOn,
          },
        });
        discovered += 1;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          duplicates += 1;
          continue;
        }
        throw error;
      }
    }

    const blockers: DiscoveryBlocker[] = [];
    if (discovered === 0) {
      if (raw.length === 0) {
        blockers.push("no_candidates");
      } else if (duplicates > 0 && noKeywordMatch === 0) {
        blockers.push("all_duplicates");
      } else if (noKeywordMatch > 0 && noKeywordMatch === raw.length) {
        blockers.push("no_keyword_match");
      } else {
        blockers.push("no_eligible_candidates");
      }
    }

    const counters = {
      discovered,
      matched: discovered,
      duplicates,
      excluded,
    };

    await prisma.discoveryRun.update({
      where: { id: run.id },
      data: {
        status: "OK",
        error: blockers.length > 0 ? blockers.join(",").slice(0, 900) : null,
        finishedAt: new Date(),
        ...(resumingFinishedRun
          ? {
              discovered: { increment: counters.discovered },
              matched: { increment: counters.matched },
              duplicates: { increment: counters.duplicates },
              excluded: { increment: counters.excluded },
            }
          : counters),
      },
    });

    if (mode === "manual") {
      await recordAuditEvent({
        scope: "discovery",
        entityId: run.id,
        action: "discovery.manual_run",
        detail: `discovered=${discovered} duplicates=${duplicates} excluded=${excluded} inputs=${raw.length} blockers=${blockers.join("|") || "none"}`,
      });
    }

    return emptySummary(runDate, settings.timezone, "OK", {
      ...base,
      discovered,
      matched: discovered,
      duplicates,
      excluded,
      inputCount: raw.length,
      rejectedInputs,
      unknownCity,
      unknownSegment,
      blockers,
      sourceIssues,
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "UnknownError";
    const issueText = error instanceof DiscoverySourceError ? error.issues : null;
    console.error("runDailyDiscovery failed:", name);

    await prisma.discoveryRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        error: (issueText ?? name).slice(0, 900),
        finishedAt: new Date(),
      },
    });

    return emptySummary(runDate, settings.timezone, "FAILED", {
      ...base,
      sourceIssues: (issueText ? issueText.split(",") : []) as SourceIssue[],
      error: issueText ?? name,
    });
  }
}

export type PromotionOutcome =
  | "promoted"
  | "already_linked"
  | "duplicate_prospect"
  | "rejected_candidate"
  | "invalid_url"
  | "not_found";

export type PromotionResult = {
  candidateId: string;
  outcome: PromotionOutcome;
  prospectId: string | null;
  city: string | null;
  segment: string | null;
  unknownCity: boolean;
  unknownSegment: boolean;
};

/**
 * Convert shortlisted candidates into prospects so outreach can start.
 *
 * Promoted prospects are ALWAYS created as DISCOVERED (unverified). Verification
 * is a separate, explicit administrator action and is never implied here. City
 * is normalized to a registry code and segment is inferred only from the
 * candidate's own public text; anything unresolved is reported as unknown and
 * stays out of campaign targeting until a human assigns it.
 */
export async function promoteCandidates(options: {
  candidateIds: string[];
  campaignId?: string | null;
  actorUserId?: string | null;
}): Promise<{
  promoted: number;
  skipped: number;
  unknownCity: number;
  unknownSegment: number;
  results: PromotionResult[];
}> {
  const ids = [...new Set(options.candidateIds)].slice(0, 200);

  const candidates = await prisma.discoveryCandidate.findMany({
    where: { id: { in: ids } },
  });
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));

  let promoted = 0;
  let skipped = 0;
  let unknownCity = 0;
  let unknownSegment = 0;
  const results: PromotionResult[] = [];

  for (const id of ids) {
    const candidate = byId.get(id);
    if (!candidate) {
      skipped += 1;
      results.push(emptyResult(id, "not_found"));
      continue;
    }

    const city = resolveCity(candidate.city).city;
    const segment = detectSegment(
      [candidate.publicName, candidate.description ?? ""].join(" ")
    ).segment;
    const base = {
      candidateId: id,
      city,
      segment,
      unknownCity: city === null,
      unknownSegment: segment === null,
    };

    if (candidate.status === "REJECTED") {
      skipped += 1;
      results.push({ ...base, outcome: "rejected_candidate", prospectId: null });
      continue;
    }

    if (candidate.status === "CONVERTED") {
      skipped += 1;
      results.push({ ...base, outcome: "already_linked", prospectId: candidate.prospectId ?? null });
      continue;
    }

    const publicUrl = candidate.publicUrl ? validatePublicProfileUrl(candidate.publicUrl) : null;
    if (publicUrl && !publicUrl.ok) {
      skipped += 1;
      results.push({ ...base, outcome: "invalid_url", prospectId: null });
      continue;
    }

    const existing = await prisma.outreachProspect.findUnique({
      where: { dedupeKey: candidate.dedupeKey },
      select: { id: true },
    });

    if (existing) {
      skipped += 1;
      await prisma.discoveryCandidate.update({
        where: { id: candidate.id },
        data: { status: "CONVERTED", prospectId: existing.id },
      });
      results.push({ ...base, outcome: "duplicate_prospect", prospectId: existing.id });
      continue;
    }

    const unresolved = [
      city === null ? "City not resolved: assign a registry city before targeting." : null,
      segment === null ? "Segment not inferred: assign a segment before targeting." : null,
    ].filter((line): line is string => line !== null);

    const prospect = await prisma.outreachProspect.create({
      data: {
        publicName: candidate.publicName,
        category: candidate.group,
        city,
        segment,
        language: candidate.language,
        publicUrl: publicUrl && publicUrl.ok ? publicUrl.url : null,
        sourceUrl: publicUrl && publicUrl.ok ? publicUrl.url : null,
        sourceName: candidate.source,
        dedupeKey: candidate.dedupeKey,
        status: "NEW",
        verificationStatus: "DISCOVERED",
        campaignId: options.campaignId ?? null,
        notes: [
          `Discovered ${candidate.discoveredOn.toISOString().slice(0, 10)} via ${candidate.source}. Matched: ${candidate.matchedTerms}. Score: ${candidate.score}.`,
          ...unresolved,
        ].join(" "),
      },
    });

    await prisma.discoveryCandidate.update({
      where: { id: candidate.id },
      data: { status: "CONVERTED", prospectId: prospect.id },
    });

    promoted += 1;
    if (base.unknownCity) unknownCity += 1;
    if (base.unknownSegment) unknownSegment += 1;
    results.push({ ...base, outcome: "promoted", prospectId: prospect.id });
  }

  if (promoted > 0 || skipped > 0) {
    await recordAuditEvent({
      scope: "prospect",
      action: "prospects.promoted",
      actorUserId: options.actorUserId ?? null,
      detail: `promoted=${promoted} skipped=${skipped} unknownCity=${unknownCity} unknownSegment=${unknownSegment}`,
    });
  }

  return { promoted, skipped, unknownCity, unknownSegment, results };
}

function emptyResult(candidateId: string, outcome: PromotionOutcome): PromotionResult {
  return {
    candidateId,
    outcome,
    prospectId: null,
    city: null,
    segment: null,
    unknownCity: true,
    unknownSegment: true,
  };
}
