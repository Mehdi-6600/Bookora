# Production unblock checklist — migration check + Telegram webhook

Written 2026-10-11 by the Arena agent on branch `arena/46b000ec-bookora`,
continuing from production commit `b5cf77f` (PR #10).

Scope: two open blockers stand between Bookora and the acquisition pilot —
(1) the outreach database migration status is unverified, and (2) the Telegram
webhook is unconfigured/unconfirmed. This document gives the owner a strictly
**read-only** database check and the exact webhook configuration steps.

No secret values appear anywhere in this document, and none should ever be
pasted into chat or into this repository.

---

## A. Verified findings (2026-10-11)

| # | Finding | Evidence |
| --- | --- | --- |
| 1 | Production still runs `b5cf77f` and is healthy | GitHub deployments API: newest deployment `6985662857`, sha `b5cf77f…`, environment `Production`, state `success`; no later deployment exists |
| 2 | Public app + database are live and responding | `GET /api/public/business/readiness-check` → 404 `{"error":"کسب‌وکار پیدا نشد."}` (clean DB-backed response — the `businesses`/`services` tables are readable) |
| 3 | `CRON_SECRET` remains configured | `GET /api/cron/expire-pending` → 401 `{"error":"Unauthorized"}` (not the 503 misconfiguration response) |
| 4 | Admin APIs remain deployed and authorization-enforced | `GET /api/admin/outreach/stats` and `GET /api/admin/telegram/webhook` → 401 (a missing route would 404) |
| 5 | **The three SQL files exactly cover the Prisma outreach schema** — 11 tables, 154 columns, zero divergence | programmatic diff of `prisma/schema.prisma` scalar fields vs. `CREATE TABLE`/`ADD COLUMN` statements in `prisma/sql/0001–0003` |
| 6 | **Defect found and fixed (this branch): 0001 was not re-runnable.** Its six `ADD CONSTRAINT` statements were unguarded, so re-running it on a migrated database failed with PostgreSQL `42710` ("constraint … already exists"), contradicting the runbook's "safe to run more than once". Fixed by wrapping them in the same existence guards 0002/0003 use. Verified with an embedded PostgreSQL (PGlite): fresh-run schema byte-identical to the original file; triple-run of 0001+0002+0003 error-free; 298/298 app tests still pass | reproduction + fix verification, `/tmp/pglite-test/verify.mjs` logic reproduced in PR description |
| 7 | Migration applied? | **UNKNOWN — no authorized database access from the sandbox; nothing is claimed.** The check below settles it in one paste. |
| 8 | Telegram webhook configured? | **UNKNOWN — admin-only diagnostics; owner must run the steps in §C.** |

Note on finding 5: because the SQL files and `prisma db push` produce the same
columns, the check below is valid regardless of which path was or will be used.

## B. Read-only migration check (run in the Neon SQL Editor)

Both queries only `SELECT` from `information_schema` — they read metadata,
never modify data, and are safe to run any number of times.

Neon console → your Bookora project → **SQL Editor** → paste → **Run**.

### B1. Per-table summary

```sql
SELECT t.table_name,
       t.expected_columns,
       COUNT(c.column_name) AS present_columns,
       CASE WHEN COUNT(c.column_name) = t.expected_columns THEN 'OK'
            ELSE 'INCOMPLETE' END AS status
FROM (VALUES
  ('outreach_campaigns',    23),
  ('outreach_prospects',    32),
  ('invitation_templates',   8),
  ('outreach_invitations',  20),
  ('bot_starts',             8),
  ('outreach_suppressions',  5),
  ('discovery_keywords',     8),
  ('discovery_candidates',  18),
  ('discovery_runs',        18),
  ('funnel_events',          7),
  ('outreach_audit_events',  7)
) AS t(table_name, expected_columns)
LEFT JOIN information_schema.columns c
       ON c.table_schema = 'public'
      AND c.table_name = t.table_name
GROUP BY t.table_name, t.expected_columns
ORDER BY t.table_name;
```

### B2. Exact missing items (zero rows = fully applied)

```sql
WITH expected(table_name, column_name) AS (VALUES
  ('outreach_campaigns','id'),
  ('outreach_campaigns','code'),
  ('outreach_campaigns','name'),
  ('outreach_campaigns','description'),
  ('outreach_campaigns','active'),
  ('outreach_campaigns','status'),
  ('outreach_campaigns','cities'),
  ('outreach_campaigns','segments'),
  ('outreach_campaigns','language'),
  ('outreach_campaigns','objective'),
  ('outreach_campaigns','templateId'),
  ('outreach_campaigns','cta'),
  ('outreach_campaigns','destinationUrl'),
  ('outreach_campaigns','followUpPolicy'),
  ('outreach_campaigns','channel'),
  ('outreach_campaigns','sendLimit'),
  ('outreach_campaigns','requestedById'),
  ('outreach_campaigns','approvedById'),
  ('outreach_campaigns','approvedAt'),
  ('outreach_campaigns','lastDryRunAt'),
  ('outreach_campaigns','lastPreparedAt'),
  ('outreach_campaigns','createdAt'),
  ('outreach_campaigns','updatedAt'),
  ('outreach_prospects','id'),
  ('outreach_prospects','publicName'),
  ('outreach_prospects','category'),
  ('outreach_prospects','city'),
  ('outreach_prospects','segment'),
  ('outreach_prospects','neighborhood'),
  ('outreach_prospects','country'),
  ('outreach_prospects','language'),
  ('outreach_prospects','publicUrl'),
  ('outreach_prospects','telegramUsername'),
  ('outreach_prospects','sourceUrl'),
  ('outreach_prospects','sourceName'),
  ('outreach_prospects','dedupeKey'),
  ('outreach_prospects','status'),
  ('outreach_prospects','verificationStatus'),
  ('outreach_prospects','verificationDate'),
  ('outreach_prospects','verificationConfidence'),
  ('outreach_prospects','verificationEvidence'),
  ('outreach_prospects','bookingRelevance'),
  ('outreach_prospects','outreachEligibility'),
  ('outreach_prospects','notes'),
  ('outreach_prospects','nextFollowUpAt'),
  ('outreach_prospects','lastContactedAt'),
  ('outreach_prospects','lastInteractionAt'),
  ('outreach_prospects','contactedCount'),
  ('outreach_prospects','optedOutAt'),
  ('outreach_prospects','campaignId'),
  ('outreach_prospects','convertedUserId'),
  ('outreach_prospects','convertedBusinessId'),
  ('outreach_prospects','activatedAt'),
  ('outreach_prospects','createdAt'),
  ('outreach_prospects','updatedAt'),
  ('invitation_templates','id'),
  ('invitation_templates','code'),
  ('invitation_templates','language'),
  ('invitation_templates','category'),
  ('invitation_templates','body'),
  ('invitation_templates','active'),
  ('invitation_templates','createdAt'),
  ('invitation_templates','updatedAt'),
  ('outreach_invitations','id'),
  ('outreach_invitations','prospectId'),
  ('outreach_invitations','templateId'),
  ('outreach_invitations','campaignId'),
  ('outreach_invitations','channel'),
  ('outreach_invitations','language'),
  ('outreach_invitations','body'),
  ('outreach_invitations','deepLink'),
  ('outreach_invitations','startParam'),
  ('outreach_invitations','status'),
  ('outreach_invitations','approvedAt'),
  ('outreach_invitations','approvedByUserId'),
  ('outreach_invitations','reviewedAt'),
  ('outreach_invitations','rejectionNote'),
  ('outreach_invitations','sentAt'),
  ('outreach_invitations','deliveredAt'),
  ('outreach_invitations','failureReason'),
  ('outreach_invitations','createdById'),
  ('outreach_invitations','createdAt'),
  ('outreach_invitations','updatedAt'),
  ('bot_starts','id'),
  ('bot_starts','telegramId'),
  ('bot_starts','userId'),
  ('bot_starts','startParam'),
  ('bot_starts','prospectId'),
  ('bot_starts','campaignId'),
  ('bot_starts','wasExistingUser'),
  ('bot_starts','createdAt'),
  ('outreach_suppressions','id'),
  ('outreach_suppressions','identifier'),
  ('outreach_suppressions','reason'),
  ('outreach_suppressions','note'),
  ('outreach_suppressions','createdAt'),
  ('discovery_keywords','id'),
  ('discovery_keywords','term'),
  ('discovery_keywords','group'),
  ('discovery_keywords','language'),
  ('discovery_keywords','priority'),
  ('discovery_keywords','enabled'),
  ('discovery_keywords','createdAt'),
  ('discovery_keywords','updatedAt'),
  ('discovery_candidates','id'),
  ('discovery_candidates','publicName'),
  ('discovery_candidates','publicUrl'),
  ('discovery_candidates','description'),
  ('discovery_candidates','source'),
  ('discovery_candidates','sourceRef'),
  ('discovery_candidates','group'),
  ('discovery_candidates','matchedTerms'),
  ('discovery_candidates','score'),
  ('discovery_candidates','city'),
  ('discovery_candidates','language'),
  ('discovery_candidates','dedupeKey'),
  ('discovery_candidates','status'),
  ('discovery_candidates','discoveredOn'),
  ('discovery_candidates','reviewNote'),
  ('discovery_candidates','prospectId'),
  ('discovery_candidates','createdAt'),
  ('discovery_candidates','updatedAt'),
  ('discovery_runs','id'),
  ('discovery_runs','runDate'),
  ('discovery_runs','timezone'),
  ('discovery_runs','status'),
  ('discovery_runs','discovered'),
  ('discovery_runs','matched'),
  ('discovery_runs','duplicates'),
  ('discovery_runs','excluded'),
  ('discovery_runs','invitationsPrepared'),
  ('discovery_runs','messagesSent'),
  ('discovery_runs','messagesDelivered'),
  ('discovery_runs','botStarts'),
  ('discovery_runs','registrations'),
  ('discovery_runs','activations'),
  ('discovery_runs','firstBookings'),
  ('discovery_runs','error'),
  ('discovery_runs','startedAt'),
  ('discovery_runs','finishedAt'),
  ('funnel_events','id'),
  ('funnel_events','event'),
  ('funnel_events','anonId'),
  ('funnel_events','locale'),
  ('funnel_events','ref'),
  ('funnel_events','campaignId'),
  ('funnel_events','createdAt'),
  ('outreach_audit_events','id'),
  ('outreach_audit_events','scope'),
  ('outreach_audit_events','entityId'),
  ('outreach_audit_events','action'),
  ('outreach_audit_events','actorUserId'),
  ('outreach_audit_events','detail'),
  ('outreach_audit_events','createdAt')
)
SELECT e.table_name, e.column_name, 'MISSING' AS status
FROM expected e
LEFT JOIN information_schema.columns c
       ON c.table_schema = 'public'
      AND c.table_name  = e.table_name
      AND c.column_name = e.column_name
WHERE c.column_name IS NULL
ORDER BY e.table_name, e.column_name;
```

### B3. How to interpret

| B1 result | B2 result | Meaning | Fix |
| --- | --- | --- | --- |
| all 11 rows `OK`, counts match | **zero rows** | Migrations 0001–0003 fully applied. Blocker 1 cleared. | none |
| some rows `INCOMPLETE` | lists e.g. `outreach_campaigns.status`, `outreach_prospects.segment` | 0001 applied, **0002 not** (campaign/verification columns missing) | run `prisma/sql/0002_four_city_campaigns.sql`, then B2 again |
| `outreach_audit_events` present_columns = 0 (or row missing entirely) | lists only `outreach_audit_events.*` | 0001+0002 applied, **0003 not** (audit table missing; fail-soft, non-blocking but recommended) | run `prisma/sql/0003_outreach_audit.sql` |
| all rows `INCOMPLETE` with present_columns = 0 | lists many/all columns | **nothing applied yet** | run 0001, then 0002, then 0003 (in order), or `npm run db:push` from a machine with `DATABASE_URL`/`DIRECT_URL` |

Notes:

- **Idempotency:** on this branch all three SQL files are safe to re-run
  (0001's constraints are now existence-guarded — see finding 6). If you take
  the 0001 file from `main` before that fix merges, run it **once only**; a
  re-run aborts with error 42710 (harmless to the schema, but alarming).
- There is **no `_prisma_migrations` table to look for** — this project uses
  `prisma db push` / raw SQL, not `prisma migrate`. Its absence is normal.
- All three SQL files are additive (`CREATE TABLE IF NOT EXISTS`,
  `ADD COLUMN IF NOT EXISTS`, guarded constraints) — they never drop or delete.
- The 12 base tables (`users`, `businesses`, …) are already proven live by
  finding 2 and are not covered by 0001–0003.

## C. Telegram webhook configuration (exact steps)

The admin panel only works **inside the Telegram Mini App** (it signs you in
with Telegram `initData`; a plain browser shows a "open in Telegram" fallback).

Prerequisite (one-time, in Vercel → Bookora → Settings → Environment
Variables): `TELEGRAM_WEBHOOK_SECRET` must exist with a random value of **at
least 32 characters**, applied to Production, followed by a **Redeploy**. Never
paste the value anywhere outside Vercel. If it is missing, the configure
button responds with a 503 error that says exactly that.

Steps:

1. Open Telegram → **@Bookora_App_bot** → send `/start` (or press **Start**).
2. Press the **«شروع راه‌اندازی» / "Start setup"** button in the bot's reply —
   it opens the Bookora Mini App.
3. In the Mini App header, tap **«پنل ادمین» / "Admin panel"** (visible only
   for admin accounts). If it does not appear, your Telegram ID is not in the
   `ADMIN_TELEGRAM_IDS` environment variable (or the DB admin flag is unset) —
   fix that in Vercel, then reopen the Mini App.
4. Tap the **«جذب مشتری» / "Outreach"** tab.
5. Tap the **«ربات تلگرام» / "Telegram bot"** sub-tab.
6. Press **«تنظیم وب‌هوک، دستورها و دکمه‌ی مینی‌اپ» / "Configure webhook,
   commands and Mini App button"**. On success you see
   "Telegram configuration updated."
   (This performs `setWebhook` + `setMyCommands` + `setChatMenuButton` and
   never discards pending updates.)
7. The **"Current Telegram configuration"** card shows a JSON block. Read:
   - `"configured": true` — the webhook secret is set and Telegram answered;
   - `"matchesExpected": true` — Telegram's webhook URL is exactly
     `https://bookora-pearl.vercel.app/api/telegram/webhook`;
   - `info.last_error_message` should be absent/null.
   If `matchesExpected` is `false`, press **"Refresh status"**
   («به‌روزرسانی وضعیت») once, then re-check; if still false, press the
   configure button again.
8. **Verify end-to-end:** in the same bot chat send `/start` again. The bot
   must reply within a few seconds with the welcome message
   (English: "Welcome to Bookora 👋" with the 4 setup steps; Persian:
   «به بوکورا خوش آمدید 👋») and a **«شروع راه‌اندازی» / "Start setup"**
   button. A reply proves the full loop: Telegram → webhook → Bookora →
   Telegram.

Failure modes (from the code, so you can self-diagnose):

| Symptom | Cause | Fix |
| --- | --- | --- |
| Configure button errors with "TELEGRAM_WEBHOOK_SECRET is not configured (minimum 32 characters)…" | env var missing/short | set it in Vercel (Production), redeploy, press configure again |
| "Telegram rejected the configuration request." | Bot API rejected `setWebhook` — usually `TELEGRAM_BOT_TOKEN` not matching @Bookora_App_bot | confirm the token belongs to this bot in @BotFather, then retry |
| Configuration card shows `"configured": false` | same as the first row | same fix |
| `/start` gets no reply but card shows `configured: true, matchesExpected: true` | see `info.last_error_message` in the card; also confirm you are messaging @Bookora_App_bot exactly | press configure again; if it persists, check `pending_update_count` in the card |

## D. Exact remaining blockers (in order)

1. **Database migration status unknown** → settle with §B (2 minutes,
   read-only). If incomplete → apply the missing SQL file(s).
2. **Telegram webhook unconfigured/unconfirmed** → §C (5 minutes).
3. Prospect shortlist remains ON HOLD by owner decision (2026-10-10) — not a
   blocker for readiness, it is the next decision after 1–2 are cleared.

## E. Next action

Run **§B2** in the Neon SQL Editor and **§C steps 1–8** on your phone. If B2
returns zero rows and step 8's `/start` gets the welcome reply, both readiness
blockers are cleared with evidence, and the next decision (the on-hold
five-business shortlist) becomes the only thing between Bookora and its first
outreach pilot.
