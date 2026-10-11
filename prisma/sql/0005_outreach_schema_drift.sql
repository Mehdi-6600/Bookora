-- Bookora — migration 0005: reconcile outreach schema drift
--
-- STATUS: NOT APPLIED. Owner approval required before this file runs anywhere.
-- No production database was touched while producing it.
--
-- Why it exists
-- -------------
-- PR #14 flagged three drift items between prisma/schema.prisma and the SQL in
-- prisma/sql/0001–0004. Re-reading both sides (docs/growth/SCHEMA-DRIFT.md has
-- the full evidence) leaves TWO real, non-destructive drifts plus one
-- optimisation:
--
--   1. prisma/sql/0002 adds five timestamp columns as `timestamptz`, while
--      Prisma maps `DateTime` to `timestamp(3)` (0001, 0003 and 0004 already use
--      `TIMESTAMP(3)`).
--
--   2. The two foreign keys created by prisma/sql/0002 are declared without
--      `ON UPDATE CASCADE`, while the Prisma relations default to
--      `onUpdate: Cascade`. When 0001 created those constraints first the drift
--      does not exist; when 0002 created them it does. Re-creating them with the
--      clause makes the outcome identical either way.
--
--   3. (Optional) the audit history query filters by `scope`/`entityId` and
--      orders by `createdAt`. The `(scope, entityId)` and `(createdAt)` indexes
--      from 0003 already serve it; the compound index is a tuning option, not a
--      correctness fix. It is left commented out on purpose: adding it here
--      without adding the matching `@@index` to prisma/schema.prisma would
--      create a NEW drift.
--
-- Safety
-- ------
--   * Every statement is guarded and idempotent: re-running the file is a no-op.
--   * No row is inserted, updated or deleted. No column or table is dropped.
--   * `ALTER COLUMN ... TYPE timestamp(3) USING ("col" AT TIME ZONE 'UTC')`
--     preserves the instant; it only removes the stored timezone.
--   * The whole file runs in one transaction, so a failure changes nothing.
--   * Apply with:  psql "$DIRECT_URL" -f prisma/sql/0005_outreach_schema_drift.sql
--     Do NOT run `prisma db push` for this file; `db push` would apply its own
--     diff on top of the hand-written migrations.
--
-- Prerequisites: 0001–0004 already applied.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. timestamptz -> timestamp(3), matching the Prisma schema
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'outreach_campaigns'
      AND column_name = 'approvedAt' AND data_type = 'timestamp with time zone'
  ) THEN
    ALTER TABLE outreach_campaigns
      ALTER COLUMN "approvedAt" TYPE timestamp(3) USING ("approvedAt" AT TIME ZONE 'UTC');
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'outreach_campaigns'
      AND column_name = 'lastDryRunAt' AND data_type = 'timestamp with time zone'
  ) THEN
    ALTER TABLE outreach_campaigns
      ALTER COLUMN "lastDryRunAt" TYPE timestamp(3) USING ("lastDryRunAt" AT TIME ZONE 'UTC');
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'outreach_campaigns'
      AND column_name = 'lastPreparedAt' AND data_type = 'timestamp with time zone'
  ) THEN
    ALTER TABLE outreach_campaigns
      ALTER COLUMN "lastPreparedAt" TYPE timestamp(3) USING ("lastPreparedAt" AT TIME ZONE 'UTC');
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'outreach_prospects'
      AND column_name = 'verificationDate' AND data_type = 'timestamp with time zone'
  ) THEN
    ALTER TABLE outreach_prospects
      ALTER COLUMN "verificationDate" TYPE timestamp(3) USING ("verificationDate" AT TIME ZONE 'UTC');
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'outreach_prospects'
      AND column_name = 'lastInteractionAt' AND data_type = 'timestamp with time zone'
  ) THEN
    ALTER TABLE outreach_prospects
      ALTER COLUMN "lastInteractionAt" TYPE timestamp(3) USING ("lastInteractionAt" AT TIME ZONE 'UTC');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Foreign keys: add the ON UPDATE CASCADE the Prisma relations declare
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outreach_campaigns_templateId_fkey'
  ) THEN
    ALTER TABLE outreach_campaigns DROP CONSTRAINT "outreach_campaigns_templateId_fkey";
  END IF;

  ALTER TABLE outreach_campaigns
    ADD CONSTRAINT "outreach_campaigns_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES invitation_templates(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outreach_invitations_campaignId_fkey'
  ) THEN
    ALTER TABLE outreach_invitations DROP CONSTRAINT "outreach_invitations_campaignId_fkey";
  END IF;

  ALTER TABLE outreach_invitations
    ADD CONSTRAINT "outreach_invitations_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES outreach_campaigns(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Audit indexes (idempotent; creates them if production built the table
--    outside 0003). Safe to run when they already exist.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "outreach_audit_events_scope_entityId_idx"
  ON "outreach_audit_events"("scope", "entityId");
CREATE INDEX IF NOT EXISTS "outreach_audit_events_createdAt_idx"
  ON "outreach_audit_events"("createdAt");

-- OPTIONAL tuning, disabled on purpose — see the header note about drift:
-- CREATE INDEX IF NOT EXISTS "outreach_audit_events_scope_entityId_createdAt_idx"
--   ON "outreach_audit_events"("scope", "entityId", "createdAt");

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification (run by hand after applying; read-only)
-- ---------------------------------------------------------------------------
-- SELECT table_name, column_name, data_type
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND (
--      (table_name = 'outreach_campaigns'  AND column_name IN ('approvedAt','lastDryRunAt','lastPreparedAt'))
--   OR (table_name = 'outreach_prospects' AND column_name IN ('verificationDate','lastInteractionAt'))
--    );
--   -- every data_type must read "timestamp without time zone"
--
-- SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--  WHERE conname IN ('outreach_campaigns_templateId_fkey','outreach_invitations_campaignId_fkey');
--   -- both definitions must end with "ON UPDATE CASCADE"
--
-- SELECT indexname FROM pg_indexes
--  WHERE tablename = 'outreach_audit_events';
