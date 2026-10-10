# Production readiness

Checked 2026-10-10, 06:20 UTC. Every line below is a live result, not an assumption.

Status labels: **VERIFIED** · **NOT VERIFIED** · **BLOCKED** · **FAILED**

---

## 1. Deployment

| Item | Status | Evidence |
| --- | --- | --- |
| PR #4 merged to `main` | **VERIFIED** | merged 2026-10-10T06:14:56Z, merge commit `6b3458a6e0630675b54a7c9d0bc031c34b0a0171` |
| Vercel production deployment | **VERIFIED — success** | deployment `6977037442`, sha `6b3458a`, environment `Production`, state `success`, completed 2026-10-10T06:16:19Z |
| New landing page live | **VERIFIED** | `bookora-pearl.vercel.app` serves the rewritten copy: "A booking page for your business. Customers pick a service and a free time — no phone calls, no back-and-forth." |
| Outreach admin routes live | **VERIFIED** | `GET /api/admin/outreach/stats` → `{"error":"Unauthorized"}` — route exists and authorization is enforced (a missing route would 404) |
| Telegram webhook admin route live | **VERIFIED** | `GET /api/admin/telegram/webhook` → `{"error":"Unauthorized"}` |
| **OG image asset** | **FAILED** | `GET /bookora-og.png` → HTTP 500. The deployed build still references the **1-byte placeholder** `bookora-logo.png`. The real asset exists on the branch but is not merged yet. |

## 2. Cron

| Endpoint | Live result | Status |
| --- | --- | --- |
| `GET /api/cron/daily-growth` | `{"error":"Cron authentication is not configured."}` (503) | **BLOCKED** — `CRON_SECRET` is not set in Vercel |
| `GET /api/cron/expire-pending` | `{"error":"Cron authentication is not configured."}` (503) | **BLOCKED** — same variable. **This is a pre-existing failure**: the pending-booking expiry job has never been able to run. |

`src/lib/security/cron-auth.ts` deliberately returns **503** rather than silently skipping when the secret is missing, so this is visible instead of quiet. It needs one environment variable.

## 3. Database

| Item | Status |
| --- | --- |
| `prisma/sql/0001_outreach_growth.sql` applied | **NOT VERIFIED** — I have no database credentials |
| `prisma/sql/0002_four_city_campaigns.sql` applied | **NOT VERIFIED** — not yet merged either |
| Schema safety | **VERIFIED** — both files are `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` only. No `DROP`, no `DELETE`, no data mutation. Both are safe to re-run. |
| Existing 12 models | **VERIFIED unchanged** — all new columns are nullable or defaulted |

**Consequence of not migrating:** the app keeps working (settings reads fall back on missing tables and every funnel write is wrapped in try/catch), but the outreach dashboard, discovery and reporting will error. The migration is a hard prerequisite for the campaign.

## 4. Telegram bot

| Item | Status |
| --- | --- |
| Bot exists | **VERIFIED** — `t.me/Bookora_App_bot`, display name "Bookora" |
| `/start` handler responds | **NOT VERIFIED** — requires `TELEGRAM_WEBHOOK_SECRET` (≥32 chars) plus one admin action |
| Webhook registered | **NOT VERIFIED** — no `setWebhook` has ever been called |
| `/help`, `/stop` commands registered | **NOT VERIFIED** |
| Mini App menu button | **NOT VERIFIED** |
| Payment handlers (`pre_checkout_query`, `successful_payment`) | **VERIFIED present in code, unchanged** |
| Webhook HMAC (`x-telegram-bot-api-secret-token`) | **VERIFIED present in code, unchanged** |

The one-shot admin action at **Admin → Outreach → Telegram bot** performs `setWebhook` + `setMyCommands` + `setChatMenuButton`. It refuses to run unless `TELEGRAM_WEBHOOK_SECRET` is set, and its GET endpoint reports `matchesExpected` so you can confirm rather than hope.

**Until this is done the bot is silent, and no attribution, opt-out or onboarding message can work.**

## 5. Code checks

| Check | Result |
| --- | --- |
| `npx vitest run` (local) | **VERIFIED — 181 tests / 18 files, all passing** |
| `npx tsc --noEmit` (local) | **73 errors** — every one traced to the Prisma client being an `any` placeholder because `prisma generate` cannot download its engine in my sandbox. Verified not to be a code defect (see below). |
| CI on PR #4 — Install → `prisma generate` → **Typecheck** → **Run tests** → **Build** | **VERIFIED — all five steps success** |
| Vercel preview build | **VERIFIED — success** |
| Netlify deploy preview | **FAILED — pre-existing and unrelated.** Identical failure on PR #3, this branch's base. A stray Netlify site is attached to a Vercel-deployed project. |

### Why the 73 local `tsc` errors are not a defect

Measured, not asserted:

| Measurement | Result |
| --- | --- |
| Clean worktree at base `708b279`, untouched, same broken client | **53 errors** |
| This branch | **73 errors** |
| Error codes present in base vs branch | **identical set** — TS7006, TS2339, TS2694, TS18046, TS2347, TS7053 |
| Every one of the 20 extra errors | Sits on a `prisma.*` or `Prisma.*` call |

All 73 are `Prisma.PrismaClientKnownRequestError` / `Prisma.Decimal` / `Prisma.*WhereInput` missing from the stub namespace, or an implicit-`any` parameter inside a `.map()` over a `prisma.*` result. CI runs `prisma generate` first and typechecks clean.

## 6. Security checks

| Control | Status |
| --- | --- |
| Admin API authorization | **VERIFIED** — live probe returns `401 Unauthorized`; every `/api/admin/**` route calls `requireAdmin()` first |
| CSRF | **VERIFIED in code** — `src/middleware.ts` applies origin checks to all `/api` POSTs; only `/api/telegram/webhook` is exempt |
| Cron authorization | **VERIFIED** — live probe returns `503` / `401`; `timingSafeEqual` comparison; secret must be ≥32 chars |
| Eligibility gate fails closed | **VERIFIED by test** — if the suppression-list read throws, the result is `NOT_ELIGIBLE`, never "eligible" |
| Opt-out | **VERIFIED by test** — `/stop` or "STOP" writes a permanent `OutreachSuppression` record checked before anything else |
| Funnel privacy | **VERIFIED by test** — only `event`, `anonId` (daily-rotating salted hash), `locale`, `ref`, `campaignId`, `createdAt` are persisted. No IP, user agent, cookie or Telegram payload |
| Telegram auth | **VERIFIED in code, unchanged** — HMAC-SHA256 over initData with a freshness window |
| Secrets | **VERIFIED** — none requested, none committed. `getEnv()` throws at import if `JWT_SECRET` < 32 chars |
| Booking validation / double-booking guard / payments | **VERIFIED unchanged** — covered by the 7 pre-existing test suites, all still passing |

## 7. Ready / not ready

**Ready:** application code, admin authorization, campaign machinery, prospect model, funnel, tests, build.

**Not ready — three owner actions block everything:**

1. **Apply the migrations** (`npm run db:push`, or run both SQL files).
2. **Set `CRON_SECRET`** (≥32 random chars) — fixes both cron jobs, including the pre-existing broken one.
3. **Set `TELEGRAM_WEBHOOK_SECRET`** (≥32 chars) and press **Configure webhook, commands and Mini App button**, then send `/start` to the bot to confirm.

**Not ready — one merge:** the four-city campaign work (this branch) is not merged, so the OG image and the campaign dashboard are not live yet.
