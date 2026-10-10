import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildDedupeKey, normalizeTelegramUsername } from "@/lib/outreach/normalize";
import { matchKeywords, type MatchableKeyword } from "@/lib/outreach/keywords";
import { isKeywordGroup, normalizeLanguage } from "@/lib/outreach/types";
import {
  DISCOVERY_SOURCES,
  type RawCandidate,
} from "@/lib/outreach/sources";
import { isSuppressed } from "@/lib/outreach/eligibility";
import {
  runDateFor,
  type OutreachSettings,
} from "@/lib/outreach/settings";

export type DiscoverySummary = {
  runDate: string;
  timezone: string;
  status: "OK" | "FAILED" | "SKIPPED";
  discovered: number;
  matched: number;
  duplicates: number;
  excluded: number;
  error?: string;
};

export type ExclusionReason =
  | "no_keyword_match"
  | "below_min_score"
  | "duplicate_candidate"
  | "existing_prospect"
  | "existing_customer"
  | "suppressed";

async function loadKeywords(): Promise<MatchableKeyword[]> {
  return prisma.discoveryKeyword.findMany({
    where: { enabled: true },
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

async function isExistingCustomer(
  candidate: RawCandidate
): Promise<boolean> {
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

/**
 * Run one daily discovery cycle.
 *
 * Idempotent: `discovery_runs.runDate` is unique, so a retried or double
 * triggered execution exits without importing anything twice.
 */
export async function runDailyDiscovery(options: {
  settings: OutreachSettings;
  now?: Date;
}): Promise<DiscoverySummary> {
  const now = options.now ?? new Date();
  const settings = options.settings;
  const runDate = runDateFor(settings.timezone, now);

  const existing = await prisma.discoveryRun.findUnique({
    where: { runDate },
    select: { id: true, status: true },
  });

  if (existing && (existing.status === "OK" || existing.status === "FAILED")) {
    return {
      runDate,
      timezone: settings.timezone,
      status: "SKIPPED",
      discovered: 0,
      matched: 0,
      duplicates: 0,
      excluded: 0,
    };
  }

  const run = await prisma.discoveryRun.upsert({
    where: { runDate },
    update: { status: "RUNNING", startedAt: now, error: null },
    create: { runDate, timezone: settings.timezone, status: "RUNNING", startedAt: now },
  });

  try {
    const keywords = await loadKeywords();
    const limit = settings.dailyDiscoveryLimit;

    const raw: RawCandidate[] = [];
    for (const source of DISCOVERY_SOURCES) {
      if (raw.length >= limit) break;
      if (!source.isEnabled(settings)) continue;
      const batch = await source.fetch(limit - raw.length, settings);
      raw.push(...batch);
    }

    let discovered = 0;
    let matched = 0;
    let duplicates = 0;
    let excluded = 0;
    const seen = new Set<string>();

    for (const candidate of raw) {
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
        continue;
      }

      if (match.score < settings.minScore) {
        excluded += 1;
        continue;
      }

      const dedupeKey = buildDedupeKey({
        telegramUsername: candidate.telegramUsername,
        publicUrl: candidate.publicUrl,
        publicName: candidate.publicName,
        city: candidate.city,
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
          normalizeTelegramUsername(candidate.telegramUsername)
            ? `tg:${normalizeTelegramUsername(candidate.telegramUsername)}`
            : null,
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
      const discoveredOn = new Date(
        Date.UTC(
          Number(runDate.slice(0, 4)),
          Number(runDate.slice(5, 7)) - 1,
          Number(runDate.slice(8, 10))
        )
      );

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
            city: candidate.city ?? null,
            language: normalizeLanguage(candidate.language),
            dedupeKey,
            status: "NEW",
            discoveredOn,
          },
        });
        discovered += 1;
        matched += 1;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          duplicates += 1;
          continue;
        }
        throw error;
      }
    }

    await prisma.discoveryRun.update({
      where: { id: run.id },
      data: {
        status: "OK",
        discovered,
        matched,
        duplicates,
        excluded,
        finishedAt: new Date(),
      },
    });

    return {
      runDate,
      timezone: settings.timezone,
      status: "OK",
      discovered,
      matched,
      duplicates,
      excluded,
    };
  } catch (error) {
    console.error(
      "runDailyDiscovery failed:",
      error instanceof Error ? error.name : "UnknownError"
    );

    await prisma.discoveryRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.name : "UnknownError",
        finishedAt: new Date(),
      },
    });

    return {
      runDate,
      timezone: settings.timezone,
      status: "FAILED",
      discovered: 0,
      matched: 0,
      duplicates: 0,
      excluded: 0,
      error: error instanceof Error ? error.name : "UnknownError",
    };
  }
}

/**
 * Convert shortlisted candidates into prospects so outreach can start.
 * Dedupe is enforced by the unique `dedupeKey` on both tables.
 */
export async function promoteCandidates(options: {
  candidateIds: string[];
  campaignId?: string | null;
}): Promise<{ promoted: number; skipped: number }> {
  const ids = options.candidateIds.slice(0, 200);

  const candidates = await prisma.discoveryCandidate.findMany({
    where: { id: { in: ids } },
  });

  let promoted = 0;
  let skipped = 0;

  for (const candidate of candidates) {
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
      continue;
    }

    const prospect = await prisma.outreachProspect.create({
      data: {
        publicName: candidate.publicName,
        category: candidate.group,
        city: candidate.city,
        language: candidate.language,
        publicUrl: candidate.publicUrl,
        sourceUrl: candidate.publicUrl,
        sourceName: candidate.source,
        dedupeKey: candidate.dedupeKey,
        status: "NEW",
        campaignId: options.campaignId ?? null,
        notes: `Discovered ${candidate.discoveredOn.toISOString().slice(0, 10)} via ${
          candidate.source
        }. Matched: ${candidate.matchedTerms}. Score: ${candidate.score}.`,
      },
    });

    await prisma.discoveryCandidate.update({
      where: { id: candidate.id },
      data: { status: "CONVERTED", prospectId: prospect.id },
    });

    promoted += 1;
  }

  return { promoted, skipped };
}
