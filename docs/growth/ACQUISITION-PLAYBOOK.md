# Acquisition playbook — Tehran · Mashhad · Shiraz · Karaj

Written 2026-10-10. Research: `PROSPECTS-FOUR-CITIES.md`. Steps: `OWNER-RUNBOOK.md`.

---

## 1. The one thing that determines success

**90 businesses were researched. 5 have any public Telegram presence. 3 of those 5 are channels or personal accounts a bot cannot message.**

So the honest shape of this campaign is:

> The system prepares a personalised, attributed link and message for each salon. **You send it yourself, by Instagram DM.** The system then tracks what happened.

Automated Telegram delivery is a bonus for the rare business that already messaged the bot. It is not the plan.

This is not a workaround — it is the only compliant option. Telegram does not let a bot open a conversation with someone who has not messaged it first, and no API makes that possible.

---

## 2. Funnel: the 11 milestones

Tracked server-side in `src/lib/funnel.ts`. Stored per row: `event`, `anonId` (salted hash, rotates daily), `locale`, `ref`, `campaignId`, `createdAt`. **No IP, no user agent, no cookie, no Telegram payload.**

| # | Milestone | Fires when |
| --- | --- | --- |
| 1 | Landing page visit | `landing_view` |
| 2 | Campaign-specific visit | `campaign_view` |
| 3 | Signup CTA click | `signup_cta_click` |
| 4 | Signup started | `signup_started` — Mini App opens |
| 5 | Registration completed | `registration_completed` — server-side, on successful auth |
| 6 | Business profile created | `business_created` |
| 7 | First service configured | `service_created` |
| 8 | Available slots configured | `working_hours_configured` |
| 9 | Booking page published | `booking_link_opened` |
| 10 | First real customer booking | `booking_created` |
| 11 | Paid conversion | `paid_conversion` (verified only) |

### Definitions used in every report

| Term | Means |
| --- | --- |
| **Setup activated** | Completed profile **and** ≥1 service **and** ≥1 available slot **and** a working public booking page |
| **Customer acquired** | A real owner registered **and** activated. Not a message, not a click |
| **First real booking** | A genuine customer booking recorded in the system. **Test bookings are excluded** |
| **Paying customer** | A verified subscription payment exists |

**Never count event totals as unique visitors or unique customers.** `anonId` rotates daily by design, so it cannot deduplicate across days.

---

## 3. Attribution

Each prospect gets a unique deep link: `t.me/Bookora_App_bot?start=p.<token>`.

**Fixed in this phase:** Telegram puts the same `start` parameter inside the *signed* initData, so `src/app/api/auth/telegram/route.ts` now reads it and records attribution at authentication time. Previously the parameter was dropped the moment the Mini App authenticated, so registrations could not be tied back to a campaign.

Attribution is recorded only when it is real — a `BotStart` row is written only when Telegram actually delivers a start with that parameter, and it is deduplicated on `(telegramId, startParam)` so one person triggering both paths counts once.

**Remaining gap:** `registration_completed` is attributed when the visitor arrives through a `start=` link. A visitor who finds Bookora some other way has no campaign. That is honest — an unknown source is reported as unknown, not guessed.

---

## 4. Persian message templates

From the brief, adapted to verified product facts only.

### Men's barbershop

```
سلام، وقتتون بخیر.

ما Bookora رو برای ساده‌تر شدن نوبت‌دهی کسب‌وکارهای خدماتی طراحی کردیم. با Bookora می‌تونید یک لینک رزرو آنلاین برای آرایشگاهتون داشته باشید تا مشتری‌ها راحت‌تر زمان مناسب رو انتخاب کنن.

اگر الان نوبت‌ها رو از طریق دایرکت یا تماس هماهنگ می‌کنید، می‌تونید امکانات و شرایط استفاده رو از اینجا بررسی کنید:

[لینک اختصاصی شما]

اگر تمایلی به دریافت پیام دیگری ندارید، لطفاً اطلاع بدید.
```

### Women's hair & beauty salon

```
سلام، وقتتون بخیر.

Bookora یک ابزار نوبت‌دهی آنلاین برای کسب‌وکارهای خدماتیه که به مشتری‌های سالن شما امکان می‌ده از طریق یک لینک، خدمات و زمان‌های قابل رزرو رو مشاهده کنن و نوبتشون رو ثبت کنن.

اگر دوست دارید روش کار و امکاناتش رو بررسی کنید، از این لینک شروع کنید:

[لینک اختصاصی شما]

اگر این موضوع برای سالن شما مناسب نیست، مشکلی نیست؛ فقط اطلاع بدید تا پیگیری دیگری انجام نشه.
```

### Rules for using them

- **Always add one personal first line.** "I saw your work on Instagram…" A generic message is ignored.
- **Never imply they asked to be contacted.**
- **Never claim customers, results or ratings.** There are none yet.
- **Every message offers an exit.** One "no" stops everything permanently.
- **One follow-up maximum** unless they reply.

### Verified facts you may use

| Claim | Verified? |
| --- | --- |
| Free plan = 1 business | ✅ |
| Unlimited services and prices | ✅ |
| Unlimited bookings, no per-appointment fee | ✅ |
| Working hours, breaks, days off | ✅ |
| Optional deposits, paid directly to the owner | ✅ |
| Customers do **not** need Telegram — booking page is a normal web link | ✅ |
| Pro adds multiple businesses | ✅ |
| "Hundreds of salons use Bookora" | ❌ **Never say this. It is false.** |
| Any rating, testimonial or integration | ❌ None exist |

---

## 5. Objection handling (from research done today)

| Objection | Answer |
| --- | --- |
| **"My customers don't use Telegram"** | They don't need to. The booking page is a normal web link — anyone with it can book from any browser, no app, no account. Telegram is only how *you* get notified. |
| **"Telegram is blocked / unreliable here"** | Correct, and that's exactly why Bookora's booking page lives on the web. In Iran, lead with the link. |
| **"I already take bookings by DM"** | You do — that's why this fits. The difference is customers see your free times and pick one, instead of three messages back and forth. |
| **"How much?"** | Free for one business: unlimited services, unlimited bookings. Paid plans add more businesses. |
| **"Is it complicated?"** | Four steps, about two minutes: business → service → hours → share your link. |

---

## 6. Segmentation and reporting matrix

Every metric is grouped by **city × segment**. Empty cells stay empty — never filled with an estimate.

| City | Men's barbershops | Women's salons |
| --- | --- | --- |
| Tehran | verified · eligible · contacted · replied · interested · registered · activated · first booking · paying | same |
| Mashhad | same | same |
| Shiraz | same | same |
| Karaj | same | same |

**Karaj is never merged into Tehran.** `src/lib/outreach/cities.ts` stores city as a stable code and, if a listing mentions more than one approved city, returns `AMBIGUOUS` and leaves it unassigned for a human — it does not guess.

### Stage definitions — each is a real state, not a vibe

| Stage | Means |
| --- | --- |
| Discovered | A name appeared in a source. **Not** a prospect |
| Verified | You opened their public profile and confirmed city + category |
| Eligible | Passed suppression, opt-out, closed-status and pending-invitation checks |
| Approved for outreach | Campaign approved **and** the invitation approved by you |
| Contacted | A message was actually sent by you or by the bot |
| Replied | They answered |
| Interested | They said yes, or asked a buying question |
| Registered | They created a business in Bookora |
| Activated | Profile + service + slots + working public booking page |
| First real booking | A genuine customer booking, not a test |
| Paying customer | A verified subscription payment |

**A contacted prospect is not an interested lead. An interested lead is not a registered customer.**

---

## 7. Follow-up policy

- **One follow-up**, 4 days after the first message, only if there was no reply.
- The system sets `nextFollowUpAt` and the dry run will not re-include a prospect before that date.
- After the follow-up: **stop.** No third message.
- Any "no" or "STOP" → `DO_NOT_CONTACT` + permanent suppression entry. No future campaign, discovery run or manual re-add can reach them.

---

## 8. Weekly rhythm

| Day | Do |
| --- | --- |
| Sat | Load 10 new verified prospects |
| Sun | Dry-run the campaign; read the preview carefully |
| Mon | Approve + prepare |
| Mon–Tue | Send 10 messages yourself, Instagram DM |
| Wed | Follow up with anyone from the previous week whose follow-up date has passed |
| Thu | Nudge anyone who registered but did not finish setup |
| Fri | Read the Overview. Write down the single biggest drop-off and fix it |

---

## 9. What has not happened

**Zero prospects contacted. Zero messages sent. Zero registrations. Zero activations. Zero bookings. Zero revenue. Zero cost.**

As of 2026-10-10 this is a plan backed by real research, not a campaign with results. Report zeros as zeros.
