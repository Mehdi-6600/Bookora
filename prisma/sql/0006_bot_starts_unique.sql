-- Bookora — migration 0006: make `bot_starts` idempotent
--
-- STATUS: NOT APPLIED. Owner approval required before this file runs anywhere.
-- No production database was touched while producing it.
--
-- Why it exists
-- -------------
-- `prisma/sql/0001_outreach_growth.sql` creates `bot_starts` with only a primary
-- key on `id` and three non-unique indexes (lines 140-154). Nothing in the
-- database therefore stops a repeated or concurrent Telegram webhook delivery
-- from recording the same attributed start twice, which inflates the "Bot
-- starts" figure in `getConversionCounts` (`src/lib/outreach/attribution.ts`)
-- and every per-campaign conversion rate derived from it.
--
-- This file adds two unique indexes and the one column the second one needs:
--
--   1. ("telegramId", "startParam") — one attributed start per deep link.
--   2. ("telegramId", "updateId")   — one attributed start per Telegram update,
--      which is also what makes a /start *without* a deep-link parameter
--      idempotent. `updateId` is a new nullable column; no row is backfilled.
--
-- Why plain unique indexes and not partial ("WHERE ... IS NOT NULL") ones
-- -----------------------------------------------------------------------
-- PostgreSQL treats NULLs as distinct in a unique index, so a plain
-- `UNIQUE ("telegramId", "updateId")` already leaves every row with a NULL
-- `updateId` unconstrained — exactly the semantics a partial index would give.
-- The difference is that a plain unique index is expressible in
-- `prisma/schema.prisma` (`@@unique([telegramId, updateId])`), so the schema and
-- the SQL stay in sync. A partial index would be invisible to Prisma and would
-- silently re-create the class of drift that `0005_outreach_schema_drift.sql`
-- exists to remove.
--
-- Safety
-- ------
--   * Additive only: one nullable column and two indexes. No row is inserted,
--     updated, deleted or reclassified. No column or table is dropped.
--   * The whole file runs in one transaction. If duplicate rows are present it
--     raises before creating anything, so the column add is rolled back too and
--     the database is left exactly as it was.
--   * Re-running is a no-op: every statement is guarded.
--   * Apply with:  psql "$DIRECT_URL" -f prisma/sql/0006_bot_starts_unique.sql
--     Do NOT run `prisma db push` for this file; `db push` would apply its own
--     diff on top of the hand-written migrations.
--
-- Prerequisites: 0001 already applied (0002-0005 do not touch this table).
--
-- ---------------------------------------------------------------------------
-- STEP 1 — operator, read-only. Run these FIRST and review the output before
-- applying STEP 2. They change nothing.
-- ---------------------------------------------------------------------------
--   -- Duplicate deep-link starts:
--   SELECT "telegramId", "startParam", COUNT(*) AS duplicate_rows,
--          array_agg(id ORDER BY "createdAt") AS ids,
--          min("createdAt") AS first_seen, max("createdAt") AS last_seen
--     FROM "bot_starts"
--    WHERE "startParam" IS NOT NULL
--    GROUP BY "telegramId", "startParam"
--   HAVING COUNT(*) > 1
--    ORDER BY duplicate_rows DESC, "telegramId";
--
--   -- Duplicate per-update starts (0 until "updateId" exists and is backfilled;
--   -- checked here for completeness and for future re-runs):
--   SELECT "telegramId", "updateId", COUNT(*) AS duplicate_rows,
--          array_agg(id ORDER BY "createdAt") AS ids
--     FROM "bot_starts"
--    WHERE "updateId" IS NOT NULL
--    GROUP BY "telegramId", "updateId"
--   HAVING COUNT(*) > 1
--    ORDER BY duplicate_rows DESC, "telegramId";
--
--   -- Totals, for the record:
--   SELECT COUNT(*) AS total_rows,
--          COUNT("startParam") AS rows_with_start_param
--     FROM "bot_starts";
--
-- ---------------------------------------------------------------------------
-- STEP 2 — this script.
--   - 0 duplicate groups in both queries -> adds the column and both indexes.
--   - any duplicate group -> RAISE EXCEPTION, nothing is created, the
--     transaction is rolled back. The clean-up stays a deliberate, separately
--     reviewed action: no row is merged, retired or rewritten automatically.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. bot_starts."updateId" — nullable, no default, no backfill.
--    Type INTEGER matches TelegramBotOptIn.lastUpdateId in prisma/schema.prisma.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('bot_starts') IS NULL THEN
    RAISE EXCEPTION
      'bot_starts: table not present. Apply prisma/sql/0001 first — nothing was changed.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'bot_starts'
       AND column_name = 'updateId'
  ) THEN
    ALTER TABLE "bot_starts" ADD COLUMN "updateId" INTEGER;
    RAISE NOTICE
      'bot_starts: added nullable column "updateId". Existing rows keep NULL; nothing was backfilled.';
  ELSE
    RAISE NOTICE
      'bot_starts: column "updateId" already present; nothing to do.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Duplicate inspection, then the two unique indexes. All or nothing.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  dup_start_param integer;
  dup_update_id   integer;
BEGIN
  SELECT COUNT(*) INTO dup_start_param
    FROM (
      SELECT "telegramId", "startParam"
        FROM "bot_starts"
       WHERE "startParam" IS NOT NULL
       GROUP BY "telegramId", "startParam"
      HAVING COUNT(*) > 1
    ) AS dupes;

  SELECT COUNT(*) INTO dup_update_id
    FROM (
      SELECT "telegramId", "updateId"
        FROM "bot_starts"
       WHERE "updateId" IS NOT NULL
       GROUP BY "telegramId", "updateId"
      HAVING COUNT(*) > 1
    ) AS dupes;

  IF dup_start_param > 0 OR dup_update_id > 0 THEN
    RAISE EXCEPTION
      'bot_starts: % duplicate (telegramId, startParam) group(s) and % duplicate (telegramId, updateId) group(s) found. No index was created and no row was modified; the transaction is rolled back. Run the STEP 1 queries, review the rows, then re-run this file after an explicitly approved clean-up.',
      dup_start_param, dup_update_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = current_schema()
       AND indexname = 'bot_starts_telegramId_startParam_key'
  ) THEN
    RAISE NOTICE
      'bot_starts: unique index bot_starts_telegramId_startParam_key already present; nothing to do.';
  ELSE
    CREATE UNIQUE INDEX "bot_starts_telegramId_startParam_key"
      ON "bot_starts"("telegramId", "startParam");
    RAISE NOTICE
      'bot_starts: created unique index bot_starts_telegramId_startParam_key.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = current_schema()
       AND indexname = 'bot_starts_telegramId_updateId_key'
  ) THEN
    RAISE NOTICE
      'bot_starts: unique index bot_starts_telegramId_updateId_key already present; nothing to do.';
  ELSE
    -- NULL "updateId" values stay unconstrained (PostgreSQL treats NULLs as
    -- distinct), which is what keeps independently sent /start commands
    -- countable. See the header note on plain vs. partial indexes.
    CREATE UNIQUE INDEX "bot_starts_telegramId_updateId_key"
      ON "bot_starts"("telegramId", "updateId");
    RAISE NOTICE
      'bot_starts: created unique index bot_starts_telegramId_updateId_key.';
  END IF;
END $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification (run by hand after applying; read-only)
-- ---------------------------------------------------------------------------
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'bot_starts'
--    AND column_name = 'updateId';
--   -- one row: integer / YES
--
-- SELECT indexname, indexdef FROM pg_indexes
--  WHERE tablename = 'bot_starts' ORDER BY indexname;
--   -- must include bot_starts_telegramId_startParam_key and
--   -- bot_starts_telegramId_updateId_key, both UNIQUE
--
-- SELECT "telegramId", "startParam", COUNT(*) FROM "bot_starts"
--  WHERE "startParam" IS NOT NULL
--  GROUP BY "telegramId", "startParam" HAVING COUNT(*) > 1;
--   -- must return 0 rows
