# Owner runbook — the one checklist

Everything on a phone. No terminal required for steps 1–6.

Written 2026-10-10.

---

## What is already done (you do not need to touch it)

| Item | Status |
| --- | --- |
| PR #4 merged and **deployed to production** | ✅ Verified — deployment succeeded 2026-10-10 06:16 UTC |
| New landing page live | ✅ Verified — clear value proposition, real free-plan facts |
| Admin authorization enforced | ✅ Verified — unauthenticated requests get `401` |
| 181 automated tests passing | ✅ Verified |
| Full build passing in CI | ✅ Verified |
| 90 researched salons across your four cities | ✅ Documented in `PROSPECTS-FOUR-CITIES.md` |

---

## STEP 1 — Apply the database migration (5 minutes, once)

The new tables do not exist yet. Without this the outreach dashboard will error.

**Option A — from your computer, if you have the repo and the database URL:**

```bash
npm run db:push
```

**Option B — Neon console (easiest on a phone):**

1. Open Neon → your Bookora project → **SQL Editor**.
2. Paste the contents of `prisma/sql/0001_outreach_growth.sql`, run it.
3. Paste the contents of `prisma/sql/0002_four_city_campaigns.sql`, run it.

All migration files are safe to run more than once — they only add tables, columns and constraints, never drop or delete anything. (0001's foreign-key constraints are existence-guarded, matching 0002/0003; before that guard, re-running 0001 failed with PostgreSQL error 42710 "constraint … already exists".)

> ⚠️ `0002` is on the branch that has not merged yet. **Do step 1 after the merge**, or run only `0001` now and `0002` after.

---

## STEP 2 — Set `CRON_SECRET` (2 minutes)

1. Vercel → **Bookora** → **Settings** → **Environment Variables**.
2. Add `CRON_SECRET`, value = a random string of **at least 32 characters**.
3. Apply to **Production**. **Redeploy** (Deployments → ⋯ → Redeploy).

**This fixes two things at once:** the new daily discovery job *and* the pending-booking expiry job, which has been silently failing because this variable was never set.

Verify: open `https://bookora-pearl.vercel.app/api/cron/expire-pending`. It should say `Unauthorized` (401), not `Cron authentication is not configured` (503).

---

## STEP 3 — Set `TELEGRAM_WEBHOOK_SECRET` and wake the bot up (3 minutes)

1. Vercel → **Settings** → **Environment Variables**.
2. Add `TELEGRAM_WEBHOOK_SECRET`, value = a **different** random string, **at least 32 characters**.
3. **Redeploy.**
4. In Telegram open **@Bookora_App_bot** → open the web admin at `https://bookora-pearl.vercel.app/admin` (you must be logged in as an admin) → **Outreach** → **Telegram bot** → press **Configure webhook, commands and Mini App button**.
5. Send `/start` to **@Bookora_App_bot**.

**If the bot replies with a welcome message and a "Start setup" button, the critical blocker is fixed.** If it does not reply, nothing else in this plan can work — stop and check that step 3's redeploy finished.

---

## STEP 4 — Load 40 prospects (about 40 minutes — do 10 at a time)

Open `PROSPECTS-FOUR-CITIES.md` and take the **first 5 men's + first 5 women's** from each city.

In **Admin → Outreach → Prospects → Add prospect**, for each business:

| Field | What to enter |
| --- | --- |
| Public name | the business name |
| City | pick from the list — **Tehran, Mashhad, Shiraz or Karaj**. Never leave blank; the reports group by this |
| Segment | pick آرایشگاه مردانه or سالن زیبایی زنانه (auto-detects from the name if you leave it) |
| Neighbourhood | as published on the listing |
| Public URL | their Instagram page, e.g. `https://instagram.com/unique_barberclub` |
| Telegram username | only if the listing publishes one (very few do) |
| Source URL | **the directory page you found them on** — this is what makes the list auditable |
| Verification | set to **تأییدشده (VERIFIED)** once you have actually opened their public profile |
| Verification evidence | one line: what proves the city and category |

Only VERIFIED prospects can ever be included in a campaign. That is deliberate.

---

## STEP 5 — Set the channel link, then dry run your first campaign

Before creating a campaign, open **Admin → Outreach → Discovery → Bookora channel link**.
The field loads the saved database value. Enter the owner-confirmed URL exactly as
shown below and save:

```text
https://t.me/spell0000
```

Wait for the success notice confirming the value was read back from Outreach
settings. The campaign preview and prepared invitation use this stored value;
the system does not invent a fallback. If the save/read-back fails, stop and
resolve the settings or database issue before selecting the channel in a
campaign.

1. **Admin → Outreach → Campaigns → New campaign.**
2. Name: e.g. `تهران آرایشگاه مردانه — پایلوت`.
3. Tap **تهران**, tap **آرایشگاه مردانه**. Leave the send limit at 10.
4. **Dry run.** Read what comes back:
   - **Eligible** — the bot can message them (only people who already started the bot).
   - **Manual only** — you must message them yourself on Instagram. **Expect this to be almost everyone.**
   - **Blocked** — never contact; the reason is shown.
   - A preview of the **exact** message each recipient would get.
5. If it looks right, press **Approve**, then **Prepare drafts**.

Nothing is sent by any of this.

---

## STEP 6 — Send the first 10 messages yourself (the real work)

For each prepared invitation:

1. Copy the **personal link** the system generated (`t.me/Bookora_App_bot?start=p.…`).
2. Open the business's Instagram page.
3. Send the Persian message from `docs/growth/ACQUISITION-PLAYBOOK.md`, with **your own first line** about their salon, and their link.
4. Back in Bookora, press **"I sent this manually"**.

**Ten messages. Not more.** Record honestly: "sent", never "delivered" — Instagram gives no delivery confirmation.

---

## STEP 7 — What to do when someone replies

| They say | You do |
| --- | --- |
| "How does it work?" | Send the booking link demo; answer in one sentence |
| "Is it really free?" | Yes — 1 business, unlimited services, unlimited bookings. Pro adds multiple businesses |
| "My customers don't use Telegram" | **Correct, and it doesn't matter.** The booking page is a normal web link; anyone can book from any browser |
| "Too complicated" | Offer to set it up for them — it is four steps and about two minutes |
| "Not interested" | Mark **عدم علاقه**. Never contact again |
| "Stop" | Mark **عدم تماس**. Permanently suppressed, in every future campaign |

---

## Daily (2 minutes, on your phone)

**Admin → Outreach → Overview** shows bot starts, registrations, activations and first bookings. Only real records appear. Zero is a valid and expected answer for the first week.

## Weekly (10 minutes)

**Admin → Outreach → Prospects** → filter by city → see whose follow-up date has passed → follow up **once**, then stop.

---

## If something breaks

| Symptom | Cause | Fix |
| --- | --- | --- |
| Bot doesn't reply to `/start` | Webhook not configured, or `TELEGRAM_WEBHOOK_SECRET` missing | Step 3 |
| Outreach tab shows an error | Migration not applied | Step 1 |
| Daily report never arrives | `CRON_SECRET` missing | Step 2 |
| "No eligible recipients" on dry run | Nobody verified yet, or nobody has started the bot | Step 4 — and expect to use manual outreach |
| Shared booking link shows no image | OG asset not merged yet | Merges with this branch |

---

## Rules this system will not let you break

- It will not send anything without your explicit approval.
- It will not message someone who has not started the bot (Telegram does not allow it).
- It will not re-contact anyone who said no or STOP — ever, in any future campaign.
- It will not exceed 10 invitations prepared per day, and never raises that limit by itself.
- It will not report a message as "delivered" unless the channel confirmed it.
- It will not invent prospects. Every record keeps the source URL it came from.

---

## Expansion: 100-city registry, message builder, audit (new)

A follow-up branch grew the outreach system without changing anything above:

- **New cities are opt-in.** Up to 100 markets can be registered; only the
  four launch cities are approved. Approve one new city at a time in
  *Admin → Outreach → Campaigns tab → Markets*. Approving unlocks targeting
  only — it never imports prospects and never sends anything.
- **Per-campaign message builder.** Write the invitation, tick which links to
  include (bot link, channel, your own URL), see the exact final preview, save
  while the campaign is DRAFT/REVIEW. After approval it freezes like
  targeting. To use the channel link, set `outreach.channel_url` in Outreach
  settings first — the builder refuses to guess it.
- **Audit trail.** Approvals, pauses, message saves, city approvals and safety
  settings are recorded in `outreach_audit_events`. Apply it with
  `npm run db:push` (or `prisma/sql/0003_outreach_audit.sql`). If you skip it,
  everything keeps working — audit is fail-soft, never blocking.
- **Honest funnel.** The Overview tab now separates *prepared* from
  *delivered* and shows `no source` instead of fake zeros, per campaign/city.

Details: [GROWTH-EXPANSION.md](./GROWTH-EXPANSION.md).
