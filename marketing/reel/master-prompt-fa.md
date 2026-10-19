# مستر پرامپت ویدیوی ریلز بوکورا — نسخهٔ ۲

> نسخهٔ اصلاح‌شدهٔ پرامپت خودت. سه تغییر مهم نسبت به پیش‌نویس اول:
> ۱) سوژه کاملاً ساختگی است و هیچ اشاره‌ای به فرد واقعی/یونیفرم/ایرلاین ندارد.
> ۲) آیدی درست ربات در مخزن پروژه `@Bookora_App_bot` است، نه `@bookora_bot`.
> ۳) «مشتری در اینستاگرام» از ادعای محصول حذف شد؛ بوکورا منشی رزرو و پنل است،
>    نه ابزار پاسخ خودکار به دایرکت اینستاگرام (این را در پرامپت هم قید می‌کنیم تا
>    ادعای غیرواقعی ساخته نشود).

---

## پرامپت (برای Veo / Kling / Runway / Sora — کپی مستقیم)

**Format:** 9:16 vertical, 1080×1920, 30 fps, 30 seconds, cinematic UI-motion-graphics
mixed with one short live-action-style shot. Persian (Farsi) on-screen text,
right-to-left. Warm, professional, optimistic tone. No exaggeration, no invented claims.

**Subject (entirely fictional, AI-generated):** an Iranian woman, 30–35, natural and
friendly, who owns a small beauty salon. Simple cream or beige blazer and a plain
matching headscarf. **No uniform, no airline insignia, no badge, no logo, no resemblance
to any real person.** She never speaks to camera; she is shown working and smiling.

**Set:** a bright, modern, clean beauty salon — warm golden afternoon light, large
mirrors with soft bulbs, marble counter, green plants. No identifiable clients.

**Brand palette:** deep navy `#060C20`, electric blue `#2F80ED`, cyan `#35E0F2`,
violet `#4F5FE8`, warm cream/gold for the salon.

**Storyboard**

| Time | Shot | On-screen Persian text |
|---|---|---|
| 0–3 s | Close-up of a phone in the owner's hand: a chat inbox fills with customer messages, unread badge climbing (۳ → ۶ → ۹). Messages slide up quickly. | «پیام مشتری‌ها تموم نمی‌شه؟» |
| 3–7 s | The Bookora robot logo appears inside a soft blue glow, gentle sparkle, small scale-in. Under it a pill: «۲۴ ساعته، در تلگرام». | «منشی هوشمند رزرو شما» |
| 7–14 s | Real Bookora mini-app screens inside a phone mock: date chips (شنبه ۱۸ مهر selected), then the free-time grid, a finger taps 16:30 (purple selected state), then the details form with sample data. Slow push-in. | «انتخاب ساعت، در چند ثانیه» |
| 14–20 s | The salon owner looks up from her phone and smiles, relaxed. A white toast slides up over her: green check, «رزرو تأیید شد — زهرا و. · شنبه ۱۸ مهر · ۱۶:۳۰». | «رزرو ثبت شد؛ بدون پیام‌های بی‌پایان» |
| 20–25 s | Quick tour of the Bookora dashboard: today's bookings list, services, working hours, a small weekly bar chart; a fresh row pops in green. | «همه‌چیز، در یک پنل» |
| 25–30 s | End card: logo, tagline, bot handle pill, three small benefit chips. | «رزرو آنلاین، ساده و هوشمند» / «@Bookora_App_bot» |

**Typography:** Persian, modern geometric sans (Vazirmatn-class), bold, high contrast,
always inside the central safe area — keep 250 px clear at the top and 250 px at the
bottom for Instagram UI. Maximum 6–8 words per text block. Never put text over faces.

**Motion:** slow push-ins, 8–12 px/s; snappy spring easing on UI elements (about
0.4–0.6 s); no whip pans, no glitch effects, no fast zooms.

**Audio:** warm, clear Persian female voice-over, medium pace, calm and confident.
Music: soft modern electronic pulse, 90–95 BPM, light rise at 25 s, gentle resolve at
the end. Duck the music about 15 dB under the voice.

**Hard rules**
- No real person is simulated, recreated, or implied. The subject is 100% fictional.
- No airline logo, uniform, badge, or any third-party brand mark anywhere in frame.
- Only true product claims: 24/7 online booking, simple management, a better booking
  experience. No «۱۰۰٪ افزایش فروش», no «بدون خطا», no fake statistics.
- Sample customer data only: names like «زهرا و.» and numbers like `۰۹۱۲۰۰۰۰۰۰۰`.
- Bookora is a booking page + dashboard + Telegram bot. Do not show it auto-replying
  to Instagram DMs.

**Negative prompt:** real celebrity, real person likeness, airline uniform, pilot wings,
company badge, extra fingers, warped hands, gibberish text, mirrored Persian, Latin
letters in Persian sentences, logo distortion, watermark, oversaturated skin,
horror lighting, duplicated UI elements.

---

## نسخهٔ کوتاه ۱۵ ثانیه‌ای (استوری)

Only four beats, keep the same look:

1. 0.0–2.2 s — inbox filling + «پیام مشتری‌ها تموم نمی‌شه؟»
2. 2.2–6.0 s — date chips → time grid → tap 16:30 + «انتخاب ساعت، در چند ثانیه»
3. 6.0–10.0 s — owner smiles + «رزرو تأیید شد» toast + «رزرو ثبت شد»
4. 10.0–15.0 s — logo, tagline, `@Bookora_App_bot`, «ساده و هوشمند»

## کاور ریلز

فریم ثانیهٔ ۲ ویدیوی نهایی، با تیتر «ربات رزرو سالن زیبایی» در ناحیهٔ میانی و
بدون متن در ۲۵۰ پیکسل بالا/پایین. فایل آماده: `output/bookora-reel-cover.png`.

## یادداشت حقوقی دربارهٔ عکس واقعی

عکسی که فرستادی یک زن واقعی با یونیفرم IranAir است. در این ویدیو **استفاده نشده**.
او در ویدیو ظاهر نمی‌شود، نه با لباس تغییریافته و نه به‌عنوان تأییدکنندهٔ برند.
سوژهٔ ویدیو (`reel/assets/salon-owner.png`) یک تصویر ساختگی است که با مدل تولید
تصویر ساخته شده و شبیه هیچ فرد واقعی مشخصی نیست.

اگر روزی خواستی از خودِ آن خانم استفاده کنی، پیش از هر انتشار این‌ها لازم است:

- رضایت کتبی و مشخص برای استفادهٔ تبلیغاتی در بوکورا (نه فقط اجازهٔ استفاده از عکس).
- اجازهٔ جداگانه برای هر کانال (اینستاگرام، تلگرام، سایت) و مدت مشخص.
- حذف کامل یونیفرم و هر نشانهٔ سازمانی، چون استفاده از لباس کاری یک شرکت
  می‌تواند ادعای وابستگی یا تأیید سازمانی بسازد.
- ثبت محل نگهداری رضایت‌نامه، تا اگر بعداً پس گرفته شد بتوانی سریع ویدیو را پایین بکشی.
