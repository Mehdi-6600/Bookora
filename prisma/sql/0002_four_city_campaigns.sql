-- Bookora — migration 0002: four-city market scope, verification and campaigns
--
-- Idempotent. Safe to run more than once.
-- Apply with ONE of:
--   npm run db:push
--   psql "$DIRECT_URL" -f prisma/sql/0002_four_city_campaigns.sql
--
-- Run 0001_outreach_growth.sql FIRST if the outreach tables do not exist yet.
-- Nothing here drops a table or deletes a row.

-- ---------------------------------------------------------------------------
-- outreach_campaigns: targeting + approval workflow
-- ---------------------------------------------------------------------------
ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS status          text NOT NULL DEFAULT 'DRAFT';
ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS cities          text[] NOT NULL DEFAULT '{}';
ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS segments        text[] NOT NULL DEFAULT '{}';
ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS language        text NOT NULL DEFAULT 'fa';
ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS objective       text;
ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS "templateId"    text;
ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS cta             text;
ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS "destinationUrl" text;
ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS "followUpPolicy" text NOT NULL DEFAULT 'ONE_FOLLOWUP';
ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS channel         text NOT NULL DEFAULT 'TELEGRAM_BOT';
ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS "sendLimit"     integer;
ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS "requestedById" text;
ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS "approvedById"  text;
ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS "approvedAt"    timestamptz;
ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS "lastDryRunAt"  timestamptz;
ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS "lastPreparedAt" timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outreach_campaigns_templateId_fkey'
  ) THEN
    ALTER TABLE outreach_campaigns
      ADD CONSTRAINT "outreach_campaigns_templateId_fkey"
      FOREIGN KEY ("templateId") REFERENCES invitation_templates(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS outreach_campaigns_status_idx      ON outreach_campaigns(status);
CREATE INDEX IF NOT EXISTS outreach_campaigns_templateId_idx  ON outreach_campaigns("templateId");

-- ---------------------------------------------------------------------------
-- outreach_prospects: approved city, segment and verification
-- ---------------------------------------------------------------------------
ALTER TABLE outreach_prospects ADD COLUMN IF NOT EXISTS segment         text;
ALTER TABLE outreach_prospects ADD COLUMN IF NOT EXISTS neighborhood    text;
ALTER TABLE outreach_prospects ADD COLUMN IF NOT EXISTS "verificationStatus"     text NOT NULL DEFAULT 'DISCOVERED';
ALTER TABLE outreach_prospects ADD COLUMN IF NOT EXISTS "verificationDate"       timestamptz;
ALTER TABLE outreach_prospects ADD COLUMN IF NOT EXISTS "verificationConfidence" text;
ALTER TABLE outreach_prospects ADD COLUMN IF NOT EXISTS "verificationEvidence"   text;
ALTER TABLE outreach_prospects ADD COLUMN IF NOT EXISTS "bookingRelevance"       text;
ALTER TABLE outreach_prospects ADD COLUMN IF NOT EXISTS "outreachEligibility"    text;
ALTER TABLE outreach_prospects ADD COLUMN IF NOT EXISTS "lastInteractionAt"      timestamptz;

CREATE INDEX IF NOT EXISTS outreach_prospects_city_idx                ON outreach_prospects(city);
CREATE INDEX IF NOT EXISTS outreach_prospects_segment_idx             ON outreach_prospects(segment);
CREATE INDEX IF NOT EXISTS outreach_prospects_verificationStatus_idx  ON outreach_prospects("verificationStatus");
CREATE INDEX IF NOT EXISTS outreach_prospects_city_segment_idx        ON outreach_prospects(city, segment);

-- ---------------------------------------------------------------------------
-- outreach_invitations: campaign relation
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outreach_invitations_campaignId_fkey'
  ) THEN
    ALTER TABLE outreach_invitations
      ADD CONSTRAINT "outreach_invitations_campaignId_fkey"
      FOREIGN KEY ("campaignId") REFERENCES outreach_campaigns(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS outreach_invitations_campaignId_idx ON outreach_invitations("campaignId");

-- ---------------------------------------------------------------------------
-- funnel_events: campaign attribution
-- ---------------------------------------------------------------------------
ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS "campaignId" text;
CREATE INDEX IF NOT EXISTS funnel_events_campaignId_idx ON funnel_events("campaignId");
