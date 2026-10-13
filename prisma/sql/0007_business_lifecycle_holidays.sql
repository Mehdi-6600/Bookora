-- Bookora — migration 0007: business lifecycle fields and full-day holidays
--
-- STATUS: NOT APPLIED. Test on a non-production Neon branch first.
--
-- New draft businesses are not public until an owner activates them after
-- attaching a paid subscription. Existing rows retain their current status.
-- Creation keys make retried create requests idempotent per owner.
-- This is an additive migration; it does not touch bot_starts or migration 0006.
-- Review on a non-production Neon branch before applying anywhere else.

BEGIN;

ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "setupCompletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "creationKey" TEXT;

ALTER TABLE "businesses"
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

CREATE INDEX IF NOT EXISTS "businesses_expiresAt_idx"
  ON "businesses"("expiresAt");

CREATE INDEX IF NOT EXISTS "businesses_deletedAt_idx"
  ON "businesses"("deletedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "businesses_ownerId_creationKey_key"
  ON "businesses"("ownerId", "creationKey");

CREATE TABLE IF NOT EXISTS "holidays" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "holidays_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "holidays_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "businesses"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "holidays_businessId_date_key"
  ON "holidays"("businessId", "date");

COMMIT;
