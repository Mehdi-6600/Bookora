# Outreach schema drift — review and the owner-approved migration

Reviewed **2026-10-11** against `prisma/schema.prisma` (commit `8dbd668`) and
`prisma/sql/0001–0004`. Nothing in this document has been executed: no SQL ran
against production, staging or a local database, and no migration was applied.

PR #14 (§11) reported three drift items. Reading both sides again, **two are
real and one does not exist as described**. Being precise matters here, because
the fix for each has a different risk profile.

| # | PR #14 claim | Verified result | Action |
| --- | --- | --- | --- |
| 1 | "`0001`/`0002` declare `TIMESTAMPTZ` while Prisma maps `DateTime` to `TIMESTAMP(3)`" | **Partly correct.** `0001` uses `TIMESTAMP(3)` everywhere (`grep -c TIMESTAMPTZ prisma/sql/0001_outreach_growth.sql` → `0`). Only `0002` adds `timestamptz` columns: `outreach_campaigns.approvedAt`, `lastDryRunAt`, `lastPreparedAt` and `outreach_prospects.verificationDate`, `lastInteractionAt`. | Real drift. Reconciled in `0005` §1. |
| 2 | "Several FKs omit `ON UPDATE CASCADE`" | **Correct.** `0002` creates `outreach_campaigns_templateId_fkey` and `outreach_invitations_campaignId_fkey` without `ON UPDATE`, while the Prisma relations default to `onUpdate: Cascade`. Whether the production constraint has the clause depends on which file created it first: `0001`'s versions do carry `ON UPDATE CASCADE`. | Real drift. Reconciled in `0005` §2 by re-creating both constraints with the clause, so the outcome is the same either way. |
| 3 | "`outreach_audit_events` … is still missing an index on `(scope, entityId, createdAt)` and on `(createdAt)`" | **The `(createdAt)` half is incorrect.** `prisma/sql/0003_outreach_audit.sql` already creates `outreach_audit_events_scope_entityId_idx` on `(scope, entityId)` **and** `outreach_audit_events_createdAt_idx` on `(createdAt)`, and `schema.prisma` declares `@@index([scope, entityId])` / `@@index([createdAt])`. Production's own state cannot be verified from here (no database credentials), so if the production table was created outside `0003` the indexes may indeed be absent. | `0005` §3 re-asserts both indexes with `CREATE INDEX IF NOT EXISTS` — cheap and safe either way. The compound `(scope, entityId, createdAt)` index is a tuning option, not a correctness fix; it stays commented out because adding it to the database **without** adding `@@index([scope, entityId, createdAt])` to `prisma/schema.prisma` would create a new drift. |

## What the drift actually costs

* `timestamptz` vs `timestamp(3)`: Postgres stores the same instant, and Prisma
  reads both correctly. The cost is (a) `prisma db push` / `migrate diff` reports
  a permanent diff, so future automated schema work is noisy, and (b) raw SQL
  comparisons that mix the two types need an explicit `AT TIME ZONE`. It is not
  a data-loss risk.
* Missing `ON UPDATE CASCADE`: only matters if a row's primary key is ever
  updated (`cuid()` ids are never updated), so today it is a schema-consistency
  issue rather than a live bug.
* Audit indexes: read performance for the admin history view. No correctness
  impact — audit reads already surface failures as `503`.

**Conclusion: none of this blocks the current pilot, and none of it is required
by the UI work in this branch.** It should be applied as its own owner-approved,
separately deployed change, which is what `prisma/sql/0005_outreach_schema_drift.sql`
is for.

## Applying it (owner action, not done here)

1. Read `prisma/sql/0005_outreach_schema_drift.sql`. Every statement is guarded
   (`information_schema` / `pg_constraint` checks) and idempotent; the file runs
   in a single transaction and never inserts, updates or deletes a row.
2. Take a database backup/export first, as for any schema change.
3. Run it once: `psql "$DIRECT_URL" -f prisma/sql/0005_outreach_schema_drift.sql`.
   Do **not** run `npm run db:push` for this: `db push` computes its own diff and
   is not the path the pilot's SQL files use.
4. Run the three verification queries at the bottom of the file and compare with
   the expectations written next to them.
5. Only after that, confirm `prisma db push` reports no further diff.

## Does anything in this repository need it?

No. `0001–0004` are sufficient for the current code, and the UI work in this
branch adds no schema requirement.
