/**
 * Idempotent, additive migration for the outreach audit trail.
 *
 * Apply with ONE of:
 *   npm run db:push
 *   psql "$DIRECT_URL" -f prisma/sql/0003_outreach_audit.sql
 *
 * Requires 0001 and 0002 (the ten outreach tables + campaign columns) to be
 * applied already. This file only CREATEs a table and indexes — it never drops,
 * alters or deletes anything, and is safe to run more than once. Until it has
 * been applied the outreach system keeps working: audit reads/writes are
 * fail-soft by design (see src/lib/outreach/audit.ts).
 */

CREATE TABLE IF NOT EXISTS "outreach_audit_events" (
    "id"          TEXT NOT NULL,
    "scope"       TEXT NOT NULL,
    "entityId"    TEXT,
    "action"      TEXT NOT NULL,
    "actorUserId" TEXT,
    "detail"      TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outreach_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "outreach_audit_events_scope_entityId_idx"
    ON "outreach_audit_events"("scope", "entityId");
CREATE INDEX IF NOT EXISTS "outreach_audit_events_createdAt_idx"
    ON "outreach_audit_events"("createdAt");
