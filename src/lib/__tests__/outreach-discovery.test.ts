import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * In-memory stand-in for Prisma so the discovery pipeline (keyword filter,
 * quota, deduplication, exclusions, idempotent runs) can be tested without a
 * database.
 */

type Row = Record<string, any>;

const db = {
  runDate: "",
  discoveryRuns: [] as Row[],
  keywords: [] as Row[],
  candidates: [] as Row[],
  prospects: [] as Row[],
  suppressions: [] as Row[],
  users: [] as Row[],
  businesses: [] as Row[],
  seed: null as string | null,
  created: [] as Row[],
};

vi.mock("@/lib/prisma", () => {
  const prisma = {
    discoveryRun: {
      findUnique: async ({ where }: any) =>
        db.discoveryRuns.find((row: Row) => row.runDate === where.runDate) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const existing = db.discoveryRuns.find(
          (row: Row) => row.runDate === where.runDate
        ) as Row | undefined;
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: "run-" + db.discoveryRuns.length, ...create };
        db.discoveryRuns.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = db.discoveryRuns.find((item: Row) => item.id === where.id) as Row;
        Object.assign(row, data);
        return row;
      },
      findFirst: async () => db.discoveryRuns[db.discoveryRuns.length - 1] ?? null,
      create: async ({ data }: any) => {
        const row = { id: "run-" + db.discoveryRuns.length, ...data };
        db.discoveryRuns.push(row);
        return row;
      },
    },
    discoveryKeyword: {
      findMany: async () => db.keywords,
    },
    discoveryCandidate: {
      count: async ({ where }: any) =>
        db.candidates.filter(
          (row: Row) =>
            !where?.discoveredOn ||
            new Date(row.discoveredOn).getTime() === new Date(where.discoveredOn).getTime()
        ).length,
      findMany: async ({ where }: any) =>
        db.candidates.filter((row: Row) => (where?.id?.in ?? []).includes(row.id)),
      update: async ({ where, data }: any) => {
        const row = db.candidates.find((item: Row) => item.id === where.id) as Row;
        Object.assign(row, data);
        return row;
      },
      findUnique: async ({ where }: any) =>
        db.candidates.find((row: Row) => row.dedupeKey === where.dedupeKey) ?? null,
      create: async ({ data }: any) => {
        const row = { id: "cand-" + db.candidates.length, ...data };
        db.candidates.push(row);
        db.created.push(row);
        return row;
      },
    },
    outreachProspect: {
      findUnique: async ({ where }: any) =>
        db.prospects.find((row: Row) => row.dedupeKey === where.dedupeKey) ?? null,
      findFirst: async () => null,
      update: async ({ where, data }: any) => {
        const row = db.prospects.find((item: Row) => item.id === where.id) as Row;
        Object.assign(row, data);
        return row;
      },
      create: async ({ data }: any) => {
        const row = { id: "prospect-" + db.prospects.length, ...data };
        db.prospects.push(row);
        return row;
      },
    },
    outreachSuppression: {
      findFirst: async ({ where }: any) =>
        db.suppressions.find((row: Row) =>
          where.identifier.in.includes(row.identifier)
        ) ?? null,
    },
    user: {
      findFirst: async ({ where }: any) => {
        const wanted = String(where.telegramUsername?.equals ?? "").toLowerCase();
        return db.users.find((row: Row) => String(row.telegramUsername).toLowerCase() === wanted) ?? null;
      },
    },
    business: {
      findFirst: async ({ where }: any) => {
        const needles: string[] = (where.OR ?? []).map((clause: any) =>
          String(clause.website?.contains ?? clause.instagram?.contains ?? "")
        );
        return (
          db.businesses.find((row: Row) =>
            needles.some((needle) => needle && String(row.website ?? "").includes(needle))
          ) ?? null
        );
      },
    },
    adminSetting: {
      findUnique: async ({ where }: any) =>
        where.key === "outreach.manual_seed"
          ? { key: where.key, value: db.seed }
          : null,
    },
  };

  return { prisma };
});

const { runDailyDiscovery, promoteCandidates } = await import("@/lib/outreach/discovery");
const { DEFAULT_OUTREACH_SETTINGS } = await import("@/lib/outreach/settings");
type OutreachSettings = import("@/lib/outreach/settings").OutreachSettings;

const NOW = new Date("2026-10-10T06:00:00.000Z");

function settings(overrides: Partial<OutreachSettings> = {}): OutreachSettings {
  return { ...DEFAULT_OUTREACH_SETTINGS, timezone: "UTC", ...overrides };
}

function seedKeywords() {
  db.keywords = [
    { term: "barber", group: "BARBER", language: "en", priority: 5, enabled: true },
    { term: "beauty salon", group: "BEAUTY", language: "en", priority: 5, enabled: true },
    { term: "clinic", group: "MEDICAL", language: "en", priority: 5, enabled: true },
    { term: "off", group: "BEAUTY", language: "en", priority: 5, enabled: false },
  ];
}

function seedList(items: Array<Record<string, unknown>>) {
  db.seed = JSON.stringify(items);
}

beforeEach(() => {
  db.discoveryRuns = [];
  db.candidates = [];
  db.prospects = [];
  db.suppressions = [];
  db.users = [];
  db.businesses = [];
  db.created = [];
  db.seed = null;
  seedKeywords();
});

describe("daily discovery", () => {
  it("imports matching candidates and reports the counts", async () => {
    seedList([
      { publicName: "Mehdi Barber", publicUrl: "https://instagram.com/mehdi", city: "Tehran" },
      { publicName: "Nails Beauty Salon", publicUrl: "https://instagram.com/nails" },
      { publicName: "Corner Grocery", publicUrl: "https://instagram.com/grocery" },
    ]);

    const result = await runDailyDiscovery({ settings: settings(), now: NOW });

    expect(result.status).toBe("OK");
    expect(result.discovered).toBe(2);
    expect(result.excluded).toBe(1);
    expect(db.candidates.map((row) => row.publicName)).toEqual([
      "Mehdi Barber",
      "Nails Beauty Salon",
    ]);
    expect(db.candidates[0].group).toBe("BARBER");
    expect(db.candidates[1].group).toBe("BEAUTY");
  });

  it("enforces the daily discovery quota", async () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      publicName: `Barber ${index}`,
      publicUrl: `https://instagram.com/barber${index}`,
    }));
    seedList(many);

    const result = await runDailyDiscovery({
      settings: settings({ dailyDiscoveryLimit: 5 }),
      now: NOW,
    });

    expect(result.discovered).toBeLessThanOrEqual(5);
    expect(db.candidates.length).toBeLessThanOrEqual(5);
  });

  it("deduplicates candidates inside a single run", async () => {
    seedList([
      { publicName: "Mehdi Barber", publicUrl: "https://instagram.com/mehdi" },
      { publicName: "Mehdi Barber", publicUrl: "https://www.instagram.com/mehdi/" },
      { publicName: "Mehdi  Barber", publicUrl: "http://instagram.com/mehdi" },
    ]);

    const result = await runDailyDiscovery({ settings: settings(), now: NOW });

    expect(result.discovered).toBe(1);
    expect(result.duplicates).toBe(2);
  });

  it("excludes businesses that are already prospects", async () => {
    db.prospects.push({
      id: "p1",
      publicName: "Mehdi Barber",
      dedupeKey: "url:instagram.com/mehdi",
      status: "NEW",
    });

    seedList([{ publicName: "Mehdi Barber", publicUrl: "https://instagram.com/mehdi" }]);

    const result = await runDailyDiscovery({ settings: settings(), now: NOW });

    expect(result.discovered).toBe(0);
    expect(result.duplicates).toBe(1);
  });

  it("excludes existing customers", async () => {
    db.users.push({ id: "u1", telegramUsername: "mehdi_barber" });

    seedList([
      {
        publicName: "Mehdi Barber",
        publicUrl: "https://instagram.com/mehdi",
        telegramUsername: "@mehdi_barber",
      },
    ]);

    const result = await runDailyDiscovery({ settings: settings(), now: NOW });

    expect(result.discovered).toBe(0);
    expect(result.excluded).toBe(1);
  });

  it("excludes opted-out contacts", async () => {
    db.suppressions.push({ identifier: "url:instagram.com/mehdi", reason: "OPT_OUT" });
    db.suppressions.push({ identifier: "tg:mehdi_barber", reason: "OPT_OUT" });

    seedList([
      {
        publicName: "Mehdi Barber",
        publicUrl: "https://instagram.com/mehdi",
        telegramUsername: "@mehdi_barber",
      },
    ]);

    const result = await runDailyDiscovery({ settings: settings(), now: NOW });

    expect(result.discovered).toBe(0);
    expect(result.excluded).toBe(1);
  });

  it("ignores disabled keywords", async () => {
    seedList([{ publicName: "Off Limits Bar", publicUrl: "https://instagram.com/off" }]);

    const result = await runDailyDiscovery({ settings: settings(), now: NOW });

    expect(result.excluded).toBe(1);
  });

  it("respects the minimum score", async () => {
    seedList([{ publicName: "City Clinic", publicUrl: "https://instagram.com/clinic" }]);

    const low = await runDailyDiscovery({
      settings: settings({ minScore: 0 }),
      now: NOW,
    });
    expect(low.discovered).toBe(1);

    db.candidates = [];
    db.discoveryRuns = [];

    const high = await runDailyDiscovery({
      settings: settings({ minScore: 100 }),
      now: NOW,
    });
    expect(high.discovered).toBe(0);
  });

  it("never runs twice for the same date", async () => {
    seedList([{ publicName: "Mehdi Barber", publicUrl: "https://instagram.com/mehdi" }]);

    const first = await runDailyDiscovery({ settings: settings(), now: NOW });
    const second = await runDailyDiscovery({ settings: settings(), now: NOW });

    expect(first.status).toBe("OK");
    expect(second.status).toBe("SKIPPED");
    expect(db.candidates.length).toBe(1);
    expect(db.discoveryRuns.length).toBe(1);
  });

  it("files the run under the configured timezone date", async () => {
    seedList([]);
    await runDailyDiscovery({ settings: settings({ timezone: "Asia/Tehran" }), now: NOW });

    expect(db.discoveryRuns[0].runDate).toBe("2026-10-10");
    expect(db.discoveryRuns[0].timezone).toBe("Asia/Tehran");
  });

  it("stores the source and matched terms for auditability", async () => {
    seedList([{ publicName: "Mehdi Barber", publicUrl: "https://instagram.com/mehdi" }]);

    await runDailyDiscovery({ settings: settings(), now: NOW });

    expect(db.candidates[0].source).toBe("manual");
    expect(db.candidates[0].matchedTerms).toContain("barber");
    expect(db.candidates[0].score).toBeGreaterThan(0);
  });
});

describe("candidate promotion", () => {
  it("creates prospects and links the candidate", async () => {
    seedList([{ publicName: "Mehdi Barber", publicUrl: "https://instagram.com/mehdi" }]);
    await runDailyDiscovery({ settings: settings(), now: NOW });

    const result = await promoteCandidates({
      candidateIds: db.candidates.map((row: Row) => row.id),
    });

    expect(result.promoted).toBe(1);
    expect(db.prospects).toHaveLength(1);
    expect(db.prospects[0].status).toBe("NEW");
  });

  it("does not create the same prospect twice", async () => {
    seedList([{ publicName: "Mehdi Barber", publicUrl: "https://instagram.com/mehdi" }]);
    await runDailyDiscovery({ settings: settings(), now: NOW });

    await promoteCandidates({ candidateIds: [db.candidates[0].id] });
    const result = await promoteCandidates({ candidateIds: [db.candidates[0].id] });

    expect(result.promoted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(db.prospects).toHaveLength(1);
  });
});
