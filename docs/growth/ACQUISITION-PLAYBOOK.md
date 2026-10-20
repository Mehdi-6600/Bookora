# Bookora acquisition playbook — organic discovery and free listings

**Current as of 2026-10-20.** This replaces earlier recommendations in this folder to send cold Instagram DMs or Telegram invitations. Do not use those older instructions. This plan relies on opt-in discovery, public listings, and first-party measurement; it sends no prospect messages.

## 1. What is implemented in the product

- Localized sector landing pages: `/for/barbers`, `/for/salons`, `/for/beauty`, `/for/clinics`, with English, Persian (`/fa/...`) and Arabic (`/ar/...`) variants.
- `sitemap.xml` and `robots.txt` include those public pages and exclude app/admin routes.
- Landing pages have canonical/hreflang metadata, Open Graph/Twitter cards, and factual `SoftwareApplication` structured data.
- Each sector page records first-party landing-view and signup-button-click events using a non-personal source label (`seo_<segment>`). The outreach analytics view groups those event counts over the last seven days. They are **events, not unique visitors**, and do not represent submissions on third-party sites.
- The signup CTA opens the Bookora Telegram bot for the business owner to initiate setup. It does not send a message to a business or customer.

## 2. Free listing and distribution options

Only submit from an account that Bookora's owner is authorized to represent. Never invent a physical office, user count, review, customer, or product capability. Re-check each site's current rules at submission time.

| Channel | Cost / eligibility notes | Fit and next action |
|---|---|---|
| [Product Hunt launch](https://www.producthunt.com/launch/how-product-hunt-works) | Launching is free and requires a personal account. Product should be live and usable. Follow the site's rules; do not buy votes, traffic, or a paid hunter. | Strongest international launch directory. Use after a stable first-party domain, working demo, screenshots, and support/contact details are ready. A Product Hunt account and authorized human launch are still required. |
| [Iranikoo](https://iranikoo.com/en) | The site describes adding a business as free and community-driven. Confirm that an online booking SaaS and Bookora's ownership/market are eligible before submission. | Candidate for Persian-language discovery. Use the ready-to-paste listing in §3 if its category and eligibility fit. |
| [Iranmehr — add listing](https://iranmehr.com/add-listing/) | The page advertises a free listing; verify any current category, account, geographic and review requirements before submitting. | Candidate Iranian directory. Do not claim a physical location unless one is real and publicly serviceable. |
| [LinkedIn Company Page](https://www.linkedin.com/help/linkedin/answer/a543852) | Creating a page is free, but requires a LinkedIn member account and authority to represent the company. | Suitable for an organic company presence and product updates; not a reason to DM prospects. Publish useful product/demo content from the authorized page. |
| [AlternativeTo](https://alternativeto.net/faq/) | Requires a verified email and editorial review; adding a product is not a guaranteed listing. | Consider only if Bookora can be accurately compared with existing appointment-booking software. Submit from a verified company email if available; no profile-based advertising. |
| [SaaSHub](https://www.saashub.com/services/submit) | Free submission is reviewed; the product must be in English and the directory's guidance rejects free hosting subdomains such as `*.vercel.app`. | **Blocked until a custom domain is in use** and Bookora's English product presentation is verified. Do not submit the current free Vercel subdomain and waste the review. |
| [IranPage](https://iranpage.com/advertise) | Its advertised free period is a trial that asks for payment-card details and later becomes paid. | Excluded from the no-cost plan. Do not start the trial without separate, explicit budget approval. |
| [Google Business Profile eligibility](https://support.google.com/business/answer/13763036?hl=en) | Normally requires in-person customer contact at a real eligible location or service area. An online-only software product is not eligible. | Do not create a fictitious local Bookora profile. |

### Recommended order

1. Deploy the new pages on Bookora's stable custom domain and verify the live sitemap, robots, canonical URLs and CTA.
2. Claim/create the authorized, free LinkedIn Company Page and publish a short product demo or booking-flow explanation (organic post only).
3. If Iranikoo/Iranmehr confirm fit, submit the Persian listing using §3 and a unique, non-personal attribution ref for each directory.
4. Prepare a Product Hunt launch once the domain, demo, privacy/support information, screenshots and owner account are ready. Launch once; no paid voting or artificial engagement.
5. Revisit SaaSHub after the custom domain is live; consider AlternativeTo only after verifying the comparison category.

## 3. Ready-to-paste listing copy

These are drafts, **not published listings**. Add Bookora's real production URL and support/contact address at submission time. Do not use the temporary Vercel URL if the directory requires a custom domain.

### English

- **Name:** Bookora
- **Tagline:** Online booking pages for salons and service businesses
- **Short description:** Bookora helps appointment-based businesses publish a booking page, list services and available times, and let clients book through a regular web link.
- **Long description:** Bookora is an online booking tool for service businesses such as barbershops, salons, independent beauty professionals and clinics. Owners set up their services and working hours, then share a public booking link. Clients choose an available service and time in a web browser; they do not need Telegram or a Bookora app. The free plan includes one business, unlimited services and bookings, with no per-booking fee. Clinics should use booking fields for scheduling only and avoid collecting sensitive health details.

### Persian

- **نام:** بوکورا (Bookora)
- **شعار:** نوبت‌دهی آنلاین برای سالن‌ها و کسب‌وکارهای خدماتی
- **توضیح کوتاه:** بوکورا به کسب‌وکارهای نوبت‌محور کمک می‌کند صفحه رزرو آنلاین بسازند، خدمات و زمان‌های خالی را نمایش دهند و از طریق یک لینک وب نوبت بگیرند.
- **توضیح کامل:** بوکورا ابزار نوبت‌دهی آنلاین برای آرایشگاه‌ها، سالن‌های زیبایی، متخصصان مستقل زیبایی و مطب‌هاست. صاحب کسب‌وکار خدمات و ساعت کاری را تنظیم می‌کند و لینک عمومی رزرو را به اشتراک می‌گذارد. مشتری از مرورگر، خدمت و زمان مناسب را انتخاب می‌کند و به حساب تلگرام یا نصب برنامه بوکورا نیاز ندارد. پلن رایگان شامل یک کسب‌وکار، خدمات و رزرو نامحدود و بدون کارمزد به‌ازای هر رزرو است. برای مراکز درمانی، فیلدهای رزرو را فقط برای زمان‌بندی استفاده کنید و اطلاعات حساس سلامت را ثبت نکنید.

## 4. Attribution and measurement

- The sector pages already emit `landing_view` and `signup_cta_click` with non-personal refs `seo_barbers`, `seo_salons`, `seo_beauty`, and `seo_clinics`.
- Admin acquisition analytics displays their seven-day event counts. These counts are not unique visitors, external directory views, registrations, or paid customers.
- For a directory listing, use a real campaign ref created through the existing campaign tooling (for example, `iranikoo_fa`) and link to a relevant landing page with `?ref=<campaign-code>`. The page preserves that ref in the owner-initiated bot start link. Do not put a person's name, phone number, or other personal data in a ref.
- Review `signup_cta_click`, bot start, registration, activation and paid conversion as separate milestones. Do not describe clicks or bot starts as paying customers.

## 5. Non-goals and safety boundaries

- No unsolicited Instagram, Telegram, WhatsApp, email or phone outreach—manual or automated.
- No scraping personal contact information, evading platform limits, buying votes/reviews, or misrepresenting a local business address.
- No paid directory, trial that requires a payment card, or campaign spend without separate explicit approval.
- No claim that an external listing has been submitted until the owner-authorized form has actually been completed and the site confirms receipt/publication.

## 6. Submission status

No external directory listing, Product Hunt launch, or LinkedIn Page was submitted by this implementation. Those actions require an authorized account and verification on the destination site. The code changes prepare Bookora's inbound pages, sitemap/robots and measurement; they do not impersonate the owner or claim an external publication.
