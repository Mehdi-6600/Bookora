import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { recordAttributedStart } from "@/lib/outreach/attribution";

/**
 * Idempotency of `bot_starts` — the two keys and the failure paths.
 *
 * These drive the real `recordAttributedStart`, not a re-implementation of it.
 * The concurrent cases delay the insert by one tick so both in-flight calls
 * observe "no row yet" and race on `create`, which is the only way to reach the
 * P2002 branch: a sequential test stops at the earlier `findFirst` and would
 * pass even if the unique constraint did not exist.
 *
 * Two caveats are stated here rather than hidden, because a green run does not
 * prove production behaviour:
 *
 *   1. The unique constraint itself is simulated by the test double
 *      (`helpers/prisma-double.ts`). The real indexes are created only by
 *      `prisma/sql/0006_bot_starts_unique.sql`, which is NOT applied. Until it
 *      runs, production still has no constraint and relies on the reads alone.
 *      `outreach-bot-starts-migration.test.ts` checks that the migration file
 *      and `prisma/schema.prisma` really do declare them.
 *   2. Nothing here talks to Telegram or to PostgreSQL.
 */

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, any>>>,
  seq: 0,
  apiCalls: [] as Array<{ method: string; payload: any }>,
}));

vi.mock("@prisma/client", () => import("./helpers/prisma-client-stub"));

vi.mock("@/lib/prisma", async () => {
  const { createPrismaDouble } = await import("./helpers/prisma-double");
  return { prisma: createPrismaDouble(state) };
});

function table(name: string): Array<Record<string, any>> {
  if (!state.tables[name]) state.tables[name] = [];
  return state.tables[name];
}

/** Yield once so two in-flight calls interleave inside `create`. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

type Restore = () => void;

async function delayCreate(model: string): Promise<Restore> {
  const delegate = (prisma as any)[model];
  const original = delegate.create.bind(delegate);
  delegate.create = async (args: any) => {
    await tick();
    return original(args);
  };
  return () => {
    delegate.create = original;
  };
}

/** Make the insert fail with a chosen error, to exercise the catch branches. */
function failCreateWith(error: unknown): Restore {
  const delegate = (prisma as any).botStart;
  const original = delegate.create.bind(delegate);
  delegate.create = async () => {
    throw error;
  };
  return () => {
    delegate.create = original;
  };
}

function uniqueViolation(): Error & { code: string } {
  const error = new Error(
    "Unique constraint failed on the fields: (`telegramId`,`updateId`)"
  ) as Error & { code: string };
  error.code = "P2002";
  return error;
}

let restores: Restore[] = [];

beforeEach(() => {
  for (const key of Object.keys(state.tables)) delete state.tables[key];
  state.seq = 0;
  state.apiCalls = [];
  restores = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  restores.forEach((restore) => restore());
  restores = [];
  vi.restoreAllMocks();
});

describe("recordAttributedStart — with a startParam", () => {
  it("records one row when the same update is replayed concurrently", async () => {
    restores.push(await delayCreate("botStart"));

    await Promise.all([
      recordAttributedStart({
        telegramId: "555001",
        startParam: "p-invite123",
        updateId: 900,
      }),
      recordAttributedStart({
        telegramId: "555001",
        startParam: "p-invite123",
        updateId: 900,
      }),
    ]);

    expect(table("botStart")).toHaveLength(1);
    expect(table("botStart")[0]).toMatchObject({
      telegramId: "555001",
      startParam: "p-invite123",
      updateId: 900,
    });
  });

  it("records one row when the same deep link is opened again later", async () => {
    await recordAttributedStart({
      telegramId: "555001",
      startParam: "p-invite123",
      updateId: 901,
    });
    // A second, genuinely new update carrying the same deep link must not
    // count as a second attributed start.
    await recordAttributedStart({
      telegramId: "555001",
      startParam: "p-invite123",
      updateId: 902,
    });

    expect(table("botStart")).toHaveLength(1);
    expect(table("botStart")[0]).toMatchObject({ updateId: 901 });
  });

  it("still counts two different deep links separately", async () => {
    await recordAttributedStart({
      telegramId: "555001",
      startParam: "p-invite123",
      updateId: 901,
    });
    await recordAttributedStart({
      telegramId: "555001",
      startParam: "p-other",
      updateId: 902,
    });

    expect(table("botStart")).toHaveLength(2);
  });
});

describe("recordAttributedStart — without a startParam", () => {
  it("records one row when the same update is replayed concurrently", async () => {
    restores.push(await delayCreate("botStart"));

    await Promise.all([
      recordAttributedStart({ telegramId: "555001", startParam: undefined, updateId: 900 }),
      recordAttributedStart({ telegramId: "555001", startParam: undefined, updateId: 900 }),
    ]);

    // The (telegramId, startParam) index cannot help here: startParam is NULL.
    // Only the (telegramId, updateId) key can.
    expect(table("botStart")).toHaveLength(1);
    expect(table("botStart")[0]).toMatchObject({
      telegramId: "555001",
      startParam: null,
      updateId: 900,
    });
  });

  it("records one row when the same update is replayed sequentially", async () => {
    await recordAttributedStart({ telegramId: "555001", startParam: undefined, updateId: 900 });
    await recordAttributedStart({ telegramId: "555001", startParam: undefined, updateId: 900 });
    await recordAttributedStart({ telegramId: "555001", startParam: undefined, updateId: 900 });

    expect(table("botStart")).toHaveLength(1);
  });

  it("still counts two genuinely separate /start commands", async () => {
    // The whole point of keying on the update id rather than on the user: a
    // real repeat visit is a new event and must stay countable.
    await recordAttributedStart({ telegramId: "555001", startParam: undefined, updateId: 900 });
    await recordAttributedStart({ telegramId: "555001", startParam: undefined, updateId: 901 });

    expect(table("botStart")).toHaveLength(2);
    expect(table("botStart").map((row) => row.updateId)).toEqual([900, 901]);
  });

  it("keeps different users separate for the same update id", async () => {
    await recordAttributedStart({ telegramId: "555001", startParam: undefined, updateId: 900 });
    await recordAttributedStart({ telegramId: "555002", startParam: undefined, updateId: 900 });

    expect(table("botStart")).toHaveLength(2);
  });
});

describe("recordAttributedStart — no update id (Mini App auth callback)", () => {
  it("still de-duplicates on the deep link", async () => {
    // This caller has no Telegram update at all, only the signed start_param.
    await recordAttributedStart({
      telegramId: "555001",
      startParam: "p-invite123",
    });
    await recordAttributedStart({
      telegramId: "555001",
      startParam: "p-invite123",
    });

    expect(table("botStart")).toHaveLength(1);
    expect(table("botStart")[0]).toMatchObject({ updateId: null });
  });

  it("writes nothing and fails loudly when there is no key to de-duplicate on", async () => {
    // No update id and no deep link: there is nothing to key on, so each call
    // is a separate row. Documented deliberately — the auth callback never
    // reaches this branch (it only runs when a start_param is present).
    await recordAttributedStart({ telegramId: "555001", startParam: undefined });
    await recordAttributedStart({ telegramId: "555001", startParam: undefined });

    expect(table("botStart")).toHaveLength(2);
    expect(table("botStart").every((row) => row.updateId === null)).toBe(true);
  });
});

describe("recordAttributedStart — the read guard, with no index to fall back on", () => {
  /**
   * The concurrent tests above can only pass with a unique index in play, and
   * the double simulates one — which means they would also pass if the guard
   * in `recordAttributedStart` were deleted and the insert were left to fail on
   * its own. These tests close that hole: from the moment `create` is patched,
   * every insert throws a *non*-P2002 error, which is never swallowed. So the
   * only thing that can keep a replayed update quiet is the read guard itself.
   * They fail if the guard is removed, even with the constraint simulated.
   */

  it("stops a replayed update before it reaches the insert", async () => {
    await recordAttributedStart({ telegramId: "555001", startParam: undefined, updateId: 900 });
    expect(table("botStart")).toHaveLength(1);

    restores.push(failCreateWith(new Error("connection terminated")));

    await recordAttributedStart({ telegramId: "555001", startParam: undefined, updateId: 900 });

    expect(console.error).not.toHaveBeenCalled();
    expect(table("botStart")).toHaveLength(1);
  });

  it("still attempts the insert for a genuinely new update", async () => {
    await recordAttributedStart({ telegramId: "555001", startParam: undefined, updateId: 900 });
    restores.push(failCreateWith(new Error("connection terminated")));

    await recordAttributedStart({ telegramId: "555001", startParam: undefined, updateId: 901 });

    // The negative control for the test above: a new update must reach the
    // insert, so the same failure IS reported.
    expect(console.error).toHaveBeenCalledWith(
      "recordAttributedStart failed:",
      "Error"
    );
    expect(table("botStart")).toHaveLength(1);
  });

  it("stops a replayed deep link before it reaches the insert, with no update id", async () => {
    await recordAttributedStart({
      telegramId: "555001",
      startParam: "p-invite123",
    });
    restores.push(failCreateWith(new Error("connection terminated")));

    await recordAttributedStart({
      telegramId: "555001",
      startParam: "p-invite123",
    });

    expect(console.error).not.toHaveBeenCalled();
    expect(table("botStart")).toHaveLength(1);
  });
});

describe("recordAttributedStart — insert failures", () => {
  it("treats a P2002 from the insert as the idempotent outcome, not a failure", async () => {
    restores.push(failCreateWith(uniqueViolation()));

    await expect(
      recordAttributedStart({ telegramId: "555001", startParam: undefined, updateId: 900 })
    ).resolves.toBeUndefined();

    // Swallowed on purpose: a duplicate insert IS the outcome we want, so it
    // must not be logged as an attribution failure the way a real error is.
    expect(console.error).not.toHaveBeenCalled();
    expect(table("botStart")).toHaveLength(0);
  });

  it("reports a real insert failure instead of hiding it", async () => {
    restores.push(failCreateWith(new Error("connection terminated")));

    await recordAttributedStart({ telegramId: "555001", startParam: undefined, updateId: 900 });

    expect(console.error).toHaveBeenCalledWith(
      "recordAttributedStart failed:",
      "Error"
    );
    expect(table("botStart")).toHaveLength(0);
  });
});
