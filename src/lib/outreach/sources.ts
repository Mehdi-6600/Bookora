import { prisma } from "@/lib/prisma";
import type { OutreachSettings } from "@/lib/outreach/settings";
import {
  normalizeTelegramUsername,
  validatePublicProfileUrl,
  publicUrlReasonText,
} from "@/lib/outreach/normalize";

/**
 * Discovery sources.
 *
 * IMPORTANT — this module deliberately does NOT search Telegram users.
 * Telegram provides no API for discovering users or businesses by keyword, and
 * scraping would violate its terms. Only the two sources below are supported:
 *
 *  1. `manual`  - public business pages that an administrator pastes into the
 *                 dashboard. The administrator is the one who saw and verified
 *                 the page, so this is always authorized.
 *  2. `feed`    - an HTTPS JSON endpoint that the administrator configures and
 *                 has permission to use (their own curated feed, a partner
 *                 API, or a licensed data provider). Disabled by default.
 *
 * Both return only PUBLIC business information: public name, public URL,
 * public description and city. Nothing is fabricated: a source that cannot
 * answer returns an explicit `issue` instead of invented rows.
 */

const MANUAL_SEED_KEY = "outreach.manual_seed";

export type RawCandidate = {
  publicName: string;
  publicUrl?: string | null;
  telegramUsername?: string | null;
  description?: string | null;
  city?: string | null;
  language?: string | null;
  source: string;
  sourceRef?: string | null;
};

export type SourceResult = {
  candidates: RawCandidate[];
  /** Why this source produced nothing, when it did not run cleanly. */
  issue: SourceIssue | null;
  /** Rows the source returned that were rejected (bad URL, no name, ...). */
  rejected: number;
};

export type SourceIssue =
  | "feed_http_error"
  | "feed_timeout"
  | "feed_invalid_payload"
  | "feed_unavailable";

export type DiscoverySource = {
  name: string;
  isEnabled(settings: OutreachSettings): boolean;
  fetch(limit: number, settings: OutreachSettings): Promise<SourceResult>;
};

const MAX_STRING = 300;

function clean(value: unknown, max = MAX_STRING): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : null;
}

export type SeedRowProblem = { index: number; field: "publicName" | "publicUrl" | "telegramUsername"; reason: string };

/**
 * Convert raw rows (from the stored seed or from a feed) into candidates.
 * Rows without a name are skipped. A row with a URL that fails validation is
 * rejected as a whole, so an invalid link never reaches a prospect.
 */
export function parseSourceRows(
  list: unknown[],
  source: string,
  refPrefix: string
): { candidates: RawCandidate[]; rejected: number } {
  const candidates: RawCandidate[] = [];
  let rejected = 0;

  list.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      rejected += 1;
      return;
    }
    const row = entry as Record<string, unknown>;

    const publicName = clean(row.publicName ?? row.name);
    if (!publicName) {
      rejected += 1;
      return;
    }

    const rawUrl = clean(row.publicUrl ?? row.url, 500);
    let publicUrl: string | null = null;
    if (rawUrl) {
      const check = validatePublicProfileUrl(rawUrl);
      if (!check.ok) {
        rejected += 1;
        return;
      }
      publicUrl = check.url;
    }

    candidates.push({
      publicName,
      publicUrl,
      telegramUsername: normalizeTelegramUsername(clean(row.telegramUsername ?? row.username, 64)),
      description: clean(row.description, 800),
      city: clean(row.city, 80),
      language: clean(row.language, 8),
      source,
      sourceRef: clean(row.sourceRef ?? row.id, 200) ?? `${refPrefix}:${index}`,
    });
  });

  return { candidates, rejected };
}

function listFromPayload(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as { items?: unknown }).items)
  ) {
    return (parsed as { items: unknown[] }).items;
  }
  return null;
}

/**
 * Strict validation of an administrator's seed submission. Unlike the tolerant
 * reader below, every problem is reported so nothing is dropped silently.
 */
export function validateSeedItems(items: unknown[]): {
  items: SeedEntry[];
  problems: SeedRowProblem[];
} {
  const out: SeedEntry[] = [];
  const problems: SeedRowProblem[] = [];

  items.slice(0, 1000).forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      problems.push({ index, field: "publicName", reason: "Each entry must be an object." });
      return;
    }
    const row = entry as Record<string, unknown>;
    const publicName = clean(row.publicName, 200);
    if (!publicName) {
      problems.push({ index, field: "publicName", reason: "Business name is required." });
      return;
    }

    let publicUrl: string | null = null;
    const rawUrl = clean(row.publicUrl, 500);
    if (rawUrl) {
      const check = validatePublicProfileUrl(rawUrl);
      if (!check.ok) {
        problems.push({ index, field: "publicUrl", reason: publicUrlReasonText(check.reason) });
        return;
      }
      publicUrl = check.url;
    }

    let telegramUsername: string | null = null;
    const rawUsername = clean(row.telegramUsername, 64);
    if (rawUsername) {
      telegramUsername = normalizeTelegramUsername(rawUsername);
      if (!telegramUsername) {
        problems.push({
          index,
          field: "telegramUsername",
          reason: "Telegram username must be 4-32 letters, digits or underscores.",
        });
        return;
      }
    }

    out.push({
      publicName,
      publicUrl,
      telegramUsername,
      description: clean(row.description, 800),
      city: clean(row.city, 80),
      language: clean(row.language, 8),
      sourceRef: null,
    });
  });

  return { items: out, problems };
}

export type SeedEntry = {
  publicName: string;
  publicUrl: string | null;
  telegramUsername: string | null;
  description: string | null;
  city: string | null;
  language: string | null;
  sourceRef: string | null;
};

async function loadStoredSeed(): Promise<unknown[] | null> {
  const row = await prisma.adminSetting.findUnique({
    where: { key: MANUAL_SEED_KEY },
    select: { value: true },
  });
  if (!row?.value) return [];
  try {
    return listFromPayload(JSON.parse(row.value)) ?? [];
  } catch {
    return [];
  }
}

/** Read the stored manual seed as candidates. Invalid stored rows are counted, not used. */
export async function readManualSeed(): Promise<{ candidates: RawCandidate[]; rejected: number }> {
  const rows = await loadStoredSeed();
  return parseSourceRows(rows ?? [], "manual", "seed");
}

export const manualSource: DiscoverySource = {
  name: "manual",
  isEnabled() {
    return true;
  },
  async fetch(limit) {
    const { candidates, rejected } = await readManualSeed();
    return {
      candidates: candidates.slice(0, Math.max(0, limit)),
      issue: null,
      rejected,
    };
  },
};

export const feedSource: DiscoverySource = {
  name: "feed",
  isEnabled(settings) {
    return settings.feedEnabled && settings.feedUrl.length > 0;
  },
  async fetch(limit, settings) {
    if (!settings.feedUrl) return { candidates: [], issue: "feed_unavailable", rejected: 0 };

    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      response = await fetch(settings.feedUrl, {
        signal: controller.signal,
        headers: { accept: "application/json" },
        cache: "no-store",
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      return { candidates: [], issue: aborted ? "feed_timeout" : "feed_unavailable", rejected: 0 };
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) return { candidates: [], issue: "feed_http_error", rejected: 0 };

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { candidates: [], issue: "feed_invalid_payload", rejected: 0 };
    }

    const list = listFromPayload(payload);
    if (!list) return { candidates: [], issue: "feed_invalid_payload", rejected: 0 };

    const host = new URL(settings.feedUrl).hostname;
    const parsed = parseSourceRows(list, `feed:${host}`, "feed");
    return {
      candidates: parsed.candidates.slice(0, Math.max(0, limit)),
      issue: null,
      rejected: parsed.rejected,
    };
  },
};

export const DISCOVERY_SOURCES: DiscoverySource[] = [manualSource, feedSource];

/** Stored seed entries in the shape the admin editor reads back. */
export async function readManualSeedEntries(): Promise<SeedEntry[]> {
  const rows = await loadStoredSeed();
  const { items } = validateSeedItems(rows ?? []);
  return items;
}

export function serializeManualSeed(entries: SeedEntry[]): string {
  return JSON.stringify(
    entries.slice(0, 1000).map((entry) => ({
      publicName: entry.publicName,
      publicUrl: entry.publicUrl ?? null,
      telegramUsername: entry.telegramUsername ?? null,
      description: entry.description ?? null,
      city: entry.city ?? null,
      language: entry.language ?? null,
      sourceRef: entry.sourceRef ?? null,
    }))
  );
}

export const MANUAL_SEED_SETTING_KEY = MANUAL_SEED_KEY;
