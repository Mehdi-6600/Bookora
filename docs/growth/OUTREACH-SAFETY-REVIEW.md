# Outreach safety changes — review before deployment

This branch is **not production-ready** merely because it builds. It introduces a new additive migration, `prisma/sql/0004_outreach_safety.sql`. No SQL was applied to production by this work. The already-applied 0003 audit table is not re-run.

## Deployment ordering and verification

1. Review code, migration, test evidence and the opt-in model. Pause real outreach until reviewed.
2. With explicit production authorization and a backup/change window, apply **only 0004** to the intended Neon branch before deploying code that accesses the new table and booking column. Do not use `db:push` as a deployment step. Check that the `telegram_bot_opt_ins` PK and prospect FK/index and `bookings.isTestBooking` exist with expected types/defaults. No historical Mini App auth or legacy `bot_starts` rows are backfilled as consent.
3. Deploy the reviewed code via normal workflow; independently verify the production SHA and app alias.
4. Owner: confirm read-only settings show an explicit intended pause state; verify `GET /api/admin/telegram/webhook` reports `configured` and `matchesExpected`, and a consent test using a **controlled owner-owned account** only (not a prospect) records a fresh private `/start`. Inspect audit event persistence. Do not run a live campaign or send real outreach until approved.

## Safety contract

- A private, authenticated Bot API `/start` with an invitation's opaque parameter binds a numeric chat ID to that prospect. An unaffiliated start, username match, existing `User`, and Mini App login do not grant prospect outreach consent. `/stop` and a Telegram 403 revoke; evidence expires after 90 days. Duplicate/older Bot API update IDs cannot resurrect revoked consent. Missing opt-in storage is a hard block.
- Campaign/individual/bulk approvals require verified, contactable, nonsuppressed, currently opted-in recipients and enabled readable settings. Manual-sent marking is an attestation, not a send API, and needs prior approval, eligibility and explicit operator confirmation. The operator and timestamp are written to the audit table. Prepared DRAFT messages themselves never send.
- Each automated send records a durable `SENDING` intent with an audit event before contacting Telegram. A failed result write leaves the invitation in `SENDING` for human reconciliation **without automatic retry**; blindly resetting it risks duplicate delivery. Never call a `SENDING` record undelivered without checking Telegram-side evidence.
- Required audit writes must occur within the relevant state transition's database transaction; audit read failures are surfaced instead of masquerading as an empty timeline. For actions involving an external Telegram API call, atomicity with the remote service is impossible: the durable intent and non-retryable `SENDING` state prevent an unsafe repeat, not a distributed transaction.
- A booking is marked test only when an authenticated admin explicitly supplies `isTestBooking: true`; arbitrary public flags cannot bypass authentication. Existing bookings default to **real** (`false`), and test bookings neither emit `booking_created` nor activate a prospect or count toward first-booking totals. No existing booking is reclassified automatically.

## Known operational limitations

- Campaign dry run writes REVIEW/lastDryRunAt and an audit event; it is **not** a read-only production probe.
- Campaign message previews use a placeholder deep link. The final unique invitation link is generated during DRAFT preparation; review every DRAFT's exact message and CTA before individual approval.
- SQL 0002's pre-existing `timestamptz` and FK `ON UPDATE` differences from Prisma have not been reconciled against the production catalog. Do not infer the live schema from column names alone.
- Audit-only failures in multi-row discovery/promotion flows can return an error after earlier discovery rows were written. Do not retry a failed run without first inspecting its persisted rows. A transactional outbox for external/source-driven discovery is outside this targeted change.
