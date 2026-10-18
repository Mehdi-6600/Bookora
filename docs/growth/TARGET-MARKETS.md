# Bookora initial target segments

This document is the current acquisition scope and supersedes the earlier
pilot-plan note that deferred medical practices. Market expansion is still
reviewed separately from sector scope: the city registry contains 100 Iranian
cities and 30 international candidates. All Iranian cities and global markets
with supported outreach languages become campaign-ready automatically; other
global candidates remain gated until localization is added. The global shortlist
is a proxy, not a verified city-level Telegram audience ranking; see
[GLOBAL-MARKETS.md](./GLOBAL-MARKETS.md).

## Initial segments

| Stored segment | Scope | Examples / discovery evidence |
| --- | --- | --- |
| `MENS_BARBER` | Men's barbershops and men's hairdressers | barber, barbershop, آرایشگاه مردانه، پیرایشگاه |
| `WOMENS_SALON` | Women's hair salons and hairdressers | women's hair salon, آرایشگاه زنانه، سالن زیبایی زنانه |
| `WOMENS_BEAUTY` | Specialist women's beauty providers | nails, lashes, brows, makeup, facials, skincare, waxing, ناخن، مژه، میکاپ، فیشیال |
| `MEDICAL_PRACTICE` | Doctors and appointment-based medical practices | physician, dentist, clinic, doctor, پزشک، مطب، دندانپزشک، کلینیک |

The category/group fields remain compatible with the existing values
(`BARBER`, `BEAUTY`, `MEDICAL`); the additional segment codes are stored in the
existing string field and require **no database migration**.

## Guardrails

- Existing campaigns with no selected segment retain the historical default:
  men's barbershops and women's hair salons. The new beauty-specialist and
  medical segments are never silently added to an older campaign.
- To target one of the new segments, an administrator must explicitly select it
  in a campaign, run a dry-run, review the recipients and approve the campaign.
- Ambiguous public profiles that match multiple sector families remain
  unassigned for human review; detection never guesses between them.
- Medical prospecting is business-level only. Do not store patient details,
  diagnoses, appointment reasons or any health data in prospect records or notes.
  Human review of local rules and all claims is required before a medical pilot.
- The system still does not initiate conversations with strangers on Telegram.
  Campaign preparation and delivery protections remain unchanged.

## Discovery

The starter keyword set covers Persian, English and Arabic variants for these
segments. New starter terms are installed additively from **Outreach → Keywords**;
existing administrator-edited terms and disabled flags are preserved. The
manual CSV importer remains limited to public business name, public URL and
optional city; contact columns are ignored.
