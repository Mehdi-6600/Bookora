import { withOutreachError } from "@/lib/outreach/api-error";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/admin-api";
import { isRateLimited, triggerRateLimitCleanup } from "@/lib/rate-limit";
import { recordAuditEvent } from "@/lib/outreach/audit";
import {
  isOutreachSettingKey,
  OUTREACH_SETTING_KEYS,
  coerceSettingValue,
  getOutreachSettings,
  MAX_DAILY_DISCOVERY_LIMIT,
  MAX_DAILY_INVITATION_LIMIT,
} from "@/lib/outreach/settings";
import {
  MANUAL_SEED_SETTING_KEY,
  readManualSeedEntries,
  serializeManualSeed,
  validateSeedItems,
  type SeedEntry,
} from "@/lib/outreach/sources";
import { buildDedupeKey } from "@/lib/outreach/normalize";

async function GETImpl() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const settings = await getOutreachSettings();
  if (settings.readError) return NextResponse.json({ error: settings.readError }, { status: 503 });
  const seedItems = await readManualSeedEntries();

  return NextResponse.json(
    {
      settings,
      keys: OUTREACH_SETTING_KEYS,
      limits: {
        maxDailyDiscoveryLimit: MAX_DAILY_DISCOVERY_LIMIT,
        maxDailyInvitationLimit: MAX_DAILY_INVITATION_LIMIT,
      },
      manualSeed: {
        items: seedItems.map((item) => ({
          publicName: item.publicName,
          publicUrl: item.publicUrl,
          telegramUsername: item.telegramUsername,
          description: item.description,
          city: item.city,
          language: item.language,
        })),
        count: seedItems.length,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

async function PUTImpl(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (await isRateLimited(`outreach-settings:${guard.user.id}`, 60, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  triggerRateLimitCleanup();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const entries = Object.entries(body as Record<string, unknown>);
  const invalid: string[] = [];
  const values: Array<{ key: string; value: string }> = [];
  for (const [key, raw] of entries) {
    if (!isOutreachSettingKey(key)) { invalid.push(key); continue; }
    const value = coerceSettingValue(key, raw);
    if (value === null) invalid.push(key);
    else values.push({ key, value });
  }
  if (invalid.length > 0) {
    return NextResponse.json({ error: "invalid settings", invalid }, { status: 400 });
  }
  if (values.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const { key, value } of values) {
        await tx.adminSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
      }
      // Values (including URLs) are never duplicated into audit details.
      await recordAuditEvent({ scope: "settings", action: "settings.updated",
        actorUserId: guard.user.id, detail: `keys=${values.map((row) => row.key).join(",")}` }, tx);
    });
  }

  const settings = await getOutreachSettings();
  return NextResponse.json({ settings });
}

/**
 * Manual seed list for the `manual` discovery source.
 *
 * The administrator pastes PUBLIC business pages they have verified. This is
 * the only discovery input that works out of the box; no scraping is involved.
 *
 * Body: `{ items: [...], mode?: "append" | "replace", confirmClear?: boolean }`.
 *  - Every row is validated. Any problem rejects the whole save with per-row
 *    reasons, so nothing is dropped silently.
 *  - `append` (default) merges into the stored list without removing entries.
 *  - `replace` makes `items` the full list. Clearing a non-empty list also
 *    requires `confirmClear: true`.
 *  - The response is read back from the database, so it reports what was
 *    actually persisted.
 */
async function POSTImpl(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (await isRateLimited(`outreach-seed:${guard.user.id}`, 60, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  triggerRateLimitCleanup();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const items = (body as { items?: unknown })?.items;
  const mode = (body as { mode?: unknown })?.mode === "replace" ? "replace" : "append";
  const confirmClear = (body as { confirmClear?: unknown })?.confirmClear === true;

  if (!Array.isArray(items)) {
    return NextResponse.json(
      { error: "items must be an array of {publicName, publicUrl}" },
      { status: 400 }
    );
  }

  const validated = validateSeedItems(items);
  if (validated.problems.length > 0) {
    return NextResponse.json(
      {
        error: "invalid seed entries: nothing was saved",
        problems: validated.problems,
      },
      { status: 400 }
    );
  }

  const existing = await readManualSeedEntries();
  let next: SeedEntry[];

  if (mode === "replace") {
    if (validated.items.length === 0 && existing.length > 0 && !confirmClear) {
      return NextResponse.json(
        {
          error: "Refusing to clear the stored list without confirmClear.",
          existingCount: existing.length,
        },
        { status: 409 }
      );
    }
    next = validated.items;
  } else {
    const seen = new Set<string>();
    next = [];
    for (const entry of [...existing, ...validated.items]) {
      const key = buildDedupeKey({
        telegramUsername: entry.telegramUsername,
        publicUrl: entry.publicUrl,
        publicName: entry.publicName,
        city: entry.city,
      });
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(entry);
    }
  }

  const value = serializeManualSeed(next);
  await prisma.$transaction(async (tx) => {
    await tx.adminSetting.upsert({
      where: { key: MANUAL_SEED_SETTING_KEY }, update: { value },
      create: { key: MANUAL_SEED_SETTING_KEY, value },
    });
    await recordAuditEvent({ scope: "settings", action: "seed.saved",
      actorUserId: guard.user.id,
      detail: `mode=${mode} count=${next.length} added=${validated.items.length}` }, tx);
  });
  // Confirm persistence by reading the stored value back.
  const persisted = await readManualSeedEntries();
  const persistedOk = persisted.length === next.length;

  if (!persistedOk) {
    return NextResponse.json(
      { error: "Seed was not persisted. Try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    saved: persisted.length,
    mode,
    added: mode === "append" ? next.length - existing.length : validated.items.length,
    persisted: true,
    items: persisted.map((item) => ({
      publicName: item.publicName,
      publicUrl: item.publicUrl,
      telegramUsername: item.telegramUsername,
      description: item.description,
      city: item.city,
      language: item.language,
    })),
  });
}

export const GET = withOutreachError(GETImpl);
export const PUT = withOutreachError(PUTImpl);
export const POST = withOutreachError(POSTImpl);
