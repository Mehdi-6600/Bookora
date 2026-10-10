# First Customer Acquisition Pilot — Readiness Report

Produced 2026-10-10 against branch base `b5cf77f` (= current `main`).
Every line is either a measured result or is explicitly marked **INACCESSIBLE**.
Nothing here is an assumption presented as a fact.

---

## 0. Headline

| Question | Answer |
| --- | --- |
| Is PR #10 merged and deployed to production? | **YES — verified with GitHub/Vercel API evidence** |
| Could I run the live admin / webhook / database checks? | **NO — hard blocked.** No network egress to Vercel or Telegram, and no production credentials in this environment |
| Is the verification safeguard present in preparation, approval and delivery? | **YES — verified in code and by test, all three paths** |
| Are there 3–5 genuine, verifiable prospects? | **YES — 5 verified, with source URLs. Pending owner approval. Nothing imported.** |
| Is a dry run available? | **NO — requires production DB + admin session. Blocked, not skipped.** |
| Can the first booking be measured honestly today? | **NO — reproducible defect found. See §6.** |
| Has a customer been acquired? | **NO. Zero customers. This report does not claim otherwise.** |

---

## 1. Phase 1 — Production readiness, check by check

### 1.1 PR #10 merged and production deployment successful — **PASS (verified)**

| Item | Exact evidence |
| --- | --- |
| PR #10 state | `MERGED` — "Gate outreach invitations on prospect verification" |
| Merged at | `2026-10-10T19:16:49Z` |
| Merge commit | `b5cf77f8a8728eb2d58a8c5d646d2111c26b5c54` |
| Base ← head | `main` ← `arena/692bf45e-bookora` |
| PR URL | https://github.com/Mehdi-6600/Bookora/pull/10 |
| Vercel deployment | id `6985662857`, environment `Production`, creator `vercel[bot]` |
| Deployment SHA | `b5cf77f8a8728eb2d58a8c5d646d2111c26b5c54` — **matches the merge commit exactly** |
| Deployment state | `success` — "Deployment has completed" |
| Deployment created / completed | `2026-10-10T19:17:35Z` / `2026-10-10T19:17:36Z` |
| **Deployment URL** | `https://bookora-rsw8jzpnz-ai-image-app.vercel.app` (immutable deployment URL, both `environment_url` and `target_url`) |
| Vercel inspect URL | https://vercel.com/ai-image-app/bookora/DNRPsfJ4n9UKv2yuoRNTsPtutRhm |
| Combined commit status | `state: success`, `total_count: 1`, context `Vercel` |
| CI check on `b5cf77f` | `test` — status `completed`, conclusion **`success`**, completed `2026-10-10T19:18:14Z` — https://github.com/Mehdi-6600/Bookora/actions/runs/38079167660/job/114292338912 |

The `Production` deployment immediately preceding this one was `09507cb` at `18:51:00Z`; `b5cf77f` is the newest Production deployment and is the one currently live.

**Production alias domain:** the docs reference `https://bookora-pearl.vercel.app`. That is the human-facing alias; `bookora-rsw8jzpnz-ai-image-app.vercel.app` is the deployment-specific URL for this exact SHA. **I could not re-verify the alias is pointed at `b5cf77f` — see §1.2.**

### 1.2 Live admin screens (Overview, Prospects, Discovery, Campaigns) — **INACCESSIBLE**

Not skipped, not assumed — genuinely unreachable from this environment. Two independent hard blockers:

**(a) No network egress.** Outbound traffic is allowlisted to `github.com`, `api.github.com`, `codeload.github.com`, `registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org`. Measured:

```
bookora-pearl.vercel.app   → DNS resolves (64.29.17.131) → TLS ClientHello sent
                             → OpenSSL SSL_connect: SSL_ERROR_SYSCALL   (http=000)
bookora-rsw8jzpnz-…        → same failure
vercel.com                 → same failure
api.telegram.org           → same failure
api.github.com             → http=200   ← control, proves the tooling works
```

DNS succeeds and the TCP connection is established; the TLS handshake is terminated. This is an egress policy block, not a Bookora outage. **I cannot state whether the live site is healthy, because I never reached it.**

**(b) No credentials.** The sandbox has no `.env` and no environment variables set. Verified absent: `DATABASE_URL`, `DIRECT_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `JWT_SECRET`, `CRON_SECRET`, `APP_URL`, `ADMIN_TELEGRAM_IDS`. Only `.env.example` (all values empty) is present. Even with network access, `/admin` and every `/api/admin/**` route requires an authenticated admin Telegram session — I have none and must not fabricate one.

**Owner action to close this:** run the four GETs in §7 yourself while logged in as admin. Each is read-only.

### 1.3 Migration status — **PARTIALLY VERIFIED (code side verified, production side INACCESSIBLE)**

What I verified in the repository:

| Item | Result |
| --- | --- |
| `prisma/migrations/` directory | **Does not exist.** This project deliberately uses `prisma db push`, not a migration history (documented in `README.md`). So "migration status" = "has the schema been pushed / have the SQL files been run". There is no `_prisma_migrations` history to inspect. |
| SQL files present | `prisma/sql/0001_outreach_growth.sql`, `0002_four_city_campaigns.sql`, `0003_outreach_audit.sql` |
| Tables created by `0001` | `outreach_campaigns`, `outreach_prospects`, `invitation_templates`, `outreach_invitations`, `bot_starts`, `outreach_suppressions`, `discovery_keywords`, `discovery_candidates`, `discovery_runs`, `funnel_events` (10 tables) |
| `0002` adds | campaign columns (`status`, `cities`, `segments`, `language`, `objective`, `templateId`, `cta`, `destinationUrl`, `followUpPolicy`, `channel`, `sendLimit`, `requestedById`, `approvedById`, `approvedAt`, `lastDryRunAt`, `lastPreparedAt`) and prospect columns (`segment`, `neighborhood`, `verificationStatus`, `verificationDate`, `verificationConfidence`, `verificationEvidence`, `bookingRelevance`, `outreachEligibility`, `lastInteractionAt`) |
| `0003` adds | `outreach_audit_events` + 2 indexes. Requires `0001` and `0002` first. |
| **Safety scan** | Every statement is `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, or `ALTER TABLE … ADD COLUMN IF NOT EXISTS`. **Zero `DROP`, zero `DELETE`, zero `TRUNCATE`, zero `UPDATE`.** The only matches for those words are `ON DELETE SET NULL` / `ON UPDATE CASCADE` inside foreign-key clauses. All three files are safe to re-run. |
| Schema drift risk | `verificationStatus String @default("DISCOVERED")` and `city` ("Approved city code… Never free text") exist in `prisma/schema.prisma` and depend on `0002` having been applied. |

What I could **not** verify: whether any of the three files has actually been executed against the production Neon database. `docs/growth/PRODUCTION-READINESS.md` recorded all three as **NOT VERIFIED** at `2026-10-10 06:20 UTC` — that is ~13 hours *before* the PR #10 deploy, and I have no way to re-check it. **Treat that document's database row as stale, not as current truth.**

Consequence if unapplied (from code, not guesswork): `getOutreachSettings()` catches the missing-table error and returns defaults, and audit is fail-soft, so the app keeps serving — but the Outreach dashboard, Discovery and Campaigns screens will error. Exact probe in §7.

### 1.4 Telegram webhook diagnostics (`configured: true`, `matchesExpected: true`) — **INACCESSIBLE**

I verified the endpoint's contract in code (`src/app/api/admin/telegram/webhook/route.ts`) but cannot call it (no egress to `api.telegram.org`, no admin session, no `TELEGRAM_WEBHOOK_SECRET`).

Exact behaviour I confirmed by reading the route:

- `GET` requires admin. If `TELEGRAM_WEBHOOK_SECRET` is missing or `< 32` chars, it returns **HTTP 200** with `{ configured: false, reason: "TELEGRAM_WEBHOOK_SECRET is missing or shorter than 32 characters…", expectedUrl }` — note this is a *200*, not an error, so a green-looking response can still mean "not configured". Read the `configured` field, not the status code.
- If the secret is set, it calls `getWebhookInfo()` and returns `{ configured: true, expectedUrl, info: {url, pending_update_count, last_error_date, last_error_message, …}, matchesExpected: info.url === webhookUrl() }`.
- `expectedUrl` is derived as `${APP_URL}/api/telegram/webhook`. So `matchesExpected: true` also proves `APP_URL` is set to the real public HTTPS domain.
- If Telegram cannot be reached it returns **502** `{ error: "Could not reach the Telegram Bot API." }`.
- No secret value is ever returned by this route — it only reports length sufficiency. Consistent with the "never expose secrets" rule.

`PRODUCTION-READINESS.md` (06:20 UTC) recorded "Webhook registered: **NOT VERIFIED** — no `setWebhook` has ever been called". Stale, unconfirmed by me. **Until the owner confirms `configured: true` and `matchesExpected: true`, the bot is silent and no attribution, opt-out or onboarding message can work.**

### 1.5 Verification safeguard in preparation, approval and delivery — **PASS (verified in code and by test)**

All three gates required by PR #10 are present at `b5cf77f`:

| Path | File / line | Verified behaviour |
| --- | --- | --- |
| **Preparation** | `src/lib/outreach/invitations.ts:110` | `prepareInvitations` where-clause hard-codes `verificationStatus: "VERIFIED"`, plus `optedOutAt: null` and `status: { in: ["NEW","INTERESTED","CONTACTED","STARTED_BOT"] }`. `STARTED_BOT` inclusion closes the dry-run/preparation status mismatch. |
| **Approval** | `src/app/api/admin/outreach/invitations/[id]/route.ts:62-79` | `PATCH` loads `prospect.verificationStatus`; returns **HTTP 409** `"Only VERIFIED prospects can be approved for outreach."` with the current status in the body unless it is exactly `"VERIFIED"`. |
| **Delivery** | `src/lib/outreach/invitations.ts:264,278-291` | `sendApprovedInvitations` re-reads `verificationStatus` per recipient and, if not `"VERIFIED"`, writes `status: "SKIPPED"`, `failureReason: "not_verified"`, `reviewedAt: now()` and **continues without sending**. This closes the approve→unverify→send race. |
| **Planning** | `src/lib/outreach/campaigns.ts` (`planCampaign`) | Only `VERIFIED` prospects become recipients; `DISCOVERED` and `REJECTED` are excluded. |
| **Discovery** | `src/lib/outreach/discovery.ts:546,647` | Comment: *"Promoted prospects are ALWAYS created as DISCOVERED (unverified)"*; the create call hard-codes `verificationStatus: "DISCOVERED"`. Reinforced by the column default. |

Tests, run locally at this exact SHA:

- `src/lib/__tests__/outreach-verification.test.ts` — 6 tests: DISCOVERED excluded, VERIFIED included, REJECTED excluded, DISCOVERED→VERIFIED stamps `verificationDate`, re-verify does not move the date, →REJECTED allowed.
- `src/lib/__tests__/outreach-invitations.test.ts` — 21 tests, includes verified-only prepare, `STARTED_BOT` prepare, send-time skip.
- `src/lib/__tests__/outreach-invitations-route.test.ts` — 4 tests: auth, approve gate 409/200, list visibility.

Deliberate, documented exceptions (unchanged by PR #10, and safe because the send-time gate covers them): bulk campaign approval and `mark_manual_sent`. `mark_manual_sent` records a human action already taken; it is not automated delivery.

### 1.6 Local build/test evidence at `b5cf77f` — **PASS**

| Check | Result |
| --- | --- |
| `npx vitest run` | **298 tests / 27 files — all passed, 0 failed.** Duration 14.90s, vitest 2.1.9, Node v22.22.3 |
| `npx tsc --noEmit` | 107 errors — **all Prisma-stub artifacts, not code defects** (see below) |
| `npm ci` | `postinstall: prisma generate` **fails**: `https://binaries.prisma.sh/…/schema-engine.gz.sha256` — host not in the egress allowlist. Reproduces exactly the limitation documented in `PRODUCTION-READINESS.md`. |

Why the 107 `tsc` errors are environmental, measured not asserted: error codes are TS7006 (66), TS2339 (29), TS2694 (5), TS18046 (4), TS2347 (2), TS7053 (1) — the identical set documented for the base branch. They are implicit-`any` parameters inside `.map()` over `prisma.*` results and missing members on the stub `Prisma` namespace (e.g. `Namespace '.prisma/client/default'.Prisma has no exported member 'BusinessWhereInput'`). CI runs `prisma generate` **before** `npm run typecheck` (`.github/workflows/test.yml`), and the `test` check on `b5cf77f` concluded **success** — so typecheck is clean in an environment with a real Prisma client.

**No reproducible code defect was found in the outreach or booking paths, so no new PR was opened** (per the task rule). The one genuine defect found is in §6 and needs an owner decision, because fixing it requires a production schema change.

---

## 2. Phase 2 — Acquisition configuration as it actually stands

All values below are read from source at `b5cf77f`. Where a value lives in the database, the **code default** is given and marked as such — the live value is unknown to me.

### 2.1 Settings (`src/lib/outreach/settings.ts`, stored in `admin_settings`)

| Setting key | Code default | Bounds |
| --- | --- | --- |
| `outreach.enabled` | `true` | boolean |
| `outreach.auto_send_enabled` | `true` | boolean |
| `outreach.daily_discovery_limit` | **50** | 0–500 (`MAX_DAILY_DISCOVERY_LIMIT`) |
| `outreach.daily_invitation_limit` | **10** | 0–100 (`MAX_DAILY_INVITATION_LIMIT`) |
| `outreach.min_score` | **30** | 0–100 |
| `outreach.timezone` | `UTC` | must normalize to a valid IANA zone |
| `outreach.run_local_hour` | `6` | 0–23 |
| `outreach.feed_enabled` | `false` | boolean |
| `outreach.feed_url` | `""` | https only, ≤2000 chars |
| `outreach.channel_url` | **`""` (empty)** | https only, ≤500 chars. **No fallback is ever invented** — with it empty, the message builder refuses the "channel" destination rather than guessing a link |
| `outreach.cities_enabled` / `_disabled` | `[]` / `[]` | registry codes, capped at `MAX_CAMPAIGN_CITIES` |
| `outreach.manual_seed` | `[]` | the imported prospect seed (JSON, ≤1000 entries) |

Guard rails worth stating: `clampDiscoveryLimit` / `clampInvitationLimit` mean **the system never raises its own limits**. `getOutreachSettings()` catches a missing `admin_settings` table and returns all defaults, so a missing migration degrades silently to defaults instead of crashing. `getCityApprovalOverrides()` fails **closed-narrow**: on a read error both lists come back empty, so the effective approved set stays exactly the four launch cities — a read error can never widen outreach scope.

Vercel crons (`vercel.json`): `/api/cron/expire-pending` at `0 2 * * *`, `/api/cron/daily-growth` at `0 6 * * *`. Both are daily because a Vercel Hobby plan fails the whole deployment for any more frequent expression. Both require `CRON_SECRET` ≥ 32 chars and **fail closed with 503** if it is missing or too short.

### 2.2 Supported markets (`src/lib/outreach/city-registry.ts`)

- Registry is **Iran-only** (`country: "IR"`), up to 100 cities registered.
- **Approved by default (the launch four): `TEHRAN`, `MASHHAD`, `KARAJ`, `SHIRAZ`.**
- Registered but **NOT** approved by default: `ISFAHAN`, `TABRIZ`, `AHVAZ`, `QOM`, `KERMANSHAH`, `URMIA`, `RASHT`, `KERMAN`, `HAMADAN`, `KHORRAMABAD`, `ARDEBIL`, `BANDAR_ABBAS`, `ZAHEDAN`, and others.
- Unapproved cities are *known* but not *usable*: targeting one fails campaign validation until an admin approves it (Admin → Outreach → Campaigns → Markets). Approving unlocks **targeting only** — it never imports prospects and never sends anything.
- Segments (`src/lib/outreach/cities.ts:86`): exactly **`MENS_BARBER`** and **`WOMENS_SALON`**.
- `OutreachProspect.city` is documented as *"Approved city code: TEHRAN | MASHHAD | SHIRAZ | KARAJ. Never free text."*
- `resolveCity()` accepts a canonical code (passes through untouched), an exact alias in Persian or Latin (`کرج`, `karaj`, `KARAJ`), or scans free text — but **auto-detection is deliberately restricted to the four approved cities**, and returns `AMBIGUOUS` (→ no assignment, a human must decide) when a listing mentions more than one. That is the explicit Karaj-vs-Tehran guard.

### 2.3 Configured keywords (`src/lib/outreach/keywords.ts`)

**32 starter keywords** (confirmed by executing `resolveKeywordSet([])` — it returns `source: "starter"`, `configuredCount: 0`, 32 keywords), held **in memory only** until an admin saves rows — nothing is written to `discovery_keywords` on a fresh install. Groups: `BARBER`, `BEAUTY`, `MEDICAL`, languages `en` and `fa`.

- BARBER (11): barber, barbershop, hairdresser, hairstylist, men's salon, mens salon, grooming · آرایشگر مردانه، پیرایشگاه، آرایشگاه مردانه، سلمانی
- BEAUTY (11): beauty salon, makeup artist, nail technician, nail salon, lash artist, salon · سالن زیبایی، ناخن کار، ناخن‌کار، میکاپ آرتیست، آرایشگاه زنانه
- MEDICAL (10): doctor, dentist, dermatologist, physiotherapist, clinic · پزشک، دندانپزشک، متخصص پوست، فیزیوتراپی، کلینیک

Scoring: `GROUP_FIT_BONUS` = BARBER +15, BEAUTY +15, MEDICAL +5, capped at 100. Matching runs on `foldText` (Persian/Arabic letter unification, diacritic and ZWNJ stripping), so spelling variants compare equal.

`resolveKeywordSet()` behaviour is important: **zero rows → the starter set applies in memory; one or more rows → ONLY the enabled rows apply.** If an admin disables every keyword on purpose, discovery reports `keywords_disabled` rather than silently re-enabling the starter set.

### 2.4 Seed sources (`src/lib/outreach/sources.ts`)

Exactly **two**, and the module states it deliberately does **not** search Telegram users:

> *"Telegram provides no API for discovering users or businesses by keyword, and scraping would violate its terms."*

1. **`manual`** — always enabled. Public business pages an administrator pastes into the dashboard, stored as JSON in `admin_settings` under `outreach.manual_seed`. The administrator is the one who saw and verified the page, so this is authorized by construction.
2. **`feed`** — **disabled by default** (`feed_enabled: false`, `feed_url: ""`). An HTTPS JSON endpoint the admin configures and has permission to use. 10s timeout; failures return explicit `issue` codes (`feed_http_error`, `feed_timeout`, `feed_invalid_payload`, `feed_unavailable`) instead of invented rows.

Both return **only public information**: public name, public URL, public description, city. Row validation is strict and reports every problem (`validateSeedItems` → `SeedRowProblem[]`) so nothing is dropped silently: name required; URL must pass `validatePublicProfileUrl` (http/https only, no credentials, no `.local`/`.internal`/bare-IP host, ≤500 chars, no whitespace); Telegram username must match `^[a-z0-9_]{4,32}$`. The URL is **stored, never fetched** — so importing a prospect cannot be used to probe anything.

Deduplication identity (`buildDedupeKey`): Telegram username → normalized public URL → folded name (+city) → hash. Suppression identity prefers the Telegram username, then numeric id, then URL.

---

## 3. Phase 2 — Blockers (reported before changing anything)

Ordered by how much they block. **Nothing was changed, imported, promoted or written.**

| # | Blocker | Evidence | Severity |
| --- | --- | --- | --- |
| **B1** | **Automated Telegram outreach cannot reach cold prospects — by design and by law.** `checkEligibility()` requires a numeric `telegramUserId` **and** an existing `User` row, which is only created after the person presses Start in the bot. `resolveTelegramUserId()` never guesses an id from a username ("Telegram offers no public API to turn a username into a user id"). | `src/lib/outreach/eligibility.ts` | **Structural.** The first customer cannot come from automated sending. It must come from manual, human-sent outreach. |
| **B2** | **No production access from this environment.** No egress to Vercel/Telegram (§1.2a) and no credentials (§1.2b). | measured | **Blocks** Phase 1.2, 1.4, all of Phase 3, and live Phase 4. |
| **B3** | **Migration state unknown.** `PRODUCTION-READINESS.md` said NOT VERIFIED at 06:20 UTC; I cannot re-check. If `0001`–`0003` are unapplied, Outreach/Discovery/Campaigns error. | §1.3 | **Blocks** any prospect import or dry run. |
| **B4** | **Webhook almost certainly not configured.** Documented as never-registered at 06:20 UTC; unverifiable by me. Until `configured: true` **and** `matchesExpected: true`, the bot is silent → no `/start`, no attribution, no opt-out. | §1.4 | **Blocks** attribution and B1's only automated path. |
| **B5** | **`CRON_SECRET` documented as unset.** Both crons fail closed with 503. This also breaks `expire-pending`, a **pre-existing** failure — stale payment holds have never been expired by the backstop job (in-transaction expiry still protects slot availability, so bookings are safe). | `README.md`, `PRODUCTION-READINESS.md` §2 | **Blocks** the daily discovery/invitation/report run. |
| **B6** | **`outreach.channel_url` is empty by default.** The message builder refuses the "channel" destination instead of inventing a link. `OWNER-RUNBOOK.md` step 5 instructs the owner to enter `https://t.me/spell0000` and confirm the read-back. | §2.1, `src/lib/outreach/message.ts:15-19` | **Blocks** any campaign that selects the channel destination. |
| **B7** | **The first booking is not honestly measurable.** No test-booking flag exists, yet two docs claim test bookings are excluded. Full detail in §6. | `prisma/schema.prisma`, `src/lib/outreach/attribution.ts:68` | **Blocks the success criterion itself.** |
| **B8** | **The market is not empty.** Iran already has several salon booking products — `manaray.ir` is a near-exact feature match ("لینک اختصاصی رزرو برای مشتری" = a dedicated booking link per business, SMS reminders, reports), plus `nobatpro.com`, `salon20.ir`, `ziber.ir`, `nikaraa.ir`. | web research, §4.3 | **Strategic.** Bookora must win on differentiation, not novelty. |
| **B9** | **Top-of-list salons already have booking systems.** `saeedpourandokht.com/reservation/` is a complete self-serve flow (service → provider → date/time → deposit payment). `asbarber.com` also surfaces a "رزرو آنلاین" element. | §4.1 | **Strategic.** Corrects the prior research doc — see §4.2. |

---

## 4. Phase 2 — Proposed pilot shortlist (5 businesses, **pending owner approval**)

Nothing here has been imported, promoted, verified or contacted. Every row is a real, publicly listed business, independently confirmed on 2026-10-10 from public pages. **No private information was scraped and no contact detail was invented.** Phone numbers and email addresses are deliberately **not** reproduced in this report; where a directory publishes them, the source URL is given so the owner can retrieve them there.

### 4.1 The shortlist

Ranked by pilot suitability, not by fame.

| # | Business | City (code) | Segment | Own public page | Booking today | Fit |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **آرایشگاه VIP داماد و تخصصی هری کاتر** (Harry Cutter) — محمد کلانتری | Shiraz (`SHIRAZ`) | `MENS_BARBER` | https://harrycutter.ir | **Phone** — a directory states "حتما برای رزرو نوبت، یک روز قبل تماس حاصل فرمایید" (call a day ahead to book) | **Best greenfield fit.** Own website + published packages with prices + daily hours 10–21 + already selling appointment slots on a deals platform → understands appointment commerce, has no self-serve booking |
| 2 | **سالن زیبایی و عروس‌سرای رازمنا** (Razmena) | Karaj (`KARAJ`) | `WOMENS_SALON` | https://razmenasalon.ir | **Phone** — "جهت … رزرو نوبت با شماره‌های بالا تماس برقرار کنید" | **Strong.** 20–25 yrs, own website, published hours (Sat–Wed 9–21, Thu–Fri 10–18), broad service menu → many bookable services, women's segment |
| 3 | **مجموعه آرایشگاهی یونیک** (Unique Barber Club) | Mashhad (`MASHHAD`) | `MENS_BARBER` | https://uniquebarberclub.com | **Ambiguous** — homepage carries a "رزو نوبت / رزو وقت" CTA, but every directory routes to phone | **Strong but verify first.** Most digitally mature of the five: own site with `/about-us/`, ~114K Instagram followers, 20 yrs, 9:30–21:00 daily. If that CTA is dead or phone-backed, this is the highest-capacity prospect |
| 4 | **مجموعه سالن‌های آرایشگاهی آس** (AS Barber) — محمد کاشانی | Tehran (`TEHRAN`) | `MENS_BARBER` | https://asbarber.com | **Likely already has something** — a "رزرو آنلاین" element appears on the site; also lists "تلفن هماهنگی و رزرو نوبت" | **Verify before contacting.** Since 1376 (1997); four lines (men, VIP groom, kids, academy) → genuinely needs multi-service scheduling. But may be a displacement sale, not a greenfield one |
| 5 | **سالن سعید پورانداخت** (Saeed Pourandokht) | Tehran (`TEHRAN`) | `MENS_BARBER` | https://saeedpourandokht.com | **Already has full online booking** — https://saeedpourandokht.com/reservation/ (service → provider → date/time → **deposit payment**) | **Displacement target only.** Do not pitch as "get your first booking link" |

### 4.2 Correction to the existing research document — read this before using `PROSPECTS-FOUR-CITIES.md`

`docs/growth/PROSPECTS-FOUR-CITIES.md` calls سعید پورانداخت the **"Strongest fit signal found anywhere"**, because the `injakhube.ir` listing annotates it "تلگرام: رزرو وقت" (Telegram: appointment booking), and reads that as *"already taking bookings over a messaging app — it only needs the tool."*

**My verification contradicts that conclusion.** The business already runs a complete self-serve online booking system at `https://saeedpourandokht.com/reservation/` — service selection, staff/provider selection, date and time, customer details, **and deposit payment** ("پرداخت بیعانه", with both "هزینه کامل خدمات" and "پرداخت هزینه بیعانه" amounts in تومان). Its per-service pages carry "رزرو آنلاین این خدمات". Opening hours are published (Sat–Thu 9–20, Fri 10–19).

So this is a business that has **already bought and deployed** exactly what Bookora sells. The correct framing is *competitor displacement* — a harder, longer sale — not *greenfield adoption*. I am flagging this rather than repeating the earlier claim, because presenting it as the top prospect would send the owner into the least winnable first conversation.

Two further data-quality issues found in the same research, both requiring manual resolution before any contact:

- **هری کاتر Telegram handle conflicts across sources:** `harrycutteriran` (`shirazkojo.ir`) vs `@Harry_cutter` (`shirazlux.ir`). Also two Instagram spellings: `harry_cutter.ir` vs `harrycutter.ir`.
- **آس Instagram handle conflicts:** `mohammadkashani_kbc` (`dartehran.com`) vs `ace.mensclub` (`handy-man.ir`).

Because of this, **the seed file in §5 sets `telegramUsername: null` for all five.** The system's own rule is never to guess an identity, and a wrong handle poisons both the dedupe key (`tg:<username>`) and the suppression identity — which could permanently suppress the wrong business. Candidate handles are listed in §4.3 for the owner to confirm by opening each profile, then enter in the Prospects tab.

### 4.3 Published Telegram handles found (unconfirmed — **do not use until the owner opens the profile**)

| Business | Handle as published | Source | Attestations |
| --- | --- | --- | --- |
| هری کاتر | `harrycutteriran` | https://shirazkojo.ir/the-best-barbershops-for-men-in-shiraz/ | 1 — **conflicts** with `@Harry_cutter` on https://shirazlux.ir/best-barber-men-shiraz/ |
| رازمنا | `aroose_razmena` | https://salamzibaei.com/the-best-beauty-salon-in-karaj/ | 1 for Telegram (same string is the Instagram handle on 3 other directories) |
| یونیک | `uniquecopmlex` | https://faratat.com/mashhad/beauty-services/… | 1 — note the string looks like a typo of "complex"; treat as low confidence |
| آس | — | none found | 0 |
| پورانداخت | — | none found; the listing says only "تلگرام: رزرو وقت" with no handle | 0 |

Even a **correct** handle does not make a business messageable: `resolveTelegramUserId()` returns `null` unless a `User` row already exists, and per B1 a bot may only DM someone who pressed Start. These handles are for the owner's manual outreach, not for automated delivery.

### 4.4 Source URLs (full audit trail)

**هری کاتر — Shiraz**
- https://shirazkojo.ir/the-best-barbershops-for-men-in-shiraz/ — own website, IG, Telegram, address, phone
- https://shirazlux.ir/best-barber-men-shiraz/ — rank 1, IG, Telegram, full package prices
- https://iran-plaza.ir/best-mens-barber-shop-shiraz/ — rank 1, founder name, address, services
- https://talareto.com/the-best-mens-barber-shop-in-shiraz/ — packages, hours 10–21, management
- https://behtarinsalon.com/shiraz/shiraz-groom-barbershop/ — address, phone, IG, rating
- https://shiraztakhfif.com/ — sells "اصلاح تخصصی داماد" at ۳,۵۰۰,۰۰۰ → ۱,۷۵۰,۰۰۰ تومان (proves appointment commerce)
- https://www.karshod.ir/job/سالن-پیرایش-VIP-شیراز — **"call a day ahead to book"** (the greenfield evidence)

**رازمنا — Karaj**
- https://gzlocation.com/the-best-beauty-salon-in-karaj/ — address, IG `aroose_razmena`, hours, services
- https://salamzibaei.com/the-best-beauty-salon-in-karaj/ — Telegram `aroose_razmena`, IG, email domain `razmena.ir`
- https://avalshahr.com/best-beauty-salon-in-karaj/ — hours Sat–Wed 9–21 / Thu–Fri 10–18, IG `razmena.beauty` + `aroose_razmena`
- https://karajyaab.ir/best-beauty-salon-in-karaj/ — own website `www.razmenasalon.ir`, 25 yrs, full service list
- https://pezeshkkaraj.com/بهترین-سالن-زیسایی-در-کرج/ — hours 10:00–19:00, website `razmenasalon.ir`
- https://rhodiumclinic.ir/بهترین-عروس-سرای-کرج/ — IG `razmena.beauty`, address
- https://karajbama.com/سالن-زیایی-در-کرج/ — **"call to book"** evidence

**یونیک — Mashhad**
- https://uniquebarberclub.com/ — **the business's own site**; "رزو نوبت / رزو وقت" CTA, services, address
- https://uniquebarberclub.com/about-us/ — own site, positioning "مجهزترین مجموعه آرایشگاهی … در شرق کشور"
- https://www.instagram.com/unique_barberclub/ — 114K followers, 301 posts
- https://bestinmashhad.com/best-mens-barber-in-mashhad/ — IG, website, address, phones
- https://darmashhadkojast.com/mens-barbershop-in-mashhad/ — hours 9:30–21:00 daily, services
- https://faratat.com/mashhad/beauty-services/آرایشگاه-داماد-یونیک-در-مشهد/ — Telegram `uniquecopmlex`, IG
- https://sarayearoos.com/hall/unique-mens-barber-shop/ — **"call to book"**: "برای رزرو نوبت … تماس بگیرید"
- https://tashrifatazma.com/best-mens-barbershop-in-mashhad/ — 20 yrs

**آس — Tehran (Tehranpars)**
- https://asbarber.com/ — **own site**; four business lines, academy, "رزرو آنلاین" element, phone, address
- https://asbarber.com/home/ — own site, history since 1376
- https://asbarber.com/academy/courses/male-barbering/ — own site, academy
- https://dartehran.com/mens-barber-shop-in-tehran/ — rank 1, website, IG `mohammadkashani_kbc`
- https://handy-man.ir/mens-barbershop-tehran/ — address, phone, website, IG `ace.mensclub`
- https://www.aroos.city/بهترین-آرایشگاه-های-مردانه-تهران/ — VIP groom packages

**سعید پورانداخت — Tehran (Niavaran)**
- https://saeedpourandokht.com/ — **own site**; hours Sat–Thu 9–20 / Fri 10–19, "رزرو وقت", team
- **https://saeedpourandokht.com/reservation/ — the existing online booking form (service, provider, date/time, deposit)**
- https://saeedpourandokht.com/service/haircut/ — "رزرو آنلاین این خدمات"
- https://saeedpourandokht.com/contact-us/ — address, email, four named staff
- https://injakhube.ir/tehran-men-barbershop/ — the "تلگرام: رزرو وقت" annotation
- https://salonkhobe.com/best-mens-barbershops-north-tehran/ — rank 1, address, hours
- https://dartehran.com/the-best-mens-barber-shop-in-tehran/ — history, website, IG

**Competitive landscape (B8)**
- https://manaray.ir/ — closest match: per-business dedicated booking link, SMS reminders, daily reports, accounting
- https://www.nobatpro.com/ — booking + salon accounting
- https://salon20.ir/ — marketplace with online booking
- https://ziber.ir/ — booking web-app
- https://nikaraa.ir/ — marketplace

### 4.5 Recommended pilot shape

- **Cities:** all four launch cities are already approved by default — no market approval needed. Using one city per prospect keeps `city`/`segment` normalization unambiguous (§2.2).
- **Segments:** `MENS_BARBER` ×4, `WOMENS_SALON` ×1 — matches the code's `GROUP_FIT_BONUS` (BARBER +15 is the best fit for the current feature set).
- **Send limit:** leave at the default **10**. Do not raise it. The clamp means the system will never raise it itself.
- **Channel:** manual (Instagram DM / phone), per B1. Automated delivery should be expected to return `no_telegram_id` or `not_started_bot` for **all five** — that is a correct result, not a failure.
- **Suggested first contact order:** هری کاتر → رازمنا → یونیک. The two Tehrani businesses need a verification step first (آس: does "رزرو آنلاین" work? پورانداخت: displacement pitch only).

---

## 5. Phase 3 — Prepared but **NOT** executed

**Nothing was imported, discovered, promoted, verified, prepared, approved or sent. No production write of any kind occurred.**

Phase 3 requires (a) owner approval of the shortlist and (b) production write access. I have neither: B2 blocks access entirely, and the task explicitly gates Phase 3 on owner approval. Stopping here is the correct action, not a partial failure.

What **is** ready, so approval can be acted on immediately:

- **`docs/growth/pilot-seed.json`** — the five businesses in the exact `outreach.manual_seed` shape that `validateSeedItems()` accepts (`publicName`, `publicUrl`, `telegramUsername`, `description`, `city`, `language`, `sourceRef`). Only public information. `telegramUsername` is `null` for all five (§4.2). `city` uses canonical registry codes so `resolveCity()` step 0 passes them through untouched and the Karaj-vs-Tehran `AMBIGUOUS` guard can never fire.
- Every row will import as **`DISCOVERED`**, guaranteed three ways: the column default (`@default("DISCOVERED")`), `discovery.ts:647` hard-coding it on promotion, and `discovery.ts:546`'s stated contract. **No row is marked VERIFIED.** Verification is an owner action taken only after genuinely opening the business's public page, and must never be used to bypass campaign eligibility.
- The approved invitation template already exists: `docs/growth/ACQUISITION-PLAYBOOK.md` §4 (Persian, men's and women's variants) and `DEFAULT_TEMPLATES` in `src/lib/outreach/templates.ts` (`fa`/`en`/`ar`, `{businessName}` `{link}` `{category}` placeholders). `validateTemplateBody()` requires `{link}` or an explicit http(s) URL — a channel-only or contact-only message cannot convert and is rejected.
- Message-builder invariants confirmed in `src/lib/outreach/message.ts`: `MESSAGE_MAX_LENGTH` 1500, `CTA_MAX_LENGTH` 120, `ALLOWED_PLACEHOLDERS` = `businessName`/`link`/`category`, links are **never auto-inserted**, unknown `{…}` tokens are reported rather than silently stripped, and selecting the `channel` destination with an empty `outreach.channel_url` is a **validation error, not a guess**.

### Offline pre-import verification of the seed file — **PASS (executed against the repository's own code)**

`docs/growth/pilot-seed.json` was validated by running the project's real validators over it (a temporary vitest file, since removed; the working tree contains only the two new deliverables). This is **offline, pre-import** verification — it proves the rows will be *accepted and normalized correctly*, and it is **not** a database-backed count. Production row counts remain **INACCESSIBLE** (§1.2b).

`validateSeedItems(items)` → **`problems: []`**, all 5 rows accepted. Then, per row:

| Business | `resolveCity` | `detectSegment` | Keyword score | Group | Matched terms |
| --- | --- | --- | --- | --- | --- |
| هری کاتر | `SHIRAZ` / **HIGH** | `MENS_BARBER` / **HIGH** | **70** | `BARBER` | آرایشگاه مردانه |
| رازمنا | `KARAJ` / **HIGH** | `WOMENS_SALON` / **HIGH** | **70** | `BEAUTY` | سالن زیبایی |
| یونیک | `MASHHAD` / **HIGH** | `MENS_BARBER` / **HIGH** | **100** | `BARBER` | barber, آرایشگاه مردانه |
| آس | `TEHRAN` / **HIGH** | `MENS_BARBER` / **HIGH** | **100** | `BARBER` | barber, آرایشگاه مردانه |
| پورانداخت | `TEHRAN` / **HIGH** | `MENS_BARBER` / **HIGH** | **70** | `BARBER` | آرایشگاه مردانه |

Also asserted and passing: all five `publicUrl`s are `https:` on a public host with no embedded credentials and ≤500 chars; every `city` is a canonical approved launch code that `resolveCity()` step 0 passes through untouched at HIGH confidence (so the Karaj-vs-Tehran `AMBIGUOUS` guard can never fire); the four launch cities are all covered; every `sourceRef` is a real public `https:` directory URL; all field lengths are inside the validator's limits (200/500/64/800/80/8/200); **`telegramUsername` is `null` on all five rows** (§4.2); and the JSON contains **no phone number and no email address** (regex-asserted) — only public business-page information.

Every keyword score (70–100) is far above the `outreach.min_score` default of **30**, so none of the five would be filtered out by relevance scoring. Note that `یونیک` and `آس` score 100 only because their public names contain the Latin word "Barber", which the `barber` starter keyword matches in addition to `آرایشگاه مردانه` — a genuine signal, not an artifact.

**Still to be done by the owner, and not substitutable by the above:** the database-backed counts (Phase 3.2) — `SELECT "verificationStatus", count(*) … GROUP BY 1` and `SELECT city, segment, count(*) … GROUP BY 1,2` after import (§7.4). Those require production database access I do not have.

### What the dry run will and will not show

`POST /api/admin/outreach/campaigns/[id]/dry-run` (rate-limited 60/10min, admin-only, `Cache-Control: no-store`) calls `dryRunCampaign()` → `planCampaign()` and returns `{ ok: true, plan }` **without creating an invitation or sending anything**. Per recipient it reports verification status, eligibility, the exact rendered message and the CTA.

Predicted result for this pilot, derived from `checkEligibility()` — to be **confirmed by an actual dry run, not accepted from this prediction**:

| Recipient | Predicted eligibility | Reason code |
| --- | --- | --- |
| All 5 | `canAutoSend: false` | `no_telegram_id` (no numeric id known) |
| …and even with a confirmed handle | `canAutoSend: false` | `not_started_bot` (no `User` row until they press Start) |

Planning itself will emit warnings that are **correct and expected**, not errors: `DISCOVERED` prospects are excluded from recipients until the owner verifies them, and a campaign left in `DRAFT` yields *"Campaign is still DRAFT. Run a dry run before approving."*

**I will not approve the campaign and will not send messages.** Per the task, Phase 3 stops at the dry run and reports for owner review.

---

## 6. Reproducible defect — the first booking cannot be measured honestly (B7)

This is the one finding that directly threatens the success criterion *"a real business … receives its first genuine booking"*, and *"never represent a test as a genuine customer booking."*

**The documentation promises an exclusion that the code does not implement.**

| Where | Text |
| --- | --- |
| `docs/growth/ACQUISITION-PLAYBOOK.md:45` | \| **First real booking** \| A genuine customer booking recorded in the system. **Test bookings are excluded** \| |
| `docs/growth/CAMPAIGN-EXPERIMENTS.md:40` | \| First real bookings \| `Booking` on the converted business \| **Test bookings excluded** \| |

**Actual behaviour, verified at `b5cf77f`:**

1. `prisma/schema.prisma` — the `Booking` model has **no** test/demo/synthetic flag. Fields are `status`, `paymentStatus`, `customerName`, `customerPhone`, `customerEmail`, `startAt`, `endAt`, prices, deposit fields, `receiptToken`, `idempotencyKey`, timestamps. Nothing distinguishes a test from a real booking.
2. A repo-wide search for `test.?booking`, `isTest`, `demo.?booking`, `exclude.?test` across `src/**` returns **zero matches**.
3. `src/app/api/public/business/[slug]/bookings/route.ts:470-475` — on any successful create, it fires `recordFunnelEvent({ event: "booking_created" })` **unconditionally**. The adjacent comment reads *"Funnel: a real customer booking was created."*
4. `src/lib/outreach/attribution.ts:68` — `markFirstBooking(businessId)` is called on the same path and promotes the linked prospect to **`ACTIVATED`** (guarded only against `NOT_INTERESTED`, `DO_NOT_CONTACT`, and already-`ACTIVATED`).
5. `src/lib/funnel.ts:34,61` — the event is defined as `"booking_created" // 10. First real customer booking completed`, labelled **"10. First real booking" / «۱۰. اولین رزرو واقعی»**.

**Consequence:** if the owner test-drives the booking page in production — which Phase 4 explicitly contemplates — the Overview funnel will record a **first real booking** and the prospect will be marked **ACTIVATED**, i.e. *"Customer acquired: a real owner registered and activated."* The system would report the pilot's success criterion as met by a test. There is no field to filter on afterwards and no way to retract it.

**Why I did not fix this in a PR:** the minimal correct fix is a schema change (`isTestBooking Boolean @default(false)` on `Booking`, excluded from the `booking_created` fire and from `markFirstBooking`), which requires a **production database migration** — a production write that the task forbids without explicit owner authorization. Opening a PR that silently assumes an authorized migration would be worse than reporting it. **This needs an owner decision.**

**Interim safe procedure (no code change required), until B7 is fixed:**
- Do **not** create test bookings against a production business record. Validate the flow on a **separate throwaway business** you create and then delete, and accept that the funnel event will still fire once — or
- Validate against a **preview deployment** with its own database, never production, or
- If a production test booking is unavoidable, record its `bookingId`, timestamp and business outside Bookora **before** creating it, and treat any "first real booking" in that window as **unproven**. Do not report customer acquisition on the strength of it.

---

## 7. Exact owner probes to close the gaps (read-only, no writes)

Run these while logged in as an admin. Every one is a GET; none modifies data. **Do not paste the outputs anywhere that would reveal a secret** — the webhook route returns no secret value, but the Neon console does show connection strings.

```bash
BASE="https://bookora-pearl.vercel.app"   # confirm this alias serves b5cf77f first

# 0. Which SHA is live? (compare the deployment URL from §1.1)
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/"
curl -sS -o /dev/null -w '%{http_code}\n' "https://bookora-rsw8jzpnz-ai-image-app.vercel.app/"

# 1. B4 — webhook diagnostics. Expect configured:true AND matchesExpected:true
curl -sS "$BASE/api/admin/telegram/webhook"          # in a browser, logged in as admin

# 2. B5 — cron secret. Expect 401 Unauthorized. 503 == CRON_SECRET still unset
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/api/cron/expire-pending"
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/api/cron/daily-growth"

# 3. B3 — migration state, in the Neon SQL Editor. Read-only.
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('outreach_campaigns','outreach_prospects','invitation_templates',
                      'outreach_invitations','bot_starts','outreach_suppressions',
                      'discovery_keywords','discovery_candidates','discovery_runs',
                      'funnel_events','outreach_audit_events')
 ORDER BY table_name;                                  -- expect 11 rows

SELECT column_name FROM information_schema.columns
 WHERE table_name = 'outreach_prospects'
   AND column_name IN ('verificationStatus','segment','neighborhood','city')
 ORDER BY column_name;                                 -- expect 4 rows (proves 0002)

SELECT column_name FROM information_schema.columns
 WHERE table_name = 'outreach_campaigns'
   AND column_name IN ('status','cities','segments','sendLimit','templateId')
 ORDER BY column_name;                                 -- expect 5 rows (proves 0002)

# 4. §2 — live settings, and the current prospect/verification counts
SELECT key, value FROM admin_settings WHERE key LIKE 'outreach.%' ORDER BY key;
SELECT "verificationStatus", count(*) FROM outreach_prospects GROUP BY 1 ORDER BY 2 DESC;
SELECT city, segment, count(*) FROM outreach_prospects GROUP BY 1,2 ORDER BY 3 DESC;
SELECT status, count(*) FROM outreach_invitations GROUP BY 1 ORDER BY 2 DESC;

# 5. B7 — has any booking ever been created? (baseline before any pilot test)
SELECT count(*) AS bookings, min("createdAt") AS first, max("createdAt") AS last FROM bookings;
SELECT count(*) AS funnel_booking_created FROM funnel_events WHERE event = 'booking_created';
```

Then, in the browser as admin: **/admin → Outreach → Overview**, **Prospects**, **Discovery**, **Campaigns** — the four screens named in Phase 1.2.

---

## 8. Owner actions, in the exact order needed

Each step is a hard prerequisite for the next. Do not reorder.

| # | Action | Unblocks | Why this order |
| --- | --- | --- | --- |
| **1** | **Apply the schema**: `npm run db:push`, or run `0001` → `0002` → `0003` in the Neon SQL Editor in that order. Then run the §7.3 probes. | B3 | Without the tables, Outreach/Discovery/Campaigns error and nothing else can be done. `0003` requires `0001`+`0002`. All three are idempotent and non-destructive. |
| **2** | **Set `CRON_SECRET`** (≥32 random chars) in Vercel → Production, then **redeploy**. Confirm §7.2 returns 401, not 503. | B5 | Fixes both crons at once, including the pre-existing broken `expire-pending`. Requires a redeploy to take effect — hence before step 3, so one redeploy can cover both if you set them together. |
| **3** | **Set `TELEGRAM_WEBHOOK_SECRET`** (a *different* ≥32-char random string) in Vercel → Production, **redeploy**, then press **Configure webhook, commands and Mini App button** at Admin → Outreach → Telegram bot. Confirm §7.1 shows `configured: true` **and** `matchesExpected: true`. Then send `/start` to `@Bookora_App_bot` and confirm a reply. | B4, and the only automated path in B1 | Until the bot answers, there is no attribution, no opt-out and no onboarding. `matchesExpected: true` also proves `APP_URL` is the real public HTTPS domain. **If the bot does not reply, stop — nothing downstream can work.** |
| **4** | **Decide B7.** Either authorize the `isTestBooking` schema fix (I will implement it on this branch with tests, and you authorize the migration), or adopt the §6 interim safe procedure. | B7 — the success criterion itself | Must be settled *before* anyone touches the booking page in production, or a test will be permanently recorded as the first real booking. |
| **5** | **Approve (or amend) the §4 shortlist.** Then set `outreach.channel_url` at Admin → Outreach → Discovery if you want the channel destination (B6); confirm the read-back succeeds. | B6, Phase 3 | I will not import or promote anything without this approval. |
| **6** | **Import the five** from `docs/growth/pilot-seed.json` (Admin → Outreach → Discovery → manual seed, or Prospects → Add prospect). Confirm all five are **DISCOVERED**. | Phase 3 | They must stay DISCOVERED until genuinely verified. |
| **7** | **Open each business's own public page** (the five URLs in §4.1) and only then set **VERIFIED** with one line of `verificationEvidence` (what proves the city and category). Resolve the §4.2 handle conflicts and fill in `telegramUsername` per business. | Campaign eligibility | **Never mark VERIFIED to bypass eligibility.** Verification is the claim that a human actually looked. |
| **8** | **Create one small pilot campaign**: one city, one segment, send limit left at **10**, template from `ACQUISITION-PLAYBOOK.md` §4. Run **Dry Run**. Read every recipient's verification status, eligibility, exact message and CTA. | Phase 3 | Dry run creates no invitation and sends nothing. |
| **9** | **Report the dry-run results and stop.** Do not approve, do not send. | — | Per the task. Review before anything is armed. |
| **10** | **Send manually yourself** — Instagram DM (or phone) to the approved businesses, each with its own attributed `t.me/Bookora_App_bot?start=p.<token>` link, then press **"I sent this manually"**. Max 10. Record "sent", never "delivered". | B1 | This is the only compliant channel. `mark_manual_sent` records a human action already taken; automated delivery stays impossible until a business presses Start. |
| **11** | **Onboard the first responder yourself**: business setup → service + price → working hours → public booking link. Then have a **real customer** book, and confirm it appears on the owner dashboard. | The actual objective | Steps 6–10 only produce a conversation. This step produces the customer. |

---

## 9. The single next action most likely to produce the first real customer

> **Complete steps 1–3 (apply the schema, set `CRON_SECRET`, set `TELEGRAM_WEBHOOK_SECRET` and press "Configure webhook"), then personally send the Persian invitation to آرایشگاه هری کاتر in Shiraz over Instagram DM, with its attributed link — and offer to set up the booking page for them yourself.**

Why this one, and not something else:

- **Steps 1–3 are strictly upstream of everything.** They are three environment/config actions, roughly 10 minutes total, and until they are done the outreach dashboard errors, both crons fail closed, and the bot is silent. No amount of prospecting converts while they are outstanding. They are also the only items on this list that require no judgement call and no external party.
- **هری کاتر is the highest-probability first conversation of the five**, on evidence rather than intuition: it is the only shortlisted business where a directory states outright that booking is by phone a day in advance, while the same business simultaneously publishes tiered packages with prices, fixed daily hours (10–21), and sells appointment slots on a deals platform. That combination — appointment-driven revenue, no self-serve booking — is exactly the gap Bookora fills. Unlike پورانداخت it has no existing system to displace, and unlike یونیک and آس there is no ambiguity to resolve first.
- **"Offer to set it up for them" is the conversion step, not a courtesy.** `OWNER-RUNBOOK.md` step 7 already prescribes it for the "too complicated" objection. The onboarding path is four steps and about two minutes (business → service + price → working hours → share link), and the checklist component is built to drive exactly that: it names the single next pending action and puts copy/share one tap away. Doing it *for* the first business removes the only real friction between a reply and an activated account.
- **Deliberately not the answer:** more prospecting. 90 businesses are already researched and 5 are now independently verified; discovery is not the constraint. Nor is automated sending — B1 makes it structurally impossible for cold prospects, and it will stay that way no matter how much is imported. Nor is it a code change: at `b5cf77f` the outreach machinery, the verification safeguards and the booking flow are complete, tested (298/298) and deployed successfully. **The constraint is that a human has not yet had a conversation with a business.**

---

## 10. Honest statement of what was and was not achieved

**Achieved and evidenced:** PR #10 merge and production deployment verified against the GitHub and Vercel APIs with the exact SHA, deployment id, state and URL (§1.1). The verification safeguard confirmed present in all three required paths, with line numbers and passing tests (§1.5). Migration *safety* and *content* fully audited (§1.3). Acquisition configuration, markets, keywords, seed sources and limits read from source (§2). Nine blockers identified and evidenced (§3). Five genuine businesses independently verified with a complete source-URL audit trail (§4), plus one material correction to the prior research (§4.2). The prepared seed file executed against the repository's own validators with zero problems and HIGH-confidence city/segment normalization for all five rows (§5). One reproducible defect found that would have let a test booking be reported as the first real customer (§6). 298/298 tests passing locally at the production SHA (§1.6).

**Not achieved, and why:** the live admin screens, webhook diagnostics, production migration state and production database counts (§1.2, §1.4, §1.3) — blocked by network egress policy and absent credentials, neither of which I can or should work around. No prospect import, no promotion, no verification, no campaign, no dry run, no approval, no message (§5) — blocked by the same access limits and, correctly, by the requirement for owner approval first. No customer acquired.

**No Telegram message was sent. No campaign was approved. No production setting was modified. No production data was written. No secret, token or session cookie was requested, read or exposed. No Telegram user was contacted. No prospect was fabricated and no discovery result was invented — every business in §4 was confirmed against public pages on 2026-10-10, with URLs recorded. No PR was opened**, because no reproducible defect required a code change I was authorized to make: the one real defect (§6) needs a production migration, which needs owner authorization first.

**Bookora has zero active business customers. This report does not claim customer acquisition.**
