# Daily keyword-based prospect discovery — Phase 9

Status: **implemented, not yet run in production.** Written 2026-10-10.

---

## 1. Honest scope

**This system does not search Telegram for users or businesses.** Telegram
provides no API for that, and scraping it would violate its Terms of Service and
the constraints of this project. Anyone who tells you their bot "finds prospects
on Telegram" is either using user accounts (against ToS) or reselling you a
list.

What the discovery job actually does:

| Source | Enabled by default | What it is |
| --- | --- | --- |
| `manual` | ✅ yes | A list of **public** business pages/channels that an admin pastes in (Admin → Outreach → Discovery → "Verified public pages"). One public URL per line. |
| `feed` | ❌ no | An admin-configured **HTTPS JSON feed** of public business records that the operator is authorised to use (`outreach.feed_url`). Off because there is no such feed yet. |

Both paths only ever read **public** information: a public name, a public
username, a public description. No logins, no private APIs, no purchased lists,
no personal data.

**If neither source is configured, the daily job discovers nothing and reports
zero.** That is the honest default and it is what will happen on day one.

---

## 2. Keyword system

Admin → Outreach → Keywords. Editable, per-group, per-language, with priority.

Default seed (installed with one click; all 28 terms from the Phase-9 brief):

| Group | English | Persian |
| --- | --- | --- |
| **Barbers** | barber, barbershop, hairdresser, hairstylist, men's salon, mens salon | آرایشگر مردانه، پیرایشگاه، آرایشگاه مردانه، سلمانی |
| **Beauty** | beauty salon, makeup artist, nail technician, nail salon, lash artist, salon | سالن زیبایی، ناخن‌کار، میکاپ آرتیست، آرایشگاه زنانه |
| **Medical** | doctor, dentist, dermatologist, physiotherapist, clinic | پزشک، دندانپزشک، متخصص پوست، فیزیوتراپی، کلینیک |

### Matching

`src/lib/outreach/keywords.ts` matches on `name`, `username`, and `description`.

- **Unicode-normalised** for Persian/Arabic: `ي→ی`, `ك→ک`, `ة→ه`, digits
  normalised to ASCII, ZWNJ/kashida/tatweel/diacritics removed, punctuation and
  whitespace stripped. So `سالن زیبایی` matches a page written as `سالن زيبايي`.
- Case-insensitive; English matched on **word boundaries** (so "bar" does not
  match "barber"), Persian matched by **substring** (correct for Persian
  morphology).
- Both scripts are matched against **every** field regardless of the keyword's
  declared language, because real Iranian businesses mix Latin and Persian in
  one name.

### Scoring

```
score = Σ (10 × priority of each matched keyword)
      + 15 if the winning group is BARBER          (today's target niche)
      + 10 if the winning group is BEAUTY
      +  5 if a public description was available
capped at 100
```

Candidates below `outreach.min_score` (default **30**) are dropped as
low-relevance.

---

## 3. Dedupe and exclusions

`src/lib/outreach/normalize.ts` builds a stable `dedupeKey`:

- Telegram source → `tg:<lowercased username>`
- Any other source → `url:<scheme-less, www-less, lowercased, trailing-slash-stripped, sorted-query host+path>`

Before a candidate is stored, `isAlreadyKnown()` rejects it if:

| Rule | Why |
| --- | --- |
| The `dedupeKey` already exists in `DiscoveryCandidate` | Already in the pipeline |
| The `dedupeKey` already exists in `OutreachProspect` | Already a known prospect |
| The Telegram username matches an **existing customer** (`User.telegramUsername`) | Never re-approach a customer as a cold prospect |
| Another candidate in the same batch has the same key | In-batch duplicate |

---

## 4. Quotas

| Setting | Default | Hard cap | Enforced in |
| --- | --- | --- | --- |
| `outreach.daily_discovery_limit` | **50** | 500 | `clampDiscoveryLimit` |
| `outreach.daily_invitation_limit` | **10** | 100 | `clampInvitationLimit` |

- Discovery stops pulling once the quota is hit; remaining candidates are
  reported as `remaining`.
- At most `daily_invitation_limit` invitations are **prepared** per run, and at
  most that many are **delivered** per run.
- **The system never raises its own quota.** There is no code path that
  increments a limit; only an admin PUT to `/api/admin/outreach/settings` can
  change it, and it is clamped to the cap.
- These are **discovery and preparation limits, not delivery guarantees.**
  Nothing here promises 50 messages a day. In practice the manual source will
  produce far fewer, and most prepared invitations will require manual outreach.

---

## 5. Scheduling

`vercel.json` declares a second cron job:

```json
{ "path": "/api/cron/daily-growth", "schedule": "0 6 * * *" }
```

**Vercel cron limits — checked before implementing:**

| Plan | Limits |
| --- | --- |
| **Hobby** | Jobs run **at most once per day**, **UTC only**, one schedule per path |
| **Pro** | Up to every minute, custom timezones, more jobs |

Bookora is deployed on Vercel. The exact plan was **not verified** from this
sandbox (no Vercel access). Two consequences:

1. **Hobby supports multiple cron entries** (one per path), so adding a second
   job is fine. If the deploy is rejected, the fallback is to call the growth
   job from inside the existing `expire-pending` cron or to use an external
   scheduler (GitHub Actions → POST with the bearer secret).
2. Cron always fires in **UTC**. The `outreach.timezone` setting therefore does
   **not** move the trigger; it only decides which local calendar date a run is
   filed under and how the report is labelled.

### Idempotency

`DiscoveryRun.runDate` is `@unique`. `runDate` is the **calendar date in the
configured timezone** (`runDateFor`), not the raw UTC date. If the same date is
requested twice, the run is skipped and `{"skipped": true}` is returned — so a
Vercel retry, a redeploy, or a double trigger cannot duplicate discovery or
invitations.

`DiscoveryRun` stores `status` (`RUNNING` / `OK` / `FAILED`), `startedAt`,
`finishedAt`, counters, and — on failure — **only `error.name`**. No secrets,
no tokens, no message bodies, no personal data.

### Endpoint security

`src/lib/security/cron-auth.ts::hasValidCronAuthorization`:

1. `CRON_SECRET` unset or shorter than 32 chars → **503** and a clear message
   (a missing secret must not silently disable the job).
2. `Authorization: Bearer <secret>` compared with `crypto.timingSafeEqual` →
   **401** on mismatch.

---

## 6. Daily admin report

`src/lib/outreach/report.ts` → sent to `adminTelegramIds` after every run.

```
📊 Bookora daily growth report — 2026-10-10 (UTC)
Source: manual · Run status: OK

🔎 Discovered 3 · duplicates 1 · excluded 0 (limit 50)
✉️ Prepared 3 · of which ready to send 0
📤 Sent 0 · confirmed delivered 0
🚀 Bot starts (24h) 0 · last 7 days 0
🏪 Registered 0 · activated 0
🎉 First bookings 0
⚠️ Manual review needed: 3
```

Every number comes from a real query. "Confirmed delivered" counts only
invitations whose `deliveredAt` was set by a successful Bot API call — nothing
is reported as delivered that was not confirmed. "Manual review needed" is the
count of `DRAFT` invitations waiting for an admin.

---

## 7. Tests

`src/lib/__tests__/outreach-discovery.test.ts` — **13 tests**

| Area | Tests |
| --- | --- |
| Bilingual keyword matching (EN + FA, mixed script) | 3 |
| Scoring, priority, and the 100 cap | 3 |
| Dedupe / exclusion / existing-customer rejection | 3 |
| Quota enforcement (discovery + invitation) | 2 |
| Idempotent second run on the same date | 1 |
| Failure path recorded in `DiscoveryRun` | 1 |

---

## 8. What has NOT been verified

- The job has **never executed against production**. No `CRON_SECRET` exists in
  my environment and there is no database.
- Whether the deployed Vercel plan accepts a second cron entry.
- Whether any authorized `feed_url` will ever exist — until one is configured,
  discovery output equals whatever the admin enters manually.

**Do not report this feature as "operational" until a real run has been observed
in `DiscoveryRun` with `status = "OK"`.**
