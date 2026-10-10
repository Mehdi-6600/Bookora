import { describe, expect, it } from "vitest";
import {
  buildDedupeKey,
  buildSuppressionIdentifier,
  foldText,
  normalizePublicUrl,
  normalizeTelegramUsername,
  sha256,
} from "@/lib/outreach/normalize";

describe("username normalization", () => {
  it("accepts @handles, bare handles and t.me URLs", () => {
    expect(normalizeTelegramUsername("@Mehdi_Barber")).toBe("mehdi_barber");
    expect(normalizeTelegramUsername("Mehdi_Barber")).toBe("mehdi_barber");
    expect(normalizeTelegramUsername("https://t.me/Mehdi_Barber")).toBe("mehdi_barber");
    expect(normalizeTelegramUsername("http://www.telegram.me/Mehdi_Barber?start=1")).toBe(
      "mehdi_barber"
    );
  });

  it("rejects values that are not Telegram usernames", () => {
    expect(normalizeTelegramUsername("ab")).toBeNull();
    expect(normalizeTelegramUsername("")).toBeNull();
    expect(normalizeTelegramUsername("has space")).toBeNull();
    expect(normalizeTelegramUsername("x".repeat(33))).toBeNull();
    expect(normalizeTelegramUsername(null)).toBeNull();
  });
});

describe("public url normalization", () => {
  it("ignores scheme, www, case, query and trailing slash", () => {
    expect(normalizePublicUrl("https://WWW.Instagram.com/Mehdi_Barber/?igshid=1")).toBe(
      "instagram.com/mehdi_barber"
    );
    expect(normalizePublicUrl("http://instagram.com/mehdi_barber/")).toBe(
      "instagram.com/mehdi_barber"
    );
    expect(normalizePublicUrl("not a url")).toBeNull();
    expect(normalizePublicUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("persian / arabic folding", () => {
  it("unifies arabic and persian letter variants", () => {
    expect(foldText("آرایشگاه")).toBe(foldText("آرایشگاه".replace(/\u0643/g, "\u06A9")));
    // Arabic yeh (ي) and Persian yeh (ی) must compare equal.
    expect(foldText("سالن زيبايي")).toBe(foldText("سالن زیبایی"));
    // Diacritics and tatweel are removed.
    expect(foldText("سَــالُن")).toBe(foldText("سالن"));
  });

  it("removes whitespace and punctuation", () => {
    expect(foldText("Mehdi's Barber Shop")).toBe("mehdisbarbershop");
    expect(foldText("  men's salon  ")).toBe("menssalon");
  });
});

describe("dedupe keys", () => {
  it("prefers the telegram username over the url", () => {
    const key = buildDedupeKey({
      telegramUsername: "@Mehdi_Barber",
      publicUrl: "https://instagram.com/mehdi_barber",
      publicName: "Mehdi Barber",
    });

    expect(key).toBe("tg:mehdi_barber");
  });

  it("falls back to the normalized url", () => {
    const key = buildDedupeKey({
      publicUrl: "https://WWW.Instagram.com/Mehdi_Barber/",
      publicName: "Mehdi Barber",
    });

    expect(key).toBe("url:instagram.com/mehdi_barber");
  });

  it("falls back to name + city and is stable across formatting", () => {
    const a = buildDedupeKey({ publicName: "  Mehdi's Barber  ", city: "Tehran" });
    const b = buildDedupeKey({ publicName: "mehdis barber", city: "tehran" });

    expect(a).toBe(b);
    expect(a.startsWith("name:")).toBe(true);
  });

  it("never returns an empty key", () => {
    const key = buildDedupeKey({});

    expect(key.length).toBeGreaterThan(0);
    expect(key.startsWith("hash:")).toBe(true);
  });

  it("produces the same key for the same business reached twice", () => {
    const first = buildDedupeKey({
      telegramUsername: "https://t.me/Mehdi_Barber",
      publicName: "Mehdi Barber",
      city: "Tehran",
    });
    const second = buildDedupeKey({
      telegramUsername: "@mehdi_barber",
      publicName: "Mehdi Barber Shop",
      city: "Tehran",
    });

    expect(first).toBe(second);
  });
});

describe("suppression identifiers", () => {
  it("normalizes every identifier form", () => {
    expect(buildSuppressionIdentifier({ telegramUsername: "@Shop" })).toBe("tg:shop");
    expect(buildSuppressionIdentifier({ telegramId: "12345" })).toBe("user:12345");
    expect(buildSuppressionIdentifier({ telegramId: 12345 })).toBe("user:12345");
    expect(
      buildSuppressionIdentifier({ publicUrl: "https://instagram.com/shop" })
    ).toBe("url:instagram.com/shop");
  });

  it("prefers username over numeric id", () => {
    expect(
      buildSuppressionIdentifier({ telegramUsername: "@Shop", telegramId: "999" })
    ).toBe("tg:shop");
  });

  it("returns null when there is nothing to suppress", () => {
    expect(buildSuppressionIdentifier({})).toBeNull();
    expect(buildSuppressionIdentifier({ telegramId: "not-a-number" })).toBeNull();
  });
});

describe("sha256", () => {
  it("is deterministic and 64 hex chars", () => {
    const hash = sha256("bookora");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256("bookora")).toBe(hash);
    expect(sha256("bookora2")).not.toBe(hash);
  });
});
