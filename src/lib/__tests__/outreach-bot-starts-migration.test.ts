import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Review of the hand-written migrations: ordering, schema compatibility and
 * duplicate-row handling.
 *
 * This file reads the real `prisma/sql/*.sql` and `prisma/schema.prisma` from
 * disk. It is deliberately NOT a substitute for running the migration against
 * PostgreSQL — nothing here proves the file is valid SQL or that production
 * matches it. What it does prove is the reviewable part: that the numbering is
 * unambiguous, that the SQL and the Prisma schema agree, and that the file
 * cannot silently delete or rewrite a row.
 */

const root = fileURLToPath(new URL("../../../", import.meta.url));
const sqlDir = `${root}prisma/sql`;
const schemaPath = `${root}prisma/schema.prisma`;
const doublePath = `${root}src/lib/__tests__/helpers/prisma-double.ts`;

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function sqlFiles(): string[] {
  return readdirSync(sqlDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/** Executable SQL only: `--` comments are stripped so prose cannot trip the checks. */
function executable(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

function migration(number: string): { name: string; body: string } | null {
  const name = sqlFiles().find((file) => file.startsWith(`${number}_`));
  return name ? { name, body: read(`${sqlDir}/${name}`) } : null;
}

function botStartModel(): string {
  const schema = read(schemaPath);
  const start = schema.indexOf("model BotStart {");
  const end = schema.indexOf("\n}", start);
  return schema.slice(start, end);
}

function uniqueDirectives(modelBody: string): string[][] {
  return [...modelBody.matchAll(/@@unique\(\[([^\]]+)\]\)/g)]
    .map((match) => match[1].split(",").map((field) => field.trim()))
    .sort((a, b) => a.join(",").localeCompare(b.join(",")));
}

/** The pairs the test double enforces, read out of its UNIQUE_KEYS entry. */
function doubleUniqueKeys(source: string): string[][] {
  const start = source.indexOf("botStart:");
  if (start < 0) return [];
  const rest = source.slice(start);
  const nextKey = rest.search(/\n\s*[a-zA-Z][a-zA-Z0-9]*:\s*\[/);
  const block = nextKey > 0 ? rest.slice(0, nextKey) : rest;
  return [...block.matchAll(/\[\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\]/g)]
    .map((match) => [match[1], match[2]])
    .sort((a, b) => a.join(",").localeCompare(b.join(",")));
}

describe("migration numbering", () => {
  it("has no two files sharing a number", () => {
    const numbers = sqlFiles().map((file) => file.slice(0, 4));
    expect(numbers).toEqual([...new Set(numbers)]);
  });

  it("is a contiguous sequence starting at 0001", () => {
    const numbers = sqlFiles().map((file) => Number(file.slice(0, 4)));
    expect(numbers).toEqual(numbers.map((_, index) => index + 1));
  });

  it("keeps 0005 reserved for the schema-drift file", () => {
    // The collision this repo had: two files numbered 0005, one of them the
    // pre-existing drift reconciliation that the docs point at.
    expect(migration("0005")?.name).toBe("0005_outreach_schema_drift.sql");
    expect(migration("0006")?.name).toBe("0006_bot_starts_unique.sql");
  });
});

describe("0006_bot_starts_unique.sql", () => {
  const file = migration("0006");

  it("exists", () => {
    expect(file).not.toBeNull();
  });

  it("adds the nullable updateId column and both unique indexes", () => {
    const body = file!.body;
    expect(body).toMatch(/ALTER TABLE "bot_starts" ADD COLUMN "updateId" INTEGER/i);
    expect(body).toMatch(
      /CREATE UNIQUE INDEX "bot_starts_telegramId_startParam_key"\s+ON "bot_starts"\("telegramId", "startParam"\)/i
    );
    expect(body).toMatch(
      /CREATE UNIQUE INDEX "bot_starts_telegramId_updateId_key"\s+ON "bot_starts"\("telegramId", "updateId"\)/i
    );
  });

  it("runs as one transaction so a failure changes nothing", () => {
    expect(file!.body).toMatch(/^BEGIN;$/m);
    expect(file!.body).toMatch(/^COMMIT;$/m);
  });

  it("refuses to create an index while duplicate rows exist", () => {
    const body = file!.body;
    // Both keys are counted, and a non-zero count aborts instead of creating.
    expect(body).toMatch(/HAVING COUNT\(\*\) > 1/);
    expect(body).toMatch(/RAISE EXCEPTION/);
    // The duplicate check precedes the index creation in the file.
    expect(body.indexOf("RAISE EXCEPTION")).toBeLessThan(
      body.indexOf("CREATE UNIQUE INDEX")
    );
  });

  it("is guarded and idempotent", () => {
    const body = file!.body;
    expect(body).toMatch(/to_regclass\('bot_starts'\)/);
    expect(body).toMatch(/information_schema\.columns/);
    expect(body).toMatch(/pg_indexes/);
    // Every statement is behind a "does this already exist?" check: the column
    // add and both index creations.
    expect(body.match(/IF (NOT )?EXISTS \(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("never deletes, updates, truncates or drops anything", () => {
    const body = executable(file!.body).toUpperCase();
    for (const forbidden of [
      "DROP ",
      "DELETE ",
      "TRUNCATE",
      "ALTER COLUMN",
      'UPDATE "BOT_STARTS"',
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it("instructs the operator to use psql and not `prisma db push`", () => {
    expect(file!.body).toMatch(/psql "\$DIRECT_URL" -f/);
    expect(file!.body).toMatch(/Do NOT run `prisma db push`/i);
  });

  it("documents the read-only inspection queries before applying", () => {
    expect(file!.body).toMatch(/STEP 1/);
    expect(file!.body).toMatch(/SELECT "telegramId", "startParam", COUNT\(\*\)/);
  });
});

describe("schema and test-double alignment", () => {
  it("declares updateId on BotStart", () => {
    expect(botStartModel()).toMatch(/^\s*updateId\s+Int\?\s*$/m);
  });

  it("declares both unique pairs the migration creates", () => {
    expect(uniqueDirectives(botStartModel())).toEqual([
      ["telegramId", "startParam"],
      ["telegramId", "updateId"],
    ]);
  });

  it("keeps the test double's botStart keys identical to the schema's", () => {
    // Without this, a mock could enforce a constraint the schema does not have
    // (or miss one it does) and the idempotency tests would still look green.
    expect(doubleUniqueKeys(read(doublePath))).toEqual(
      uniqueDirectives(botStartModel())
    );
  });
});
