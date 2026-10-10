-- Bookora — outreach, discovery and growth funnel tables
-- Created: 2026-10-10
--
-- The project currently applies schema changes with `prisma db push`
-- (see package.json -> "db:push"). This file is the equivalent explicit DDL so
-- the change can be reviewed and applied as a migration if you prefer:
--
--   psql "$DIRECT_URL" -f prisma/sql/0001_outreach_growth.sql
--
-- Either run this file OR `npm run db:push` — do not do both.
--
-- Idempotent: safe to run more than once. Every CREATE uses IF NOT EXISTS and
-- every constraint is added inside an existence guard (the same pattern as
-- 0002/0003), so a re-run on an already-migrated database is a no-op.

CREATE TABLE IF NOT EXISTS "outreach_campaigns" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_campaigns_code_key" ON "outreach_campaigns"("code");
CREATE INDEX IF NOT EXISTS "outreach_campaigns_active_idx" ON "outreach_campaigns"("active");

CREATE TABLE IF NOT EXISTS "outreach_prospects" (
    "id" TEXT NOT NULL,
    "publicName" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "city" TEXT,
    "country" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "publicUrl" TEXT,
    "telegramUsername" TEXT,
    "sourceUrl" TEXT,
    "sourceName" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "nextFollowUpAt" TIMESTAMP(3),
    "lastContactedAt" TIMESTAMP(3),
    "contactedCount" INTEGER NOT NULL DEFAULT 0,
    "optedOutAt" TIMESTAMP(3),
    "campaignId" TEXT,
    "convertedUserId" TEXT,
    "convertedBusinessId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_prospects_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_prospects_dedupeKey_key" ON "outreach_prospects"("dedupeKey");
CREATE INDEX IF NOT EXISTS "outreach_prospects_status_idx" ON "outreach_prospects"("status");
CREATE INDEX IF NOT EXISTS "outreach_prospects_campaignId_idx" ON "outreach_prospects"("campaignId");
CREATE INDEX IF NOT EXISTS "outreach_prospects_nextFollowUpAt_idx" ON "outreach_prospects"("nextFollowUpAt");
CREATE INDEX IF NOT EXISTS "outreach_prospects_category_idx" ON "outreach_prospects"("category");
CREATE INDEX IF NOT EXISTS "outreach_prospects_optedOutAt_idx" ON "outreach_prospects"("optedOutAt");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outreach_prospects_campaignId_fkey'
  ) THEN
    ALTER TABLE "outreach_prospects"
      ADD CONSTRAINT "outreach_prospects_campaignId_fkey"
      FOREIGN KEY ("campaignId") REFERENCES "outreach_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "invitation_templates" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "category" TEXT NOT NULL DEFAULT 'ALL',
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitation_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "invitation_templates_code_key" ON "invitation_templates"("code");
CREATE INDEX IF NOT EXISTS "invitation_templates_language_idx" ON "invitation_templates"("language");
CREATE INDEX IF NOT EXISTS "invitation_templates_active_idx" ON "invitation_templates"("active");

CREATE TABLE IF NOT EXISTS "outreach_invitations" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "templateId" TEXT,
    "campaignId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'TELEGRAM',
    "language" TEXT NOT NULL DEFAULT 'en',
    "body" TEXT NOT NULL,
    "deepLink" TEXT NOT NULL,
    "startParam" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionNote" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_invitations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_invitations_startParam_key" ON "outreach_invitations"("startParam");
CREATE INDEX IF NOT EXISTS "outreach_invitations_status_idx" ON "outreach_invitations"("status");
CREATE INDEX IF NOT EXISTS "outreach_invitations_prospectId_idx" ON "outreach_invitations"("prospectId");
CREATE INDEX IF NOT EXISTS "outreach_invitations_createdAt_idx" ON "outreach_invitations"("createdAt");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outreach_invitations_prospectId_fkey'
  ) THEN
    ALTER TABLE "outreach_invitations"
      ADD CONSTRAINT "outreach_invitations_prospectId_fkey"
      FOREIGN KEY ("prospectId") REFERENCES "outreach_prospects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outreach_invitations_templateId_fkey'
  ) THEN
    ALTER TABLE "outreach_invitations"
      ADD CONSTRAINT "outreach_invitations_templateId_fkey"
      FOREIGN KEY ("templateId") REFERENCES "invitation_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "bot_starts" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "userId" TEXT,
    "startParam" TEXT,
    "prospectId" TEXT,
    "campaignId" TEXT,
    "wasExistingUser" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_starts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "bot_starts_telegramId_idx" ON "bot_starts"("telegramId");
CREATE INDEX IF NOT EXISTS "bot_starts_startParam_idx" ON "bot_starts"("startParam");
CREATE INDEX IF NOT EXISTS "bot_starts_createdAt_idx" ON "bot_starts"("createdAt");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bot_starts_prospectId_fkey'
  ) THEN
    ALTER TABLE "bot_starts"
      ADD CONSTRAINT "bot_starts_prospectId_fkey"
      FOREIGN KEY ("prospectId") REFERENCES "outreach_prospects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bot_starts_campaignId_fkey'
  ) THEN
    ALTER TABLE "bot_starts"
      ADD CONSTRAINT "bot_starts_campaignId_fkey"
      FOREIGN KEY ("campaignId") REFERENCES "outreach_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "outreach_suppressions" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'OPT_OUT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outreach_suppressions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_suppressions_identifier_key" ON "outreach_suppressions"("identifier");
CREATE INDEX IF NOT EXISTS "outreach_suppressions_reason_idx" ON "outreach_suppressions"("reason");

CREATE TABLE IF NOT EXISTS "discovery_keywords" (
    "id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "priority" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discovery_keywords_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_keywords_group_language_term_key" ON "discovery_keywords"("group", "language", "term");
CREATE INDEX IF NOT EXISTS "discovery_keywords_enabled_idx" ON "discovery_keywords"("enabled");
CREATE INDEX IF NOT EXISTS "discovery_keywords_group_idx" ON "discovery_keywords"("group");

CREATE TABLE IF NOT EXISTS "discovery_candidates" (
    "id" TEXT NOT NULL,
    "publicName" TEXT NOT NULL,
    "publicUrl" TEXT,
    "description" TEXT,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT,
    "group" TEXT NOT NULL,
    "matchedTerms" TEXT NOT NULL DEFAULT '',
    "score" INTEGER NOT NULL DEFAULT 0,
    "city" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "discoveredOn" TIMESTAMP(3) NOT NULL,
    "reviewNote" TEXT,
    "prospectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discovery_candidates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_candidates_dedupeKey_key" ON "discovery_candidates"("dedupeKey");
CREATE INDEX IF NOT EXISTS "discovery_candidates_status_idx" ON "discovery_candidates"("status");
CREATE INDEX IF NOT EXISTS "discovery_candidates_discoveredOn_idx" ON "discovery_candidates"("discoveredOn");
CREATE INDEX IF NOT EXISTS "discovery_candidates_group_idx" ON "discovery_candidates"("group");
CREATE INDEX IF NOT EXISTS "discovery_candidates_score_idx" ON "discovery_candidates"("score");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'discovery_candidates_prospectId_fkey'
  ) THEN
    ALTER TABLE "discovery_candidates"
      ADD CONSTRAINT "discovery_candidates_prospectId_fkey"
      FOREIGN KEY ("prospectId") REFERENCES "outreach_prospects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "discovery_runs" (
    "id" TEXT NOT NULL,
    "runDate" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "discovered" INTEGER NOT NULL DEFAULT 0,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "excluded" INTEGER NOT NULL DEFAULT 0,
    "invitationsPrepared" INTEGER NOT NULL DEFAULT 0,
    "messagesSent" INTEGER NOT NULL DEFAULT 0,
    "messagesDelivered" INTEGER NOT NULL DEFAULT 0,
    "botStarts" INTEGER NOT NULL DEFAULT 0,
    "registrations" INTEGER NOT NULL DEFAULT 0,
    "activations" INTEGER NOT NULL DEFAULT 0,
    "firstBookings" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "discovery_runs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_runs_runDate_key" ON "discovery_runs"("runDate");
CREATE INDEX IF NOT EXISTS "discovery_runs_startedAt_idx" ON "discovery_runs"("startedAt");

CREATE TABLE IF NOT EXISTS "funnel_events" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "anonId" TEXT NOT NULL,
    "locale" TEXT,
    "ref" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funnel_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "funnel_events_event_idx" ON "funnel_events"("event");
CREATE INDEX IF NOT EXISTS "funnel_events_createdAt_idx" ON "funnel_events"("createdAt");
