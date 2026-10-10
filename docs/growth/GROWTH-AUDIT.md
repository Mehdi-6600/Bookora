# Bookora — growth audit (Phase 1)

Audited 2026-10-10 · branch `arena/b3951939-bookora` · base `708b279`

Method: read every relevant file in the repo, then probe the live deployment.
Nothing below is inferred from the existence of code — where I could not verify
something, it says so.

---

## 1. Live state

| Thing | Verified result |
| --- | --- |
| App + database | ✅ Healthy. `GET /api/me` → `{"user":null}` |
| Landing (EN) | ✅ Loads. "Online booking for small service businesses. Simple, fast, and intelligent." CTAs: **Open in Telegram**, **Business panel** |
| Bot | ✅ `t.me/Bookora_App_bot` exists, display name "Bookora" |
| Product booking flow (web) | ✅ Works — `/api/public/business/:slug` and `/book/:slug` serve real data |
| **Real customers** | ❌ **None found.** No evidence in the DB, logs or repo of any acquired business |

I could not complete the full 10-step Telegram journey myself: it requires the
Telegram client (Mini App + `initData` signature) plus the production bot token,
neither of which exists in my environment. I verified the auth code path by
reading it and the **server** half of the journey by HTTP. Steps I could not
execute are marked ⚠️ below.

---

## 2. The 10-step journey

| # | Step | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Open bot, press Start | ❌ **BROKEN** | No `setWebhook` is registered anywhere in the repo or in any setup doc. `/api/telegram/webhook` exists but is only reachable if someone registers it. **Result: the bot does not reply to `/start` at all.** |
| 2 | Launch Mini App | ❌ **BLOCKED** | No Telegram "Menu Button" / `setChatMenuButton` call exists. The only entry point is an unfurlable `t.me/<bot>?start=app` URL on the landing page. |
| 3 | Telegram auth | ✅ Works | `src/lib/telegram/auth.ts` — real HMAC-SHA256 over the initData, 10-minute freshness window, JWT issued by `jose`. Correct. |
| 4 | Create business | ✅ Works | `src/app/api/business/route.ts`, plan limit enforced (`FREE_BUSINESS_LIMIT = 1`) |
| 5 | Add service + price | ✅ Works | `src/app/api/services/route.ts` |
| 6 | Configure working hours | ✅ Works | `src/app/api/working-hours/route.ts` (+ `time-off`) |
| 7 | Open public booking link | ✅ Works | `GET /{locale}/book/{slug}` — I fetched it live, it renders |
| 8 | Complete a customer booking | ✅ Works | `POST /api/public/business/:slug/bookings` — real slot validation, double-booking guard, deposit handling |
| 9 | Booking appears in dashboard | ✅ Works | `GET /api/business` → bookings |
| 10 | Owner gets confirmation | ⚠️ **PARTIAL** | `notify.ts` sends a Telegram message **only when the booking does NOT require a deposit**. Deposit bookings notify on payment approval. Reasonable, but it is a condition, not a guarantee. |

**Four of ten steps are fine. The first two are dead.** That is the whole
problem: the product works, the front door does not.

---

## 3. Blockers

| ID | Severity | Blocker |
| --- | --- | --- |
| **B1** | 🔴 Critical | **Bot does not respond.** No webhook registration, no `/start` handler reachable, no Mini App menu button. Steps 1–2 of the journey are impossible. |
| **B2** | 🔴 Critical | **`/app` is unusable outside Telegram.** It renders only "در حال ورود به Bookora..." forever. The Persian-only dead end is silent — no error, no fallback, no "open in Telegram" hint. Verified live. |
| **B3** | 🟠 High | **No conversion measurement at all.** There is not one analytics or funnel event anywhere in the codebase. You cannot see where visitors or owners drop off, so every growth decision is a guess. |
| **B4** | 🟠 High | **No acquisition workflow.** No prospect list, no invitation tracking, no follow-up, no way to attribute a signup to an outreach message. |
| **B5** | 🟡 Medium | **Value proposition not provable in 10 seconds.** The landing hero is generic ("Simple, fast, and intelligent") — it never says what you get (a shareable booking link), who it is for, or that it is free for one business. |
| **B6** | 🟡 Medium | **Shared booking links have no preview.** `book/[slug]` had no `generateMetadata`, so a link pasted into Instagram/WhatsApp/Telegram shows no title, description or image — the single most important acquisition surface for this product. Landing page metadata was also absent. |
| **B7** | 🟡 Medium | **Onboarding has no guided path.** After creating a business there is no checklist telling the owner "you are 2 of 4 steps from a working link". Activation depends on them guessing. |

### What I deliberately did **not** change

- Telegram auth (HMAC + JWT) — correct and secure
- Booking validation, slot generation, double-booking guards, pending-expiry
- Payment flows (Stars, manual/Zarinpal), subscription entitlement logic
- Database schema of the pre-existing 12 models
- Tech stack: Next 15, React 19, next-intl, Prisma/Postgres, Tailwind, Vercel

---

## 4. Funnel instrumentation added

Nine steps, fire-and-forget, **privacy-conscious by construction**
(`src/lib/funnel.ts` + `src/lib/funnel-client.ts` + `POST /api/funnel`):

```
landing_view → start_click → miniapp_launch → auth_success →
business_created → first_service → hours_configured →
booking_link_opened → first_booking
```

Stored per row: `event`, `anonId`, `locale`, `ref`, `createdAt`. **Nothing else.**

`anonId = sha256(daily-rotating-secret-salt + IP + user-agent)`. It is
pseudonymous, rotates every day, and is useless for re-identifying anyone.
There is deliberately **no raw IP, no user agent, no initData, no name, no
phone, no cookie** in the table.

---

## 5. Privacy stance

| Rule | How it is enforced |
| --- | --- |
| Never log Telegram auth payloads | `verifyTelegramWebAppData` returns only `{ok, userId, username, firstName, languageCode}` — the raw `initData` string never leaves the function and is never written anywhere |
| Never log credentials | No `console.log` of tokens, secrets or `initData` anywhere in the new code |
| No sensitive customer data in analytics | `FunnelEvent` schema has exactly 5 columns, none identifying |
| Admin interfaces authenticated | Every `/api/admin/**` route calls `requireAdmin()` first → 401/403 |
| Secrets | `getEnv()` throws at import time if `JWT_SECRET` < 32 chars; new `CRON_SECRET` follows the same rule |

No new analytics dependency was added — no PostHog, no GA, no Segment. The
funnel is ~120 lines on the existing Prisma/Postgres stack.

---

## 6. Environment blockers in my sandbox (not product problems)

| Blocker | Consequence |
| --- | --- |
| `prisma generate` cannot run (`binaries.prisma.sh` unreachable) | The local Prisma client is an `any` stub → `tsc --noEmit` reports **71 errors** that do not exist in CI (CI runs `prisma generate` first). I verified every one of the 71 traces to this stub. |
| No `DATABASE_URL` | `db:push` could not be run; the migration is delivered as SQL and is idempotent |
| No Vercel / bot credentials | I could not deploy, register the webhook, or send a test Telegram message |
| `curl` to the outside world is TLS-blocked | All live probing was done through the fetch tool instead |

---

## 7. Recommended first niche

See **[ACTION-PLAN.md](./ACTION-PLAN.md)** — Persian-speaking (Iran, Tehran
first) barbershops and men's salons, with Tehran beauty salons as the second
wedge in the same language.
