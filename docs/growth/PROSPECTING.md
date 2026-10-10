# Prospecting — starter list, workflow, and message templates

Status: **research performed, nothing sent.** Written 2026-10-10.

Read this together with [`OUTREACH-SYSTEM.md`](./OUTREACH-SYSTEM.md).

---

## 0. Rules this document follows

| Rule | How it is honoured here |
| --- | --- |
| Only publicly discoverable prospects | Every entry links the **public page where I found it** so you can verify it yourself |
| Never fabricate a prospect | Every name below was read from a live page during this session |
| Never fabricate contact details | No phone numbers or emails are stored. Where a public listing published a phone number, the **listing URL** is given instead — retrieve it there if you need it |
| No bulk automation / scraping | 11 candidates. The system caps itself at 50 discoveries and 10 invitations per day |
| Personalized, low volume | Templates are a starting point; each message must be edited per business |
| Language | Persian for Iran-based businesses, English otherwise |

---

## 1. Verification tiers

Because "I found it on the web" is not the same as "I confirmed it", every entry
carries a tier:

- **Tier A — page fetched and read directly.** I retrieved the Telegram page /
  listing myself and read its content.
- **Tier B — seen in a public directory listing.** The business appeared with its
  public Telegram/Instagram handle on a public directory page that I fetched. I
  did **not** open that handle, so the handle is published-but-unconfirmed.
- **Tier C — directory listing only, no handle seen.** Name and city only. Needs
  manual research before any contact.

**No candidate below has been contacted. No candidate below has agreed to
anything. None of them is a customer.**

---

## 2. Starter list — Tehran barbershops & beauty salons

### Tier A — page read directly

| # | Public name | Niche | City / area | Public handle | Why they fit |
| --- | --- | --- | --- | --- | --- |
| 1 | **سالن زیبایی سالیز** (Saliz Beauty) | Beauty | (not stated) | `t.me/saliz_beauty` — 23 subscribers | Public Persian-language Telegram channel for a beauty salon. Already uses Telegram as a client channel, so the deep link is a natural extension. |
| 2 | **Bahar Banoo beauty salon** | Beauty | (not stated) | `t.me/BaharBanooBeautySalon` — 34 subscribers, 348 photos; Instagram `instagram.com/baharbanoo_beauty_salon` | Posts service work (keratin, nails, lashes). ⚠️ **Important intel:** the owner publicly posted that reaching them on Telegram is hard because of filtering in Iran and that clients should message on Instagram. **Lead with the web booking link, not the bot.** |
| 3 | **سالن زیبایی مسعود دهقان** | Beauty | Tehran, Niavaran (Jamaran, Koocheh Mehr #3) | `t.me/masoud_dehghan1` — from a public Tehran salon directory | A listed Telegram contact for an appointment business. The handle is a **personal account**, not a channel or bot — see the constraint note below. |

### Tier B — handle published in a directory I fetched, handle not opened

| # | Public name | Niche | City / area | Public handle seen in listing | Source |
| --- | --- | --- | --- | --- | --- |
| 4 | **سعید پورانداخت** | Barber | Tehran, Niavaran (Atlas Mall A3-523) | `t.me/saeed_pourandokht`; Instagram `saeed.pourandokht`; `saeedpourandokht.com` | A Tehran barbershop directory that explicitly lists **"تلگرام: رزرو وقت"** (Telegram: booking appointments) for this business — the strongest buying signal found. |
| 5 | **آس Barber** | Barber | Tehran, Tehranpars | Instagram `mohammadkashani_kbc`; `asbarber.com` | Same directory. |
| 6 | **IK barbershop** | Barber | Tehran, Sadeghiyeh | — (phone published in listing) | Same directory. |
| 7 | **First Class** | Barber | Tehran, Zafaraniyeh | — (phone published in listing) | Same directory. |
| 8 | **Hooman Cut** | Barber | Tehran, Valiasr | — (phone published in listing) | Same directory. |

### Tier C — name and city only, needs research

| # | Public name | Niche | City |
| --- | --- | --- | --- |
| 9 | Hairtalkz | Barber | Dubai, Al Karama / Jumeirah |
| 10 | Eman Salon | Beauty | Dubai |
| 11 | The Klippery (uses `book.klipin.app`) | Barber | Dubai |

> #9–#11 are **not** in the chosen niche geography. They are listed only as
> evidence that this category buys booking software (see §5). **Do not contact
> them as prospects** — they are outside the Tehran-first scope, and two of them
> already use a competitor.

### Explicitly rejected

| Rejected | Why |
| --- | --- |
| `t.me/BarberShop_salon` (Uchkuprik, Fergana, Uzbekistan) | Real barbershop with a working Telegram presence — but in **Uzbekistan**, outside the chosen niche. Not contacted. |
| `t.me/s/daily_salon` | A Persian-language **job-adverts channel** for salons. It is a place to *observe* the market, not a prospect. |
| `hkm-reserve.ir` shops | Already listed on a competing booking marketplace. Could be a later "switching" segment; not first-contact material. |

---

## 3. Hard constraint you must understand before sending anything

**A Telegram bot cannot start a conversation with someone who has never messaged
it.** This is a platform rule, not a limitation of this code.

Of the eight usable candidates:

- **#1 and #2 are channels** — a bot cannot DM a channel.
- **#3 is a personal account** with no prior contact with the bot — a bot cannot
  DM it.
- **#4 is listed as using Telegram for bookings**, so it *may* have a bot
  relationship or a public group — must be checked manually.
- **#5–#8** have only Instagram/phone published.

**Therefore: for every candidate on this list, the correct action is manual
outreach through the channel the business actually publishes** — Instagram DM,
the published Telegram contact, or in person. The system supports this exactly:

1. Add the prospect (Admin → Outreach → Prospects).
2. **Prepare** the invitation → the system generates their **unique attributed
   deep link**.
3. **Approve** it.
4. Read the link, then message the business **yourself** on Instagram/Telegram
   using your own account.
5. Press **"I sent this manually"** → status becomes `CONTACTED`, follow-up date
   set. Nothing false is recorded; the system distinguishes "sent" from
   "confirmed delivered".

**Only** a business that has already messaged @Bookora_App_bot can receive an
automatic message from the bot, and only after admin approval.

---

## 4. Message templates

Persian first (the niche is Tehran), English second. Keep them short, specific,
and honest. Fill `{businessName}` and `{link}`.

### Persian — first contact

```
سلام {businessName} عزیز 👋

من مهدی هستم، سازنده‌ی بوکورا — یک صفحه رزرو آنلاین ساده برای آرایشگاه و سالن زیبایی.

مشتری‌هاتون سرویس و زمان خالی رو انتخاب می‌کنن و نوبت مستقیم توی تلگرام به شما پیام داده می‌شه. برای شروع رایگانه و راه‌اندازیش حدود دو دقیقه طول می‌کشه. آخرش یک لینک می‌گیرید که می‌تونید توی بیو اینستاگرام یا کانال بذارید.

اگر خواستید امتحان کنید: {link}

اگر مناسب‌تون نیست، کافیه بگید — دیگه مزاحم نمی‌شم.
```

### Persian — follow-up (send once, 4 days later, only if no reply)

```
سلام {businessName}، پیام قبلی رو پیگیری می‌کنم.

اگر دوست داشتید، لینک اختصاصی رزرو شما آماده‌ست: {link}

دو دقیقه وقت می‌گیره و رایگانه. اگر مناسب‌تون نیست مشکلی نیست، بگید تا دیگه پیام ندم.
```

### English — first contact

```
Hi {businessName} 👋

I'm building Bookora — a simple online booking page for barbershops and salons. Your customers pick a service and a free slot, you get the booking in Telegram. Free to start, setup takes about two minutes, and you get a link you can put in your Instagram bio.

If you'd like to try it: {link}

If it's not for you, just say so and I won't follow up.
```

### English — follow-up

```
Hi {businessName} — following up on my last message. Your booking link is ready: {link}

Two minutes to set up, free to start. If it's not a fit, no problem at all, just let me know and I'll stop.
```

### Rules for using these

- **Personalize the first line.** One sentence proving you looked at them
  ("I saw you post keratin work…"). Generic messages get ignored.
- **Never claim testimonials, user counts, or ratings.** There are none.
- **Every message ends with an exit.** One "no" stops all contact.
- **One follow-up maximum** unless they reply.
- On `STOP` / `/stop`, the contact is written to `OutreachSuppression`
  permanently and can never be messaged again.

---

## 5. Market evidence (why this niche, from research done today)

| Finding | Source | Implication |
| --- | --- | --- |
| Booking habits in Iran/UAE are WhatsApp/Instagram-first; the standard pattern is a shareable link in the bio | Multiple 2025–2026 articles on barber/salon booking habits | The **booking link** is the product, not the bot |
| Automated reminders cut no-shows substantially; deposits are recommended for first-timers | Same research | Existing reminder behaviour is a real selling point — verify what Bookora actually sends before claiming it |
| Telegram Mini Apps reach ~500M monthly users (platform figure, **not** Bookora traction) | Telegram platform reporting | Distribution is real; Bookora's own traction is zero |
| `hkm-reserve.ir` — Iranian barbershop booking marketplace with shops in Tehran, Malard, Nasimshahr, Eslamshahr, Qaemshahr | Fetched directly | **Direct local competitor.** Demand is proven — and so is the need for a differentiator |
| `klipin.app` — UAE salon/barber booking SaaS, e.g. `book.klipin.app/the-klippery` | Fetched directly | Validates the "link in bio, no marketplace, no commission" positioning |
| `bedashingbeauty.com` (24 UAE lounges), `hairtalkz.com`, `emansalon.com` | Fetched directly | Chain/multi-branch salons in the region — larger, slower deals; not first-contact targets |
| An Iranian salon owner publicly said Telegram is hard to reach in Iran and directed clients to Instagram | Fetched directly from the salon's own Telegram page | **Critical objection handling: never sell "Telegram". Sell the web booking link.** |

---

## 6. Lead tracking schema

Admin → Outreach → Prospects stores exactly these fields. Nothing else is
collected — no phone numbers, no emails, no private data.

| Field | Purpose |
| --- | --- |
| `publicBusinessName` | The name the business publishes |
| `category` | `BARBER` / `BEAUTY` / `MEDICAL` / `OTHER` |
| `city`, `country` | Geography, for niche focus |
| `language` | `fa` / `en` / `ar` — decides the template and the bot greeting |
| `publicUrl` | Their public page (Instagram, website, or Telegram channel) |
| `telegramUsername` | Only if publicly published |
| `sourceUrl` | **Where I found them.** Makes every prospect auditable |
| `status` | Pipeline state (below) |
| `nextFollowUpAt` | The single "next action" date |
| `notes` | Why they fit — the personalization hook |

### Status pipeline

```
NEW → CONTACTED → INTERESTED → STARTED_BOT → REGISTERED → ACTIVATED
                            ↘ NOT_INTERESTED ↘ DO_NOT_CONTACT
```

`ACTIVATED` is set **automatically** by `markFirstBooking()` when a prospect's
linked business receives its first booking. It is not self-reported.

---

## 7. What has NOT happened

- **Zero prospects have been contacted.**
- **Zero messages have been sent or delivered.**
- **Zero businesses have been acquired.**
- No invitation has been approved. No campaign has been created.

This document is a research artifact and a workflow. The first real message is
still ahead of you.
