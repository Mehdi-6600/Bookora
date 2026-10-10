import { prisma } from "@/lib/prisma";
import type { OutreachSettings } from "@/lib/outreach/settings";

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
 * public description and city.
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

export type DiscoverySource = {
  name: string;
  isEnabled(settings: OutreachSettings): boolean;
  fetch(limit: number, settings: OutreachSettings): Promise<RawCandidate[]>;
};

const MAX_STRING = 300;

function clean(value: unknown, max = MAX_STRING): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : null;
}

function parseSeed(raw: string | undefined): RawCandidate[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const list = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { items?: unknown }).items)
    ? (parsed as { items: unknown[] }).items
    : [];

  const out: RawCandidate[] = [];

  list.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null) return;
    const row = entry as Record<string, unknown>;

    const publicName = clean(row.publicName ?? row.name);
    if (!publicName) return;

    out.push({
      publicName,
      publicUrl: clean(row.publicUrl ?? row.url, 500),
      telegramUsername: clean(row.telegramUsername ?? row.username, 64),
      description: clean(row.description, 800),
      city: clean(row.city, 80),
      language: clean(row.language, 8),
      source: "manual",
      sourceRef: clean(row.sourceRef, 200) ?? `seed:${index}`,
    });
  });

  return out;
}

export const manualSource: DiscoverySource = {
  name: "manual",
  isEnabled() {
    return true;
  },
  async fetch(limit) {
    const row = await prisma.adminSetting.findUnique({
      where: { key: MANUAL_SEED_KEY },
      select: { value: true },
    });

    return parseSeed(row?.value).slice(0, Math.max(0, limit));
  },
};

export const feedSource: DiscoverySource = {
  name: "feed",
  isEnabled(settings) {
    return settings.feedEnabled && settings.feedUrl.length > 0;
  },
  async fetch(limit, settings) {
    if (!settings.feedUrl) return [];

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(settings.feedUrl, {
        signal: controller.signal,
        headers: { accept: "application/json" },
        cache: "no-store",
      });

      clearTimeout(timeout);

      if (!response.ok) return [];

      const payload = (await response.json()) as unknown;
      const list = Array.isArray(payload)
        ? payload
        : typeof payload === "object" && payload !== null && Array.isArray((payload as { items?: unknown }).items)
        ? (payload as { items: unknown[] }).items
        : [];

      const out: RawCandidate[] = [];

      list.forEach((entry, index) => {
        if (out.length >= limit) return;
        if (typeof entry !== "object" || entry === null) return;
        const row = entry as Record<string, unknown>;

        const publicName = clean(row.publicName ?? row.name);
        if (!publicName) return;

        out.push({
          publicName,
          publicUrl: clean(row.publicUrl ?? row.url, 500),
          telegramUsername: clean(row.telegramUsername ?? row.username, 64),
          description: clean(row.description, 800),
          city: clean(row.city, 80),
          language: clean(row.language, 8),
          source: `feed:${new URL(settings.feedUrl).hostname}`,
          sourceRef: clean(row.id ?? row.sourceRef, 200) ?? `feed:${index}`,
        });
      });

      return out.slice(0, Math.max(0, limit));
    } catch {
      // A failing external source must never break the daily run.
      return [];
    }
  },
};

export const DISCOVERY_SOURCES: DiscoverySource[] = [manualSource, feedSource];

export async function readManualSeed(): Promise<RawCandidate[]> {
  const row = await prisma.adminSetting.findUnique({
    where: { key: MANUAL_SEED_KEY },
    select: { value: true },
  });
  return parseSeed(row?.value);
}

export function serializeManualSeed(candidates: RawCandidate[]): string {
  return JSON.stringify(
    candidates.slice(0, 1000).map((candidate) => ({
      publicName: candidate.publicName,
      publicUrl: candidate.publicUrl ?? null,
      telegramUsername: candidate.telegramUsername ?? null,
      description: candidate.description ?? null,
      city: candidate.city ?? null,
      language: candidate.language ?? null,
      sourceRef: candidate.sourceRef ?? null,
    }))
  );
}

export const MANUAL_SEED_SETTING_KEY = MANUAL_SEED_KEY;
