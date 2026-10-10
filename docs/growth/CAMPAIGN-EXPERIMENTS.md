# Campaign experiments — design and baseline

Written 2026-10-10. **No data yet.** This document defines the experiment before the first message goes out, so the numbers mean something when they arrive.

---

## 1. The experiment

**One controlled first experiment across 4 cities × 2 segments = 8 cells.**

| Variable | Value |
| --- | --- |
| Cities | Tehran, Mashhad, Shiraz, Karaj |
| Segments | Men's barbershops, Women's hair & beauty salons |
| Channel | Instagram DM, human-sent (see `ACQUISITION-PLAYBOOK.md` §1) |
| Language | Persian |
| Message | The two approved templates, personalised first line |
| Send limit | 10 invitations prepared per day, hard cap |
| Follow-up | One, after 4 days, only if no reply |

**Deliberately held constant:** message wording, channel, language, send volume per cell, follow-up policy. Only **city** and **segment** vary. That is what makes the comparison valid.

**Pilot size:** 5 men's + 5 women's per city = **40 businesses**. This is a research target, not a quota. If a cell cannot be filled with *verified* businesses, the cell is reported short — it is never padded.

---

## 2. What gets measured

| Metric | Source | Notes |
| --- | --- | --- |
| Verified prospects | `OutreachProspect.verificationStatus = VERIFIED` | Per city × segment |
| Outreach-eligible | Campaign dry-run `eligible + manualOnly` | `blocked` reported separately with reasons |
| Approved messages | `OutreachInvitation.status = APPROVED` | Requires your explicit approval |
| Actually sent | `sentAt` set | Bot delivery or your "I sent this manually" |
| Confirmed deliveries | `deliveredAt` set | **Only where the channel confirms it.** Instagram DMs will report 0 confirmed — that is correct, not a bug |
| Replies | Manual status → `INTERESTED`, or an objection note | Recorded by you |
| Interested leads | `status = INTERESTED` | |
| Registrations | `status = REGISTERED` — set automatically when a business is created | |
| Activated businesses | `status = ACTIVATED` — set automatically on the first booking | Requires profile + service + slots + working public page |
| First real bookings | `Booking` on the converted business | Test bookings excluded |
| Paying customers | Verified `Subscription` payment | |
| Verified revenue | Payment records only | |
| Time per acquired customer | Your tracked hours | |
| Cost per acquired customer | Actual spend. **Currently zero** |

**Do not optimise for messages sent, impressions or clicks.** The only outcomes that matter are activated businesses and first real bookings.

---

## 3. Objections, recorded separately by city and segment

Recorded verbatim in `OutreachProspect.notes` and rolled up per cell. Baseline expectations from research — **these are hypotheses, not data**:

| Objection | Expected in | How to test |
| --- | --- | --- |
| "My customers don't use Telegram" | All cells | Count it. If dominant, the landing page must say "no Telegram needed" above the fold |
| "Telegram is unreliable here" | Iran-wide | Already handled in the FAQ; check whether the message needs the same line |
| "I already take bookings by DM" | All cells | If dominant, reframe: the win is *free times visible*, not "booking online" |
| "How much?" | All cells | If dominant, price belongs in the first message |
| "Too complicated" | All cells | If dominant, offer done-for-you setup |
| No reply at all | All cells | If >80%, the channel (Instagram DM) is wrong, not the message |

**No cell is assumed to perform better than another.** Comparison happens only after real data exists in all eight cells.

---

## 4. Decision rules (agreed before the data arrives)

| After | Decide |
| --- | --- |
| 40 messages sent | Which cells produced any reply at all. **If zero replies across all 8 cells, stop and change the channel before sending more.** |
| First 5 replies | Which objection dominates. Fix that one thing in the template, then re-run 10 messages. |
| First registration | Watch where they stall in the 11-step funnel. Fix that step. |
| First activation | Double the effort into that cell only. |
| First paying customer | Then, and only then, consider paid acquisition. Do not spend before this. |

**Sample-size honesty:** 5 businesses per cell cannot produce a statistically meaningful conversion rate. This experiment is designed to find *objections and broken steps*, not to measure rates. Do not publish a rate from n=5.

---

## 5. Baseline — all zeros, dated 2026-10-10

| Metric | Tehran | Mashhad | Shiraz | Karaj | Total |
| --- | --- | --- | --- | --- | --- |
| **Men's barbershops** | | | | | |
| Verified prospects | 0 | 0 | 0 | 0 | **0** |
| Eligible | 0 | 0 | 0 | 0 | **0** |
| Approved | 0 | 0 | 0 | 0 | **0** |
| Sent | 0 | 0 | 0 | 0 | **0** |
| Confirmed delivered | 0 | 0 | 0 | 0 | **0** |
| Replies | 0 | 0 | 0 | 0 | **0** |
| Interested | 0 | 0 | 0 | 0 | **0** |
| Registered | 0 | 0 | 0 | 0 | **0** |
| Activated | 0 | 0 | 0 | 0 | **0** |
| First real booking | 0 | 0 | 0 | 0 | **0** |
| Paying | 0 | 0 | 0 | 0 | **0** |
| **Women's salons** | | | | | |
| Verified prospects | 0 | 0 | 0 | 0 | **0** |
| Eligible | 0 | 0 | 0 | 0 | **0** |
| Approved | 0 | 0 | 0 | 0 | **0** |
| Sent | 0 | 0 | 0 | 0 | **0** |
| Confirmed delivered | 0 | 0 | 0 | 0 | **0** |
| Replies | 0 | 0 | 0 | 0 | **0** |
| Interested | 0 | 0 | 0 | 0 | **0** |
| Registered | 0 | 0 | 0 | 0 | **0** |
| Activated | 0 | 0 | 0 | 0 | **0** |
| First real booking | 0 | 0 | 0 | 0 | **0** |
| Paying | 0 | 0 | 0 | 0 | **0** |

**Costs: 0. Revenue: 0.** No paid services, advertising or subscriptions have been used, and none will be without explicit approval.

**Research inventory available to load (not yet in the database):** 90 entries — Tehran 9, Mashhad 36, Shiraz 24, Karaj 21. See `PROSPECTS-FOUR-CITIES.md`. The uneven split reflects which directories were findable today, not market size.

---

## 6. Where the numbers will come from

| Number | Where to read it |
| --- | --- |
| Verified / eligible / approved / sent | **Admin → Outreach → Campaigns** → dry-run plan and per-campaign counts |
| Per-cell breakdown | Campaign detail → the city × segment table in the plan view |
| Replies / interested / objections | **Admin → Outreach → Prospects** → filter by city and segment |
| Registrations / activations / first bookings | **Admin → Outreach → Overview** |
| Funnel steps 1–11 | **Admin → Outreach → Overview** → funnel list |
| Daily run history | **Admin → Outreach → Discovery** → run log |
| Sent vs confirmed delivered | `OutreachInvitation.sentAt` vs `deliveredAt` — reported separately, never merged |

Every number in that dashboard comes from a real database row. Nothing is estimated, projected or rounded up.
