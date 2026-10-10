# Telegram outreach & invitation system (Phases 8 & 9)

Implemented 2026-10-10 · branch `arena/b3951939-bookora`

---

## 1. What was built

> **Update:** this system was extended with a 100-city approval registry, a
> per-campaign message builder, an audit trail and measured-vs-estimated
> analytics. See [GROWTH-EXPANSION.md](./GROWTH-EXPANSION.md); the safety
> model below still applies unchanged (and is now also audited).

An admin-only **outreach and invitation system** inside the existing Next.js +
Prisma + Postgres stack. No new infrastructure, no new dependencies, no new
deployment target.

| Capability | Where |
| --- | --- |
| Prospect CRM (public data only) | **Admin → Outreach → Prospects** |
| Bilingual invitation templates (FA / EN) | **Admin → Outreach → Templates** |
| Draft → approve → send with preview | **Admin → Outreach → Invitations** |
| Attribution: unique per-prospect deep links | `src/lib/outreach/deeplink.ts` |
| Bot-start and registration attribution | `src/lib/outreach/attribution.ts` |
| Post-start onboarding and nudges | `src/lib/telegram/onboarding.ts`, `bot.ts` |
| Daily keyword discovery + quotas | **Admin → Outreach → Discovery**, `src/lib/outreach/discovery.ts` |
| Opt-out and permanent suppression list | `src/lib/outreach/eligibility.ts` |
| Daily admin report over Telegram | `src/lib/outreach/report.ts` |

---

## 2. First: what I found in the existing Telegram integration

| Finding | Impact |
| --- | --- |
| `src/lib/telegram/bot.ts` handles `pre_checkout_query` and `successful_payment` | Payments already work — left untouched |
| **No `/start` handler** | The bot could not even greet anyone. Blocking. |
| `notify.ts` had `notifyUser()` but **no general send function** | Nothing else could send a message |
| `notifyOwnerNewBooking()` fires only for non-deposit bookings | Correct behaviour, kept |
| Webhook security is real: HMAC `x-telegram-bot-api-secret-token` | Kept exactly as-is |

**I did not rewrite the integration.** I added `/start`, `/help`, `/stop`, a
fallback handler, and a generic `deliverTelegramMessage()`. The payment path, the
HMAC verification and `notifyUser()` are unchanged.

---

## 3. End-to-end onboarding path

```
Landing page  "Open in Telegram"
        ↓
t.me/Bookora_App_bot?start=<outreach-token>
        ↓
/start  →  Persian or English greeting chosen from the prospect's record
        ↓
[Start setup] button  →  Mini App  →  /app
        ↓
Onboarding checklist:  business → service → working hours → copy booking link
        ↓
Owner shares the link → first genuine customer booking → ACTIVATED
```

The onboarding copy in `src/lib/telegram/onboarding.ts` is deliberately 1–2
sentences, in the prospect's own language, and always ends with a single next
action. Every `/start` with an unrecognized payload is treated as organic — it
never errors and never leaks that a token was invalid.

---

## 4. The safety model (this is the part that matters)

**Telegram does not let a bot initiate a conversation with someone who has not
messaged it first.** No API call makes that possible. Any tool claiming to do it
is either using user accounts (against Telegram's terms) or lying.

So the system enforces this, in code, in one place:

`src/lib/outreach/eligibility.ts` — `maySendInvitation()`

```
1. Suppression list lookup        → DNC / OPTED_OUT  ⇒ BLOCK
2. Prospect status lookup         → NOT_INTERESTED / DO_NOT_CONTACT ⇒ BLOCK
3. Already an active customer?    ⇒ BLOCK
4. Invitation status is APPROVED? ⇒ required
5. Has a User row (bot started)?  ⇒ YES: SEND via Bot API
                                     NO : PREPARE_LINK for manual outreach
```

**Fail-closed:** if the suppression read throws, the result is
`NOT_ELIGIBLE`, not "eligible". A database hiccup can never cause an unsolicited
message.

Also enforced:

| Rule | Enforcement |
| --- | --- |
| Admin approval before any send | Invitations are created as `DRAFT`; only `APPROVED` ones are ever delivered |
| Verified prospects only | Preparation, per-invitation approval and delivery each require `verificationStatus: VERIFIED`. A prospect unverified after approval is skipped at send time (`not_verified`), never messaged |
| No bulk automation | Nothing sends more than `outreach.daily_invitation_limit` (default 10) per day |
| Rate limiting | 1,100 ms sleep between deliveries in a run |
| `/stop` and "STOP" | Immediately adds to the suppression list and marks `DO_NOT_CONTACT` |
| Opt-out honoured forever | Suppression is checked before anything else, on every run |
| No scraping | Discovery only reads sources the admin explicitly configures (see `DISCOVERY.md`) |
| Failed delivery | Caught, recorded as `FAILED` with the error **class name only**, never retried blindly |
| Nothing unverifiable is reported | The daily report separates "sent" from "confirmed delivered" |

---

## 5. Attribution

Each prospect gets a unique, unguessable token:

```
t.me/Bookora_App_bot?start=p.<24-char-base32-token>
```

- Generated with `crypto.randomBytes` + a Crockford-style alphabet (no vowels,
  no look-alike characters) so it survives being retyped or truncated.
- Stored on `OutreachInvitation.startParam` (unique) and counted as
  `clickCount` when the link is used.
- When the bot receives `/start p.<token>`, `recordBotStart()` writes a
  `BotStart` row, links it to the invitation and the campaign, and advances the
  prospect to `STARTED_BOT`.

Attribution is counted **only when it is verifiable** — a `BotStart` row is
written only when Telegram actually delivers a start with that parameter.

### ⚠️ Known attribution gap

`src/app/api/auth/telegram/route.ts` does not forward `start_param` on the
callback after a successful login, so **`auth_success` and `business_created`
cannot currently be attributed to a specific invitation.** Bot starts are
attributed correctly. Fixing this properly needs a live Telegram client to
verify the WebApp `initDataUnsafe.start_param` field, which I do not have. It is
the first item in "remaining blockers".

---

## 6. Data model — 10 new Prisma models

| Model | Purpose |
| --- | --- |
| `OutreachCampaign` | Groups prospects; attribution roll-ups |
| `OutreachProspect` | Public business record + pipeline status + follow-up date |
| `InvitationTemplate` | Bilingual templates, per category and language |
| `OutreachInvitation` | Draft → approved → sent, with the unique token and delivery result |
| `BotStart` | Verified `/start` events, attributed |
| `OutreachSuppression` | Permanent do-not-contact list |
| `DiscoveryKeyword` | Editable keyword set per group and language |
| `DiscoveryCandidate` | Discovered candidates with score and review status |
| `DiscoveryRun` | One row per day — idempotency and audit |
| `FunnelEvent` | Anonymous funnel steps |

**The 12 pre-existing models were not modified.** All new columns are nullable
or have defaults; new tables are additive.

### Migrations — ⚠️ NOT YET APPLIED

There is no `DATABASE_URL` in my environment, so `db:push` was never run. Two
equivalent options, pick **one**:

```bash
npm run db:push            # Prisma
# or
psql "$DIRECT_URL" -f prisma/sql/0001_outreach_growth.sql   # idempotent DDL
```

The SQL file is idempotent (`CREATE TABLE IF NOT EXISTS`) and safe to re-run.

---

## 7. Scheduling

`vercel.json` declares **two** cron jobs:

| Path | Schedule | Purpose |
| --- | --- | --- |
| `/api/cron/expire-pending` | `0 2 * * *` | Pre-existing — expires stale pending bookings |
| `/api/cron/daily-growth` | `0 6 * * *` | **New** — discovery, preparation, delivery, report |

**Vercel Hobby allows at most two daily cron jobs per project**, and this is at
that limit. Do not add a third without upgrading the plan.

Both jobs are protected by `src/lib/security/cron-auth.ts`:
`CRON_SECRET` must be set and ≥32 characters (else **503**), and the request
must carry `Authorization: Bearer <secret>` compared with `timingSafeEqual`
(else **401**).

Idempotency on the growth job is the unique `DiscoveryRun.runDate` — a second
trigger on the same calendar date returns `{"skipped":true}`. The run row stores
status, timestamps and the error **class name only**: no secrets, no tokens, no
message bodies.

---

## 8. Files changed

### New — library (12)
`src/lib/outreach/`: `types.ts`, `normalize.ts`, `deeplink.ts`, `keywords.ts`,
`settings.ts`, `templates.ts`, `eligibility.ts`, `invitations.ts`, `sources.ts`,
`discovery.ts`, `attribution.ts`, `report.ts`

Also new: `src/lib/security/cron-auth.ts`, `src/lib/auth/admin-api.ts`,
`src/lib/funnel.ts`, `src/lib/funnel-client.ts`,
`src/lib/telegram/onboarding.ts`

### New — API (21 routes)
`src/app/api/admin/outreach/` → `prospects`, `prospects/[id]`, `templates`,
`templates/[id]`, `invitations`, `invitations/[id]`, `keywords`,
`keywords/[id]`, `candidates`, `candidates/[id]`, `settings`, `campaigns`,
`stats`, `suppressions`
`src/app/api/admin/telegram/webhook/` (GET = status check, POST = register)
`src/app/api/cron/daily-growth/`, `src/app/api/funnel/`

### New — UI (2)
`src/components/outreach/outreach-panel.tsx` (7 tabs),
`src/components/onboarding-checklist.tsx`

### New — tests (9)
`outreach-deeplink`, `outreach-dedupe`, `outreach-keywords`, `outreach-quota`,
`outreach-templates`, `outreach-discovery`, `outreach-invitations`,
`cron-auth`, `funnel`

### New — other
`prisma/sql/0001_outreach_growth.sql`, `src/types/telegram.d.ts` (extended),
`docs/growth/*.md`

### Modified (17)
`prisma/schema.prisma`, `vercel.json`, `.env.example`,
`src/lib/telegram/bot.ts`, `src/lib/telegram/notify.ts`,
`src/app/api/cron/expire-pending/route.ts`,
`src/app/api/auth/telegram/route.ts`, `src/app/api/business/route.ts`,
`src/app/api/public/business/[slug]/bookings/route.ts`,
`src/app/[locale]/page.tsx`, `src/app/[locale]/layout.tsx`,
`src/app/[locale]/book/[slug]/layout.tsx` (new), `src/app/[locale]/app/page.tsx`,
`src/app/[locale]/admin/page.tsx`,
`src/components/telegram/auth-gate.tsx`, `messages/{en,fa,ar}.json`

All three locale files are in sync at **497 keys each**.

---

## 9. Tests — ✅ 142 passing

```
Test Files  16 passed (16)
     Tests  142 passed (142)
```

| Suite | Tests | Covers |
| --- | --- | --- |
| `outreach-deeplink` | 7 | Token shape, charset, hostile payloads |
| `outreach-dedupe` | 14 | Telegram/URL/website normalization, dedupe keys |
| `outreach-keywords` | 15 | FA/EN matching, Arabic→Persian folding, scoring, priority |
| `outreach-quota` | 15 | Quota clamping, settings validation, no auto-increase |
| `outreach-templates` | 16 | Language selection, variable substitution, opt-out line |
| `outreach-discovery` | 13 | Discovery, dedupe, exclusions, idempotent runs |
| `outreach-invitations` | 18 | Eligibility gate, suppression, approval, rate limits |
| `cron-auth` | 8 | Missing/weak/wrong secret, timing-safe compare |
| `funnel` | 6 | Event validation, anonId rotation, no PII stored |
| pre-existing 7 suites | 30 | Availability, origin, payments, JWT, plans, currency |

### Verified in CI — not just locally

`prisma generate` cannot run in my sandbox (`binaries.prisma.sh` is
unreachable), so `tsc --noEmit` there reports 71 errors that are entirely an
artifact of the Prisma client being an `any` placeholder. I did not want to
hand-wave that, so I measured it:

| Measurement | Result |
| --- | --- |
| Clean worktree at base `708b279`, untouched, same broken client | **53 errors** |
| This branch | **71 errors** |
| Error codes present, base vs branch | **identical set**: TS7006, TS2339, TS2694, TS18046, TS2347, TS7053 |
| Every one of the 18 extra errors | Sits on a `prisma.*` or `Prisma.*` call in a new file |

**And then CI settled it.** On PR #4: Generate Prisma Client ✅ → **Typecheck
✅** → **Run tests ✅** → **Build ✅**. The typecheck is clean once the client is
real, and `next build` succeeds.

The only failing check on the PR is the Netlify deploy preview, which **also
fails identically on PR #3** (this branch's base) — a stray Netlify site is
connected to the repo and cannot build a Next.js app. The project deploys on
Vercel, whose preview build passes.

---

## 10. Remaining blockers

| # | Blocker | Who |
| --- | --- | --- |
| 1 | **Not merged and not deployed.** PR #4 is open, CI green, Vercel preview build green — but production still runs the old code and the migration is not applied. | You |
| 2 | **`TELEGRAM_WEBHOOK_SECRET` is not set** (≥32 chars required). Until it is, the webhook returns 503 and the bot is silent. | You |
| 3 | **Webhook + commands not registered.** One POST to `/api/admin/telegram/webhook` fixes B1. | You |
| 4 | **Migration not applied.** | You |
| 5 | **`start_param` attribution gap** on the post-login callback (§5). | Me, needs a live client |
| 6 | **No live end-to-end test** — I have no Telegram client and no bot token. | You |
| 7 | **Vercel cron is at the Hobby limit** of two daily jobs. | — |
| 8 | **Zero customers.** No prospect has been contacted. | — |

---

## 11. Exact manual action to launch the first campaign

1. Merge `arena/b3951939-bookora` → `main`; let Vercel deploy.
2. Apply the migration (`npm run db:push` **or** the SQL file — not both).
3. Add `TELEGRAM_WEBHOOK_SECRET` (≥32 random chars) to Vercel env; redeploy.
4. Open **Admin → Outreach → Telegram bot** and press **Configure webhook,
   commands and Mini App button**. Confirm `matchesExpected: true`.
5. Send `/start` to @Bookora_App_bot. **If it replies, B1 is fixed.**
6. **Admin → Outreach → Prospects** → add 3 prospects from
   [`PROSPECTING.md`](./PROSPECTING.md) (Tier A).
7. **Templates** → Install default templates.
8. **Invitations** → **Prepare** → review the preview → **Approve**.
9. For anyone who has not started the bot: copy their personal link, message
   them yourself, then press **"I sent this manually"**.
10. **Discovery** → Install starter keyword set → set timezone `Asia/Tehran` →
    keep discovery ≤ 50 and invitations ≤ 10 per day.
11. Trigger the job once by hand to confirm:
    `curl -H "Authorization: Bearer $CRON_SECRET" https://bookora-pearl.vercel.app/api/cron/daily-growth`

**Steps 1–4 are hard blockers.** Until they are done, no part of this system can
send or receive anything.
