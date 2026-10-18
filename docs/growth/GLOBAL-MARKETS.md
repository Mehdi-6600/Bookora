# Global city shortlist for Bookora

## Important limitation: this is not a Telegram user-count ranking

Telegram does not publish an audited city-by-city ranking of active users. The
30-city list below is therefore a **market shortlist**, not a claim that these
are the verified top 30 Telegram cities or an exact ordering by user count. It
uses a practical proxy: major urban markets in countries where Telegram is a
well-known consumer messaging channel, with city-level user counts still
unknown. Do not describe the list as measured Telegram audience data.

All 100 Iranian cities are campaign-ready automatically for Persian outreach,
without a city-by-city administrator action. The 30 international candidates
are also registered; seven currently meet the supported-language gate: Cairo,
Alexandria, Karachi, Lahore, Dubai, Mumbai and Delhi. The other 23 stay dormant
automatically until their local outreach language is added. No per-city approval
is required for any language-ready market.

## Selected candidate cities

| Code | City | Country | Pilot rationale |
| --- | --- | --- | --- |
| `ISTANBUL` | Istanbul | Türkiye (`TR`) | Large urban market; high priority candidate |
| `ANKARA` | Ankara | Türkiye (`TR`) | National capital and major service-business market |
| `IZMIR` | Izmir | Türkiye (`TR`) | Large metropolitan market |
| `BURSA` | Bursa | Türkiye (`TR`) | Large urban market |
| `MOSCOW` | Moscow | Russia (`RU`) | Very large metropolitan market |
| `SAINT_PETERSBURG` | Saint Petersburg | Russia (`RU`) | Very large metropolitan market |
| `KAZAN` | Kazan | Russia (`RU`) | Major regional city |
| `NOVOSIBIRSK` | Novosibirsk | Russia (`RU`) | Major regional city |
| `TASHKENT` | Tashkent | Uzbekistan (`UZ`) | Capital and major regional market |
| `SAMARKAND` | Samarkand | Uzbekistan (`UZ`) | Major urban/tourism market |
| `KYIV` | Kyiv | Ukraine (`UA`) | Capital and major metropolitan market |
| `KHARKIV` | Kharkiv | Ukraine (`UA`) | Major urban market |
| `ODESA` | Odesa | Ukraine (`UA`) | Major urban market |
| `CAIRO` | Cairo | Egypt (`EG`) | Very large metropolitan market; Arabic support is available |
| `ALEXANDRIA` | Alexandria | Egypt (`EG`) | Major urban market; Arabic support is available |
| `SAO_PAULO` | Sao Paulo | Brazil (`BR`) | Very large metropolitan market |
| `RIO_DE_JANEIRO` | Rio de Janeiro | Brazil (`BR`) | Very large metropolitan market |
| `JAKARTA` | Jakarta | Indonesia (`ID`) | Very large metropolitan market |
| `KARACHI` | Karachi | Pakistan (`PK`) | Very large metropolitan market; English outreach copy is supported |
| `LAHORE` | Lahore | Pakistan (`PK`) | Very large metropolitan market; English outreach copy is supported |
| `ALMATY` | Almaty | Kazakhstan (`KZ`) | Major urban/business market |
| `ASTANA` | Astana | Kazakhstan (`KZ`) | Capital and business market |
| `BAKU` | Baku | Azerbaijan (`AZ`) | Capital and major urban market |
| `TBILISI` | Tbilisi | Georgia (`GE`) | Capital and major urban market |
| `YEREVAN` | Yerevan | Armenia (`AM`) | Capital and major urban market |
| `DUBAI` | Dubai | United Arab Emirates (`AE`) | International service-business hub; Arabic and English support |
| `MUMBAI` | Mumbai | India (`IN`) | Very large metropolitan market; English outreach copy is supported |
| `DELHI` | Delhi | India (`IN`) | Very large metropolitan market; English outreach copy is supported |
| `MINSK` | Minsk | Belarus (`BY`) | Capital and major urban market |
| `BUENOS_AIRES` | Buenos Aires | Argentina (`AR`) | Very large metropolitan market |

The order of entries in `INTERNATIONAL_TELEGRAM_CANDIDATE_CODES` is not a rank
or a forecast of audience size. Choose a small pilot based on language readiness,
lead quality and measured opt-in/response outcomes; do not launch all markets at
once.

## Operational and safety rules

- Registry size: 130 current entries (100 Iranian + 30 international
  candidates), with capacity for 150. A campaign can select at most 100 cities.
- All 100 Iranian cities are automatically campaign-eligible for Persian
  outreach, without per-city approval. The four original Iranian launch cities
  remain the legacy fallback for empty campaigns so old campaigns do not widen
  silently.
- Seven international candidates become campaign-eligible automatically from
  language metadata: Arabic for Egypt and UAE; English for Pakistan and India.
  The other 23 candidates remain blocked until their outreach locale is added
  to `OUTREACH_LANGUAGES`; an administrator cannot bypass this language gate.
- Auto-readiness only unlocks a city for explicit campaign targeting. It does
  not create prospects, create/approve a campaign, verify businesses or send
  messages. Campaign and recipient review remains human-controlled.
- Free-text auto-detection remains restricted to the four original Iranian
  launch cities even when other cities are campaign-eligible. International
  discovery rows need an exact registered city name/code; ambiguous or unknown
  locations stay unassigned. Country is derived from the registered city on
  promotion.
- Locale readiness is derived from city language metadata intersecting the
  languages actually supported by the outreach system. Adding an outreach
  language makes matching candidates ready automatically, without a per-city
  administrator action.
- This does not change Telegram's contact rule: the bot cannot initiate a DM to
  a person who has not started it. New prospects still require a permitted,
  human-operated first-contact channel; no unsolicited or bulk messages are
  sent automatically.
