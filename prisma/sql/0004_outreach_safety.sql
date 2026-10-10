-- Apply only after review, before deploying the code that queries these fields.
-- This file is additive; it never reclassifies pre-existing bookings as tests.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "isTestBooking" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "telegram_bot_opt_ins" (
  "telegramId" TEXT NOT NULL,
  "prospectId" TEXT,
  "startedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "lastUpdateId" INTEGER NOT NULL,
  CONSTRAINT "telegram_bot_opt_ins_pkey" PRIMARY KEY ("telegramId"),
  CONSTRAINT "telegram_bot_opt_ins_prospectId_fkey"
    FOREIGN KEY ("prospectId") REFERENCES "outreach_prospects"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "telegram_bot_opt_ins_prospectId_revokedAt_idx"
  ON "telegram_bot_opt_ins"("prospectId", "revokedAt");
