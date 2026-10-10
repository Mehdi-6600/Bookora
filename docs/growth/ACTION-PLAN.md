# Recommended niche, 7-day plan, and the exact next action

Prepared 2026-10-10

---

## 1. Recommended first niche (Phase 2)

> **Persian-speaking (Iran, Tehran first) barbershops and men's salons
> (آرایشگاه مردانه / پیرایشگاه), with Tehran beauty salons (سالن زیبایی) as the
> immediate second wedge in the same language.**

Not medical. Not "every industry and country".

### Evidence

| Criterion | Barbers / men's salons (fa) | Beauty salons (fa) | Medical (fa) |
| --- | --- | --- | --- |
| **Reachable by the founder** | ⭐ Best. Every one of the 11 Tehran barbers in the starter list publishes a public Instagram or Telegram handle, so a direct, personal message is possible with no gatekeeper. | ⭐ Also good — same public-profile pattern. | ✗ Worst. Receptionists, clinic managers, procurement. |
| **Booking frequency** | ⭐ 20–40 short appointments/day, 30–60 min each, repeat every 3–6 weeks. Very high slot churn → the product is used every single day. | ⭐ Similar volume, longer slots. | Low volume, long lead times. |
| **Existing booking habit** | ⭐ Actively booking today, mostly by Instagram DM and phone — publicly documented ([barber scheduling via messaging is the norm](https://en.mareaalcalina.com/como-vender/barberia-peluqueria-por-whatsapp), [UAE barbers expected to take WhatsApp bookings](https://www.yallasalon.me/guides/best-barbershop-booking-software-uae)). They already accept the *behaviour* Bookora needs; only the tool is missing. | ⭐ Same. | Formal referral/intake flow — a different product. |
| **Likelihood of trying a new free tool** | ⭐ Owner-operated. The owner *is* the decision maker. One business, no IT, no procurement. | ⭐ Owner-operated too, but more multi-staff → more coordination. | ✗ Compliance, records, liability. |
| **Language / onboarding fit** | ⭐ **Bookora is already fully translated to Persian, defaults Iran to `Asia/Tehran` + Toman, and the bot now speaks Persian.** Zero new localization work. The product's own defaults (`resolveTimezone()` → `Asia/Tehran` for `IR`) show Iran was the intended first market. | ⭐ Same assets. | Would need intake forms, insurance fields, longer booking windows. |
| **Telegram as the acquisition channel** | ⭐ Iran is one of the heaviest Telegram markets in the world; Telegram reports ~1B MAU and ~500M monthly Mini App users ([1](https://www.poster.ly/guides/telegram-guide), [2](https://www.financemagnates.com/forex/telegram-reaches-1b-users-33-trade-crypto-brokers-see-growth-via-mini-apps/)). Verified directly: Persian salons already run public Telegram channels. | ⭐ Verified — 2 of the 4 Tier A prospects are Persian beauty salons with live Telegram channels. | Unverified. |

### Why this beats "start with beauty salons"

Both are viable and share the same language assets. Barbershops win on three
concrete points:

1. **Shorter services → more slots → the tool pays off faster.** A 30-minute
   haircut produces roughly twice the daily bookings of a 90-minute colour
   appointment, so the owner feels the value within days.
2. **Simpler service menus.** A barber has 5–10 services. Bookora's service
   editor handles that in one screen with no migration pain.
3. **The starter prospect list skews barber.** 11 of the 15 prospects found are
   barbershops — supply-side evidence that they are the most publicly
   discoverable segment in this market.

Beauty salons are the second wedge, not a different project: same language, same
templates, same funnel. Once the Persian onboarding is proven with 5 barbers,
the beauty list reuses everything.

### Explicitly deferred

- **Medical** (doctors, dentists, dermatologists, physiotherapists) — kept in the
  keyword system for later discovery, but not targeted now. It needs intake
  fields, longer booking windows and a compliance story Bookora does not have.
- **Every country** — Iran only, until 5 Persian-speaking businesses are active.
- **Arabic** (ar) is fully translated and ready, but will not be targeted until
  the Persian motion is repeatable.

---

## 2. The exact next action to get the first business owner using Bookora

> **Deploy `arena/b3951939-bookora`, run the database push, add
> `TELEGRAM_WEBHOOK_SECRET` (≥32 chars) to Vercel, then press
> "Configure webhook, commands and Mini App button" in
> Admin → Outreach → Telegram bot, and send `/start` to @Bookora_App_bot.**

Everything else is blocked behind that. Concretely, in order:

| # | Action | Why it is blocking | Owner |
| --- | --- | --- | --- |
| 1 | **Merge PR #4 into `main`.** CI is green (typecheck, 142 tests, `next build`) and the Vercel preview build is green. Merging triggers the real deploy. | No deployment = no cron, no webhook, no dashboard | You |
| 2 | Run `npm run db:push` against production (or `psql "$DIRECT_URL" -f prisma/sql/0001_outreach_growth.sql`) | The outreach tables do not exist yet | You |
| 3 | Add `TELEGRAM_WEBHOOK_SECRET` (≥32 random chars) to Vercel env, redeploy | Without it `/api/telegram/webhook` returns **503** and the bot stays silent | You |
| 4 | Press **Configure webhook, commands and Mini App button** | Registers `/start`, `/help`, `/stop` and the persistent Mini App button — the fix for blocker B1 | You |
| 5 | Send `/start` to @Bookora_App_bot from your own account | **This is the verification.** You should get a welcome message with a "Start setup" button. If you do, B1 is fixed. | You |
| 6 | Add 3 prospects from `PROSPECTING.md` Tier A, prepare their invitations, approve | First real invitations | You |
| 7 | Message prospect #1 yourself with their personal link (they have not started the bot) | First human conversation | You |

Steps 1–4 are the blocker. Steps 5–7 are the first customer.

**I could not do steps 1–4.** I have no Vercel deploy credentials, no production
database credentials, and no bot token in this environment. I am reporting them
as blockers rather than claiming they were completed.

Everything I *could* verify, I did: PR #4 is open with CI green on install,
`prisma generate`, typecheck, 142 tests and `next build`, and the Vercel preview
build succeeds. The only red check is the Netlify deploy preview, which fails
identically on PR #3 (this branch's base) and is a stray Netlify site connected
to a Vercel-deployed project — not caused by these changes.

---

## 3. Seven-day plan

### Day 1 — Unblock the front door (no customers yet)

- Deploy the branch. Run the migration. Set `TELEGRAM_WEBHOOK_SECRET`.
- Press the configure button. Send `/start`. Confirm the welcome + button.
- Confirm `Admin → Outreach → Telegram bot` reports `matchesExpected: true`.
- **Exit criteria:** you can open the Mini App from the bot's menu button and
  land on `/app` authenticated.

### Day 2 — Prove the owner journey yourself

- Inside the Mini App: create a test business, add one service, set working
  hours, copy the booking link, open it in a normal browser (not Telegram),
  complete a booking as a customer.
- Verify the booking appears in the dashboard and that you received the Telegram
  notification.
- Verify the shared link preview now shows the business name (metadata fix).
- **Exit criteria:** one real end-to-end booking exists in production.

### Day 3 — Load 15 prospects and prepare the first drafts

- Add all 15 prospects from `PROSPECTING.md`. Re-verify each Tier B profile
  before adding — delete any you cannot confirm.
- Install the starter keyword set. Set `outreach.timezone` to `Asia/Tehran`.
- **Prepare** 5 invitations (not 15 — keep it personal).
- **Exit criteria:** 5 drafts, each reviewed and personalized with one
  specific line about that business.

### Day 4 — Send the first 5

- Approve the 5 drafts.
- For each: if they have not started the bot, copy the personal link and message
  them yourself from your own account, then press "I sent this manually".
- **Exit criteria:** 5 messages genuinely sent. Record each honestly — "sent"
  only, not "delivered", unless Telegram confirmed it.

### Day 5 — Watch the funnel, fix what breaks

- Check **Overview**: did any of the 5 produce a bot start?
- For anyone who started the bot but stalled, message them directly with the
  single next step ("add your first service").
- Trigger the daily job manually once to confirm the report arrives:
  `curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/daily-growth`
- **Exit criteria:** at least 1 business created by a real prospect, and the
  daily report delivered to your Telegram.

### Day 6 — Push the first owner to activation

- Target: **1 business with a working booking link and 1 real customer
  booking.** Do not move on until this exists.
- Sit with them if needed — the four steps take two minutes, but only if they
  know that.
- Ask what confused them. Write it down; it is the next fix.
- **Exit criteria:** one activated business. This is customer #1.

### Day 7 — Turn one into a repeatable motion

- Ask customer #1 for two referrals to other owners.
- Add those referrals as new prospects (warm intros convert far better than
  cold ones).
- Review the funnel: where did the 5 drop off? Fix the single biggest drop.
- Add the next 10 prospects from the discovery seed list.
- **Exit criteria:** a written, repeatable 5-message-per-day routine and at
  least 1 activated business + 2 warm referrals.

---

## 4. Definition of "active business" (do not fudge this)

A business counts as **active** only when all of these are true in production:

1. A real owner created it (not a test account).
2. It has at least one active service with a price.
3. Working hours are configured.
4. It has received **at least one genuine customer booking** — not one you made
   yourself while testing.

The dashboard's `ACTIVATED` status means exactly this: it is set when a prospect
with a linked business receives their first booking (`markFirstBooking`).

**As of 2026-10-10, Bookora has zero active businesses.** Nothing in this
repository, deployment or conversation shows that any customer has been
acquired. The first one is the goal of days 4–6 above.

---

## 5. Priority order used for the fixes (Phase 7)

| Priority | Issue | Status |
| --- | --- | --- |
| 1 | Broken signup / entry — bot never replies, no Mini App button | ✅ Fixed |
| 2 | Auth & onboarding friction — `/app` dead outside Telegram, Persian-only error | ✅ Fixed |
| 3 | Unclear value proposition — landing page, missing metadata on shared links | ✅ Fixed |
| 4 | Missing conversion measurement — 9-step privacy-conscious funnel | ✅ Fixed |
| 5 | Weak acquisition workflow — admin outreach dashboard + invitation system | ✅ Fixed |
| 6 | Visual improvements | ⬜ Deliberately deferred until activation data exists |
