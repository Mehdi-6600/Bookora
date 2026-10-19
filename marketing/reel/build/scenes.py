"""Scene compositions for the Bookora 30-second reel.

Each scene is a pure function of local time that paints a 1080x1920 float32
RGB frame.  Coordinates are in pixels; typography is Persian-first (RTL).
"""

from __future__ import annotations

import functools
import io
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import reelkit as rk
from reelkit import (
    BLUE,
    CYAN,
    H,
    INK,
    MUTED,
    NAVY,
    SKY,
    VIOLET,
    W,
    WHITE,
)

A = rk.ASSETS

LOGO = Image.open(os.path.join(A, "logo-bookora.png")).convert("RGB")
OWNER = Image.open(os.path.join(A, "salon-owner.png")).convert("RGB")
INTERIOR = Image.open(os.path.join(A, "salon-interior.png")).convert("RGB")

PAGE_BG = (131, 169, 235)
SUB = (176, 196, 226)
INK_SOFT = (58, 76, 112)
MAPLE = (28, 40, 66)

# ------------------------------------------------------------------ helpers


def shaped(draw: ImageDraw.ImageDraw, xy, text, weight, size, fill, anchor="rm"):
    draw.text(xy, rk.shape(text), font=rk.font(weight, size), fill=fill, anchor=anchor)


def txt(
    frame: np.ndarray,
    text: str,
    size: int,
    weight: str = "Black",
    color=WHITE,
    cx: float = W / 2,
    cy: float | None = None,
    opacity: float = 1.0,
    shadow: bool = True,
    max_w: int = 980,
    rtl: bool = True,
) -> Image.Image:
    im = rk.text_img(
        text,
        weight,
        size,
        color,
        shadow=(2, 8, 26) if shadow else None,
        shadow_alpha=210,
        shadow_blur=22,
        shadow_dy=8,
        max_width=max_w,
        rtl=rtl,
    )
    rk.blend(frame, im, cx - im.width / 2, cy - im.height / 2, opacity)
    return im


def enter(t: float, start: float, dur: float = 0.55, dy: float = 46.0) -> tuple[float, float]:
    k = rk.span(t, start, dur)
    e = rk.ease_out(k)
    return e, (1 - e) * dy


def cover_blur(img: Image.Image, blur: float, zoom: float = 1.0) -> Image.Image:
    return rk.cover(img, W, H, zoom=zoom).filter(ImageFilter.GaussianBlur(blur))


# ------------------------------------------------------------------ backgrounds

_BGS: dict[str, np.ndarray] = {}


def bg_navy(key, top, bottom, glow, strength=1.0, add_image=None) -> np.ndarray:
    """Cached backgrounds are stored as JPEG bytes (~150 KB each instead of 8 MB)
    so the renderer's memory stays flat on small sandboxes."""
    if key not in _BGS:
        base = rk.base_background(
            top=top, bottom=bottom, glow_center=glow[0], glow_radius=glow[1], glow_color=glow[2], glow_strength=strength
        )
        if add_image is not None:
            img, alpha_, blur = add_image
            layer = cover_blur(img, blur, zoom=1.1)
            base = base * (1 - alpha_) + np.asarray(layer, dtype=np.float32) * alpha_
        buf = io.BytesIO()
        Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), "RGB").save(buf, "JPEG", quality=93, subsampling=0)
        _BGS[key] = buf.getvalue()
    return np.asarray(Image.open(io.BytesIO(_BGS[key])).convert("RGB"), dtype=np.float32)


def bg_hook():
    return bg_navy("hook", (11, 20, 50), (3, 6, 18), ((0.5, 0.30), 0.60, (26, 74, 205)), 0.95, (INTERIOR, 0.14, 32))


def bg_intro():
    return bg_navy("intro", (9, 18, 48), (2, 5, 16), ((0.5, 0.50), 0.55, (34, 92, 235)), 1.1)


def bg_ui():
    return bg_navy("ui", (8, 16, 44), (3, 7, 22), ((0.5, 0.68), 0.55, (28, 84, 220)), 0.95)


def bg_result():
    return bg_navy("result", (10, 16, 36), (3, 6, 18), ((0.5, 0.28), 0.62, (34, 78, 190)), 0.5, (OWNER, 0.30, 36))


def bg_panel():
    return bg_navy("panel", (8, 16, 46), (3, 7, 20), ((0.5, 0.58), 0.55, (30, 88, 225)), 0.85)


def bg_end():
    return bg_navy("end", (10, 20, 54), (2, 5, 15), ((0.5, 0.38), 0.58, (32, 96, 240)), 1.15)


# ------------------------------------------------------------------ brand parts


@functools.lru_cache(maxsize=1)
def _logo_master(n: int = 600) -> Image.Image:
    n = max(2, n)
    im = np.asarray(LOGO.resize((n, n), Image.LANCZOS), dtype=np.float32)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    r = np.sqrt(((xx - n / 2) / (n / 2)) ** 2 + ((yy - n / 2) / (n / 2)) ** 2)
    a = np.clip((1.02 - r) / 0.26, 0, 1) * 255
    arr = np.dstack([im, a]).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def logo_sprite(size: int) -> Image.Image:
    master = _logo_master(600)
    n = max(2, int(size))
    if n == 600:
        return master
    return master.resize((n, n), Image.LANCZOS)


def logo(frame, cx, cy, size, opacity=1.0):
    sprite = logo_sprite(int(round(size)))
    rk.blend_add(frame, sprite, cx - sprite.width / 2, cy - sprite.height / 2, opacity)


def sparkles(frame, t, cx, cy, radius, n=14, t0=0.0, color=(120, 210, 255)):
    rng = np.random.default_rng(41)
    for i in range(n):
        ang = rng.uniform(0, 2 * math.pi)
        rad = radius * rng.uniform(0.55, 1.15)
        size = rng.uniform(3, 6)
        ph = rng.uniform(0, 6.28)
        x = cx + math.cos(ang) * rad
        y = cy + math.sin(ang) * rad * 0.9
        k = rk.span(t, t0 + i * 0.04, 0.9)
        tw = rk.pulse(t + ph, 2.2, 0.25, 1.0)
        sprite = rk.glow_sprite(int(size * 7), color, 1.6, 255)
        rk.blend_add(frame, sprite, x - sprite.width / 2, y - sprite.height / 2, k * tw * 0.22)


def glass_pill(text, size=32, weight="Bold", fg=WHITE, icon_name=None, icon_color=CYAN, rtl=True):
    ic = rk.icon(icon_name, int(size * 1.05), icon_color) if icon_name else None
    return rk.chip_img(
        text, weight, size, fg, (16, 34, 70, 215), (120, 190, 255, 120), 30, 15, ic, 12,
        shadow=(0, 8, 26, 110), rtl=rtl, icon_side="right" if rtl else "left",
    )


def bubble(text: str, size=29) -> Image.Image:
    t = rk.text_img(text, "Bold", size, (24, 34, 58), pad=10, max_width=300)
    tw, th = t.width - 20, t.height - 20
    w, h = tw + 52, th + 36
    layer = Image.new("RGBA", (w + 50, h + 50), (0, 0, 0, 0))
    shadow = rk.card_img(w, h, 24, (0, 0, 0, 0), None, 0, (0, 0, 0, 95), 26, 12, 0)
    layer.alpha_composite(shadow, (0, 0))
    card = rk.card_img(w, h, 24, (255, 255, 255, 248), None, 0, None, 0, 0, 0)
    tail = Image.new("RGBA", (44, 32), (0, 0, 0, 0))
    ImageDraw.Draw(tail).polygon([(0, 0), (40, 3), (2, 28)], fill=(255, 255, 255, 248))
    card.alpha_composite(tail, (w - 34, h - 20))
    layer.alpha_composite(card, (25, 25))
    layer.alpha_composite(t, (25 + (w - tw) // 2, 25 + (h - th) // 2))
    return layer


# ------------------------------------------------------------------ DM mock

DM_ROWS = [
    ("سارا", (216, 232, 255), (70, 110, 220), "سلام، برای فردا ۴ عصر نوبت دارید؟", "۰۹:۱۲", True),
    ("مهسا", (255, 231, 214), (198, 116, 60), "رنگ مو چقدر می‌شه؟", "۰۹:۱۵", True),
    ("نگین", (226, 213, 255), (118, 82, 208), "شنبه ساعت ۱۱ آزاده؟", "۰۹:۲۲", True),
    ("الهام", (208, 243, 224), (52, 148, 96), "می‌شه پنجشنبه بیام؟", "۰۹:۳۱", False),
    ("رویا", (255, 216, 231), (203, 76, 128), "منتظر جوابم، ممنون", "۰۹:۴۴", False),
    ("مریم", (206, 238, 248), (40, 145, 176), "کوتاهی مو با شامپو چنده؟", "۰۹:۵۱", False),
    ("پریسا", (255, 238, 205), (176, 134, 40), "برای عروسی شنبه وقت دارید؟", "۱۰:۰۳", False),
    ("شیدا", (214, 232, 255), (58, 108, 200), "کراتین چقدر زمان می‌بره؟", "۱۰:۱۲", False),
    ("هستی", (226, 255, 236), (44, 150, 96), "می‌شه ساعت ۵ بیام؟", "۱۰:۲۶", False),
]


def ellipsize(text, weight, size, max_w):
    f = rk.font(weight, size)
    if f.getlength(rk.shape(text)) <= max_w:
        return text
    while text and f.getlength(rk.shape(text + "…")) > max_w:
        text = text[:-1]
    return text + "…"


DM_W, DM_H = 640, 1120
DM_ROW_H = 146
DM_LIST_TOP = 112


def _dm_header(d: ImageDraw.ImageDraw, width: int) -> None:
    d.rectangle((0, 0, width, 100), fill=(255, 255, 255))
    d.line((0, 100, width, 100), fill=(228, 235, 245), width=2)
    shaped(d, (width - 28, 56), "پیام‌ها", "Bold", 29, (20, 30, 52), anchor="rm")
    d.line((34, 46, 34, 66), fill=(40, 54, 84), width=4)
    d.line((34, 46, 46, 56), fill=(40, 54, 84), width=4)
    d.line((34, 66, 46, 56), fill=(40, 54, 84), width=4)
    d.ellipse((width - 68, 44, width - 54, 58), fill=(232, 238, 248))


def _dm_composer(img: Image.Image, width: int, height: int) -> None:
    d = ImageDraw.Draw(img)
    cy = height - 98
    d.rectangle((0, cy - 10, width, height), fill=(255, 255, 255))
    d.line((0, cy - 10, width, cy - 10), fill=(228, 235, 245), width=2)
    d.rounded_rectangle((26, cy + 16, width - 92, cy + 72), radius=28, fill=(241, 245, 251))
    shaped(d, (width - 54, cy + 44), "پیام شما…", "Medium", 22, (160, 172, 196), anchor="rm")
    d.ellipse((width - 78, cy + 16, width - 22, cy + 72), fill=(79, 95, 232))
    d.polygon([(width - 62, cy + 44), (width - 38, cy + 30), (width - 46, cy + 60)], fill=(255, 255, 255))


@functools.lru_cache(maxsize=1)
def dm_rows_list() -> Image.Image:
    """All six message rows, drawn once, 146 px apart."""
    width = DM_W
    rows = len(DM_ROWS)
    # extra headroom: the viewport is filled twice, plus blank room under the last row
    list_h = DM_H - 108 - DM_LIST_TOP
    img = Image.new("RGB", (width, max(rows * DM_ROW_H, 2 * list_h) + 8 * DM_ROW_H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    for i, (name, bg, fg, msg, tm, unread) in enumerate(DM_ROWS):
        y0 = i * DM_ROW_H
        if i:
            d.line((28, y0, width - 28, y0), fill=(234, 239, 247), width=2)
        ax = width - 118
        d.ellipse((ax, y0 + 26, ax + 88, y0 + 114), fill=bg)
        shaped(d, (ax + 44, y0 + 72), name[0], "Bold", 36, fg, anchor="mm")
        if unread:
            d.ellipse((ax - 4, y0 + 94, ax + 26, y0 + 124), fill=(79, 95, 232))
            shaped(d, (ax + 11, y0 + 109), "۱", "Bold", 18, (255, 255, 255), anchor="mm")
        shaped(d, (ax - 22, y0 + 50), name, "Bold", 29, (22, 32, 56), anchor="rm")
        shaped(d, (ax - 22, y0 + 90), ellipsize(msg, "Medium", 23, 320), "Medium", 23, (118, 132, 158), anchor="rm")
        shaped(d, (26, y0 + 46), tm, "Medium", 20, (150, 162, 186), anchor="lm")
    return img


def dm_screen(scroll: float = 0.0) -> Image.Image:
    """Chat list scrolled by `scroll` rows, newest arriving from the bottom."""
    width, height = DM_W, DM_H
    img = Image.new("RGB", (width, height), (255, 255, 255))
    list_h = height - 108 - DM_LIST_TOP
    rows_img = dm_rows_list()
    off = int(round(scroll * DM_ROW_H))
    # One viewport-sized crop: the source is taller than 2x the viewport, so any
    # scroll offset stays inside the image (no black padding at the edges).
    view = rows_img.crop((0, off, width, off + list_h))
    img.paste(view, (0, DM_LIST_TOP))
    _dm_header(ImageDraw.Draw(img), width)
    _dm_composer(img, width, height)
    return img


@functools.lru_cache(maxsize=12)
def dm_state(scroll_rows: float) -> Image.Image:
    return rk.phone_layer(dm_screen(scroll_rows), (12, 18, 36), 64, 12)


# ------------------------------------------------------------------ scene 1: hook

S1 = 3.20


def scene_hook(t: float) -> np.ndarray:
    frame = bg_hook()
    rk.add_glow(frame, 540, 1040, 1200, (30, 92, 220), 2.0, 0.45)
    sparkles(frame, t, 540, 900, 470, 9, 0.3)

    k, dy = enter(t, 0.12, 0.6, 40)
    txt(frame, "پیام مشتری‌ها", 84, "Black", WHITE, cy=300 + dy, opacity=k, max_w=940)
    txt(frame, "تموم نمی‌شه؟", 84, "Black", CYAN, cy=396 + dy, opacity=k, max_w=940)

    # the list keeps filling: scroll two rows, then two more
    sc1 = rk.ease_out(rk.span(t, 0.95, 0.45)) * 2.0
    sc2 = rk.ease_out(rk.span(t, 2.10, 0.45)) * 2.0
    scroll = sc1 + sc2
    phone = dm_state(round(scroll, 2))

    k2 = rk.spring(rk.span(t, 0.06, 0.85), 7.0, 5.0)
    bob = math.sin(t * 1.35) * 6
    rk.blend_scaled(frame, phone, 540, 1042 + (1 - k2) * 100 + bob, 0.93 + 0.07 * k2, 1.0)

    n_new = 3 if t < 1.1 else (6 if t < 2.2 else 9)
    bp = rk.chip_img(f"{rk.fa(n_new)} پیام بی‌جواب", "Bold", 30, (255, 255, 255), (232, 72, 84, 255), None,
                     26, 13, rk.icon("bell", 30, (255, 255, 255)), 10, shadow=(0, 8, 22, 140))
    scale = 1.0 + 0.05 * rk.pulse(t, 1.8, 0, 1)
    rk.blend_scaled(frame, bp, 742, 486, scale, k2)

    b1 = bubble("فردا ۴ عصر نوبت دارید؟", 27)
    k3, dy3 = enter(t, 1.30, 0.5, 30)
    rk.blend(frame, b1, 6 + (1 - k3) * -40, 706 + dy3, k3)

    b2 = bubble("قیمت رنگ مو؟", 27)
    k4, dy4 = enter(t, 2.15, 0.5, 30)
    rk.blend(frame, b2, 1006 - b2.width + (1 - k4) * 40, 1248 + dy4, k4)

    rk.add_grain(frame, t, 2.0)
    return frame


# ------------------------------------------------------------------ scene 2: intro

S2 = 3.85


def scene_intro(t: float) -> np.ndarray:
    frame = bg_intro()
    k, dy = enter(t, 0.05, 0.55, 34)
    txt(frame, "منشی هوشمند", 84, "Black", WHITE, cy=300 + dy, opacity=k, max_w=940)
    txt(frame, "رزرو شما", 84, "Black", CYAN, cy=394 + dy, opacity=k, max_w=940)

    ks = rk.spring(rk.span(t, 0.22, 1.0), 6.4, 5.2)
    size = 520 * (0.84 + 0.16 * ks)
    glow_a = 0.5 + 0.16 * rk.pulse(t, 2.6, 0, 1)
    rk.add_glow(frame, 540, 842, 1180, (36, 100, 245), 2.1, glow_a)
    logo(frame, 540, 842 + (1 - ks) * 40, size, min(1.0, ks * 1.25))
    sparkles(frame, t, 540, 842, 320, 14, 0.45)

    kp, dyp = enter(t, 0.95, 0.5, 26)
    pill = rk.chip_img("۲۴ ساعته، در تلگرام", "Bold", 34, CYAN, (12, 30, 66, 235), (86, 180, 255, 110), 34, 16,
                       rk.icon("clock", 32, CYAN), 12, shadow=(0, 8, 26, 130))
    rk.blend(frame, pill, 540 - pill.width / 2, 1160 + dyp, kp)

    chips = [("clock", "رزرو ۲۴ ساعته"), ("send", "لینک اختصاصی"), ("grid", "مدیریت آسان")]
    CHIP_W, GAP, PAD = 292, 18, 44  # PAD = card_img shadow padding on each side
    total = 3 * CHIP_W + 2 * GAP    # visible width only
    for i, (ic, label) in enumerate(chips):
        kc, dyc = enter(t, 1.40 + i * 0.13, 0.5, 34)
        card = rk.card_img(CHIP_W, 92, 26, (255, 255, 255, 18), (110, 170, 240, 76), 2, (0, 6, 20, 90), 22, 10)
        ox, oy = (card.width - CHIP_W) // 2, (card.height - 92) // 2
        icon = rk.icon(ic, 30, (110, 200, 245))
        label_im = rk.text_img(label, "Bold", 24, (226, 238, 255), pad=8)
        tw = label_im.width - 16
        card.alpha_composite(icon, (ox + CHIP_W - 22 - icon.width, oy + (92 - icon.height) // 2))
        card.alpha_composite(label_im, (ox + CHIP_W - 22 - icon.width - 6 - tw, oy + (92 - 24) // 2 - 8))
        rk.blend(frame, card, 540 - total / 2 + i * (CHIP_W + GAP) - PAD, 1298 + dyc, kc)

    rk.add_grain(frame, t, 2.0)
    return frame


# ------------------------------------------------------------------ scene 3: UI demo

S3 = 5.80
UI_PHONE_W, UI_PHONE_H = 664, 1278
UI_SCREEN_W, UI_SCREEN_H = UI_PHONE_W - 24, UI_PHONE_H - 24
UI_CENTER_Y = 1030

SHOTS = {
    # 1125x2204 = exactly the 640:1254 screen aspect, cropped below the browser chrome
    "date": ("ui-date.png", (0, 0, 1125, 2204)),
    "selected": ("ui-selected.png", (0, 0, 1125, 2204)),
    "form": ("ui-form.png", (0, 0, 1125, 2204)),
    "success": ("ui-success.png", (0, 0, 1125, 2204)),
}
_UI_CACHE: dict[str, Image.Image] = {}
_UI_MAP: dict[str, float] = {}


def ui_screen(key: str) -> Image.Image:
    if key in _UI_CACHE:
        return _UI_CACHE[key]
    fname, box = SHOTS[key]
    shot = Image.open(os.path.join(A, "ui", fname)).convert("RGB").crop(box)
    content = shot.resize((UI_SCREEN_W, UI_SCREEN_H), Image.LANCZOS)
    bar = rk.status_bar(UI_SCREEN_W, content.getpixel((4, 8)), (24, 38, 72), "۹:۴۱")
    content.paste(bar, (0, 0), bar)
    _UI_MAP[key] = UI_SCREEN_W / (box[2] - box[0])
    screen = rk.phone_layer(content, (13, 22, 44), 62, 12)
    _UI_CACHE[key] = screen
    return screen


def to_screen_pt(key: str, x_full: float, y_full: float, phone_left: float, phone_top: float) -> tuple[float, float]:
    scale = _UI_MAP[key]
    _, (bx, by) = SHOTS[key][0], (SHOTS[key][1][0], SHOTS[key][1][1])
    return phone_left + 12 + (x_full - bx) * scale, phone_top + 12 + (y_full - by) * scale


def tap_ripple(frame, cx, cy, t, t0, color=(255, 255, 255)):
    k = rk.span(t, t0, 0.55)
    if 0 < k < 1:
        a = (1 - k) * 0.6
        r = 22 + 38 * rk.ease_out(k)
        ring = Image.new("RGBA", (int(r * 2 + 14), int(r * 2 + 14)), (0, 0, 0, 0))
        ImageDraw.Draw(ring).ellipse((7, 7, 7 + r * 2, 7 + r * 2), outline=tuple(color) + (int(a * 255),), width=4)
        rk.blend(frame, ring, cx - ring.width / 2, cy - ring.height / 2)
        dot = Image.new("RGBA", (40, 40), (0, 0, 0, 0))
        ImageDraw.Draw(dot).ellipse((8, 8, 32, 32), fill=(255, 255, 255, int(200 * (1 - k))))
        rk.blend(frame, dot, cx - 20, cy - 20)


def scene_ui(t: float) -> np.ndarray:
    frame = bg_ui()
    rk.add_glow(frame, 540, 1180, 1200, (34, 96, 230), 2.0, 0.42)

    k, dy = enter(t, 0.02, 0.5, 30)
    txt(frame, "انتخاب ساعت، در چند ثانیه", 62, "Black", WHITE, cy=282 + dy, opacity=k, max_w=960)
    ks, dys = enter(t, 0.16, 0.5, 22)
    txt(frame, "مشتری خودش نوبت می‌گیره", 36, "Bold", SUB, cy=356 + dys, opacity=ks, shadow=False)

    kp = rk.spring(rk.span(t, 0.0, 0.75), 7.0, 5.5)
    bob = math.sin(t * 1.2) * 5
    phone_left = 540 - UI_PHONE_W / 2
    phone_top = UI_CENTER_Y - UI_PHONE_H / 2 + (1 - kp) * 110 + bob

    a, b, c = ui_screen("date"), ui_screen("selected"), ui_screen("form")
    if t < 2.30:
        screen = a
    elif t < 2.62:
        screen = Image.blend(a, b, rk.ease(rk.span(t, 2.30, 0.30)))
    elif t < 4.10:
        screen = b
    elif t < 4.42:
        screen = Image.blend(b, c, rk.ease(rk.span(t, 4.10, 0.30)))
    else:
        screen = c
    rk.blend_scaled(frame, screen, 540, phone_top + UI_PHONE_H / 2, 0.965 + 0.035 * kp, 1.0)

    if t >= 1.45:
        x, y = to_screen_pt("date", 866, 534, phone_left, phone_top)
        tap_ripple(frame, x, y, t, 1.52)
    if t >= 2.80:
        x, y = to_screen_pt("selected", 561, 841, phone_left, phone_top)
        tap_ripple(frame, x, y, t, 2.88)

    rk.add_grain(frame, t, 2.0)
    return frame


# ------------------------------------------------------------------ scene 4: confirmed

S4 = 4.55


def scene_result(t: float) -> np.ndarray:
    frame = bg_result()
    rk.add_glow(frame, 540, 760, 1000, (60, 104, 215), 2.0, 0.35)

    k, dy = enter(t, 0.0, 0.5, 30)
    txt(frame, "رزرو ثبت شد", 88, "Black", WHITE, cy=296 + dy, opacity=k, max_w=900)
    ks, dys = enter(t, 0.18, 0.5, 24)
    txt(frame, "بدون پیام‌های بی‌پایان", 40, "Bold", CYAN, cy=382 + dys, opacity=ks, max_w=900)

    kc = rk.spring(rk.span(t, 0.08, 0.85), 6.8, 5.6)
    zoom = 1.02 + 0.055 * rk.ease(min(1.0, t / S4))
    card = rk.image_card(OWNER, 828, 880, 52, focus=(0.5, 0.30), zoom=zoom,
                         border=(130, 190, 255, 80), border_w=2,
                         shadow=(0, 0, 0, 170), shadow_blur=48, shadow_dy=30)
    rk.blend_scaled(frame, card, 540, 940 + (1 - kc) * 70, 0.97 + 0.03 * kc, 1.0)

    kt = rk.spring(rk.span(t, 1.15, 0.7), 8.0, 6.0)
    tw, th = 800, 168
    toast = rk.card_img(tw, th, 32, (255, 255, 255, 248), (205, 230, 255, 210), 2, (0, 14, 34, 120), 32, 18)
    ox, oy = (toast.width - tw) // 2, (toast.height - th) // 2
    disc = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    ImageDraw.Draw(disc).ellipse((0, 0, 95, 95), fill=(70, 194, 118, 255))
    disc.alpha_composite(rk.icon("check", 56, (255, 255, 255)), (20, 20))
    toast.alpha_composite(disc, (ox + 34, oy + (th - 96) // 2))
    t1 = rk.text_img("رزرو تأیید شد", "Bold", 38, (20, 30, 52), pad=8)
    t2i = rk.text_img("زهرا و. · شنبه ۱۸ مهر · ۱۶:۳۰", "Medium", 26, (110, 126, 155), pad=8)
    block_w = max(t1.width, t2i.width) - 16
    right = ox + tw - 40
    toast.alpha_composite(t1, (int(right - block_w), oy + 22))
    toast.alpha_composite(t2i, (int(right - block_w), oy + 84))
    rk.blend_scaled(frame, toast, 540, 1522, 0.9 + 0.1 * kt, kt)

    rng = np.random.default_rng(9)
    for i in range(16):
        x = rng.uniform(60, 1020)
        y = rng.uniform(520, 1560) + math.sin(t * 0.5 + i) * 14
        size = rng.uniform(2, 5)
        a = 0.10 + 0.10 * rk.pulse(t + i, 3.1, 0, 1)
        sp = rk.glow_sprite(int(size * 8), (255, 214, 150), 1.4, 255)
        rk.blend_add(frame, sp, x - sp.width / 2, y - sp.height / 2, a)

    rk.add_grain(frame, t, 2.0)
    return frame


# ------------------------------------------------------------------ scene 5: panel mock

S5 = 6.35
PANEL_W, PANEL_H = 940, 1010
SB = 206  # sidebar width
CX0, CX1 = 26, PANEL_W - SB - 26  # content bounds


@functools.lru_cache(maxsize=1)
def panel_base() -> Image.Image:
    w, h = PANEL_W, PANEL_H
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=34, fill=(247, 250, 255, 255))

    # header
    d.rounded_rectangle((0, 0, w - 1, 104), radius=34, fill=(255, 255, 255, 255))
    d.rectangle((0, 70, w - 1, 104), fill=(255, 255, 255, 255))
    d.line((0, 104, w, 104), fill=(228, 236, 248), width=2)
    lm = LOGO.resize((48, 48), Image.LANCZOS).convert("RGBA")
    img.alpha_composite(lm, (w - 76, 28))
    shaped(d, (w - 92, 42), "بوکورا", "ExtraBold", 28, (26, 31, 54), anchor="rm")
    shaped(d, (w - 92, 74), "پنل مدیریت", "Medium", 17, (130, 144, 170), anchor="rm")
    d.rounded_rectangle((32, 38, 116, 68), radius=15, fill=(224, 246, 232))
    shaped(d, (74, 54), "فعال", "Bold", 18, (34, 140, 86), anchor="mm")

    # sidebar
    sx = w - SB
    d.rectangle((sx, 106, w - 2, h - 2), fill=(255, 255, 255, 255))
    d.line((sx, 106, sx, h), fill=(230, 238, 250), width=2)
    nav = [("grid", "داشبورد", True), ("calendar", "رزروها", False), ("scissors", "خدمات", False),
           ("clock", "ساعت کاری", False), ("user", "مشتریان", False), ("bell", "پیام‌ها", False)]
    for i, (ic, label, active) in enumerate(nav):
        y = 152 + i * 60
        if active:
            d.rounded_rectangle((sx + 18, y - 22, w - 20, y + 22), radius=14, fill=(79, 95, 232, 255))
        col = (255, 255, 255) if active else (112, 128, 156)
        img.alpha_composite(rk.icon(ic, 24, col), (w - 50, y - 12))
        shaped(d, (w - 64, y), label, "Bold" if active else "Medium", 21, col, anchor="rm")

    # greeting
    shaped(d, (CX1, 136), "سلام، مریم", "ExtraBold", 30, (26, 31, 54), anchor="rm")
    shaped(d, (CX1, 170), "شنبه ۱۸ مهر · ۳ رزرو تازه", "Medium", 19, (132, 146, 172), anchor="rm")

    # stat cards
    stats = [("۸", "رزرو امروز", "calendar", (79, 95, 232)), ("۶", "خدمات فعال", "scissors", (52, 168, 120)), ("۱۰–۱۹", "ساعت کاری", "clock", (214, 152, 70))]
    gap = 14
    cw_ = (CX1 - CX0 - gap * 2) / 3
    for i, (val, label, ic, col) in enumerate(stats):
        x1 = CX1 - i * (cw_ + gap)
        x0 = x1 - cw_
        d.rounded_rectangle((x0, 192, x1, 306), radius=18, fill=(255, 255, 255, 255), outline=(230, 238, 250), width=2)
        d.rounded_rectangle((x1 - 46, 204, x1 - 16, 216), radius=6, fill=col + (70,))
        shaped(d, (x1 - 16, 232), label, "Medium", 16, (138, 152, 178), anchor="rm")
        shaped(d, (x1 - 16, 274), val, "ExtraBold", 38 if len(val) <= 2 else 26, (26, 31, 54), anchor="rm")

    # bookings header
    shaped(d, (CX1, 350), "رزروهای امروز", "ExtraBold", 23, (26, 31, 54), anchor="rm")
    d.rounded_rectangle((CX0, 356, CX0 + 92, 384), radius=10, fill=(226, 238, 255))
    shaped(d, (CX0 + 46, 370), "همه", "Bold", 17, (79, 95, 232), anchor="mm")

    # bookings rows 1-2 (row 3 animates in scene_panel)
    for i, (tm, name, svc, status, bgc, fgc) in enumerate([
        ("۱۶:۳۰", "زهرا و.", "رنگ مو", "تأیید شد", (224, 246, 232), (34, 140, 86)),
        ("۱۷:۳۰", "سارا ک.", "کوتاهی مو", "در انتظار", (255, 244, 222), (170, 118, 26)),
    ]):
        y = 400 + i * 68
        d.rounded_rectangle((CX0, y, CX1, y + 58), radius=14, fill=(255, 255, 255, 255), outline=(232, 240, 250), width=2)
        d.rounded_rectangle((CX0 + 12, y + 11, CX0 + 96, y + 47), radius=10, fill=(238, 243, 252))
        shaped(d, (CX0 + 54, y + 29), tm, "Bold", 19, (60, 76, 108), anchor="mm")
        d.rounded_rectangle((CX1 - 86, y + 11, CX1 - 14, y + 47), radius=10, fill=bgc)
        shaped(d, (CX1 - 50, y + 29), status, "Bold", 16, fgc, anchor="mm")
        shaped(d, (CX1 - 100, y + 29), f"{name} · {svc}", "Medium", 19, (56, 70, 98), anchor="rm")

    # chart card
    d.rounded_rectangle((CX0, 612, CX1, 862), radius=18, fill=(255, 255, 255, 255), outline=(230, 238, 250), width=2)
    shaped(d, (CX1 - 18, 640), "رزروهای این هفته", "ExtraBold", 21, (26, 31, 54), anchor="rm")
    shaped(d, (CX1 - 18, 670), "۳۴ رزرو ثبت‌شده", "Medium", 17, (140, 152, 176), anchor="rm")

    # footer strip
    d.rounded_rectangle((CX0, 886, CX1, 962), radius=18, fill=(238, 244, 254))
    shaped(d, (CX1 - 22, 924), "لینک رزرو شما فعال است", "Bold", 19, (60, 80, 118), anchor="rm")
    d.rounded_rectangle((CX0 + 16, 906, CX0 + 174, 942), radius=18, fill=(79, 95, 232))
    shaped(d, (CX0 + 95, 924), "کپی لینک", "Bold", 17, (255, 255, 255), anchor="mm")
    img.putalpha(rk.round_mask(w, h, 34))
    return img


def scene_panel(t: float) -> np.ndarray:
    frame = bg_panel()
    rk.add_glow(frame, 540, 1140, 1200, (30, 88, 225), 2.0, 0.42)

    k, dy = enter(t, 0.0, 0.5, 30)
    txt(frame, "همه‌چیز، در یک پنل", 76, "Black", WHITE, cy=286 + dy, opacity=k, max_w=980)
    ks, dys = enter(t, 0.14, 0.5, 22)
    txt(frame, "خدمات · ساعت کاری · رزروها", 38, "Bold", CYAN, cy=372 + dys, opacity=ks, max_w=960, shadow=False)

    kp = rk.spring(rk.span(t, 0.05, 0.9), 6.6, 5.4)
    panel = panel_base().copy()
    d = ImageDraw.Draw(panel)

    # animated bars
    days = ["ش", "ی", "د", "س", "چ", "پ", "ج"]
    vals = [0.45, 0.62, 0.38, 0.78, 0.55, 0.92, 0.5]
    x_start, x_end = CX0 + 10, CX1 - 10
    slot = (x_end - x_start) / 7
    for i, v in enumerate(vals):
        kg = rk.ease(rk.span(t, 0.55 + i * 0.06, 0.6))
        bh = 128 * v * kg
        bx = x_end - slot * (i + 1) + slot * 0.24
        bw = slot * 0.52
        col = (79, 95, 232) if i != 1 else (53, 200, 225)
        if bh > 1:
            d.rounded_rectangle((bx, 824 - bh, bx + bw, 824), radius=7, fill=col + (255,))
        shaped(d, (bx + bw / 2, 848), days[i], "Medium", 16, (150, 162, 186), anchor="mm")

    # new booking row (third) pops in
    kn = rk.spring(rk.span(t, 2.50, 0.6), 8.0, 6.0)
    y = 536
    if kn < 0.98:
        d.rounded_rectangle((CX0, y, CX1, y + 58), radius=14, fill=(255, 255, 255, 255), outline=(232, 240, 250), width=2)
        d.rounded_rectangle((CX0 + 12, y + 11, CX0 + 96, y + 47), radius=10, fill=(238, 243, 252))
        shaped(d, (CX0 + 54, y + 29), "۱۸:۰۰", "Bold", 19, (60, 76, 108), anchor="mm")
        d.rounded_rectangle((CX1 - 86, y + 11, CX1 - 14, y + 47), radius=10, fill=(224, 246, 232))
        shaped(d, (CX1 - 50, y + 29), "تأیید شد", "Bold", 16, (34, 140, 86), anchor="mm")
        shaped(d, (CX1 - 100, y + 29), "نگین ر. · اصلاح مو", "Medium", 19, (56, 70, 98), anchor="rm")
    if kn > 0.15:
        row = Image.new("RGBA", (CX1 - CX0 + 8, 66), (0, 0, 0, 0))
        rd = ImageDraw.Draw(row)
        rd.rounded_rectangle((4, 4, CX1 - CX0 + 2, 61), radius=15, fill=(235, 255, 243, 255), outline=(96, 202, 142, 255), width=2)
        rd.rounded_rectangle((CX1 - CX0 - 78, 16, CX1 - CX0 - 6, 52), radius=10, fill=(70, 190, 118, 255))
        shaped(rd, (CX1 - CX0 - 42, 34), "تازه", "Bold", 16, (255, 255, 255), anchor="mm")
        shaped(rd, (CX1 - CX0 - 92, 34), "۱۹:۰۰ مینا ب. · اصلاح مو", "Medium", 18, (38, 112, 76), anchor="rm")
        alpha = min(1.0, kn)
        row = Image.eval(row, lambda v: v)
        row.putalpha(row.getchannel("A").point(lambda v: int(v * alpha)))
        panel.alpha_composite(row, (CX0 - 4, int(y - 4 + (1 - kn) * 18)))

    shadow = rk.shadow_rect(PANEL_W, PANEL_H, 34, 46, 26, 175)
    rk.blend(frame, shadow, 540 - shadow.width / 2, 610 + (1 - kp) * 90 + 8, kp * 0.9)
    rk.blend_scaled(frame, panel, 540, 610 + PANEL_H / 2 + (1 - kp) * 90, 0.965 + 0.035 * kp, 1.0)

    # soft pulse around the freshly added row
    kh = rk.span(t, 2.55, 0.55)
    if kh > 0.05:
        pulse = (1 - kh) * (0.55 + 0.45 * rk.pulse(t, 0.9, 0, 1))
        ring = Image.new("RGBA", (PANEL_W, PANEL_H), (0, 0, 0, 0))
        ImageDraw.Draw(ring).rounded_rectangle((CX0 - 8, 526, CX1 + 8, 604), radius=18,
                                               outline=(70, 196, 130, int(255 * pulse)), width=3)
        rk.blend(frame, ring, 540 - PANEL_W / 2, 610 + (1 - kp) * 90, pulse)

    rk.add_grain(frame, t, 2.0)
    return frame


# ------------------------------------------------------------------ scene 6: end card

S6 = 6.25


def scene_end(t: float) -> np.ndarray:
    frame = bg_end()
    glow_a = 0.47 + 0.15 * rk.pulse(t, 2.8, 0, 1)
    rk.add_glow(frame, 540, 700, 1250, (36, 100, 245), 2.1, glow_a)
    sparkles(frame, t, 540, 720, 340, 16, 0.3)

    kl = rk.spring(rk.span(t, 0.08, 0.95), 6.2, 5.0)
    logo(frame, 540, 700 + (1 - kl) * 40, 440 * (0.84 + 0.16 * kl), min(1.0, kl * 1.3))

    k1, d1 = enter(t, 0.40, 0.55, 26)
    txt(frame, "رزرو آنلاین", 82, "Black", WHITE, cy=1010 + d1, opacity=k1, max_w=900)
    k2, d2 = enter(t, 0.55, 0.55, 26)
    txt(frame, "ساده و هوشمند", 82, "Black", CYAN, cy=1100 + d2, opacity=k2, max_w=900)

    k3, d3 = enter(t, 0.95, 0.55, 26)
    pill = rk.chip_img(rk.BOT_HANDLE, "Bold", 40, (255, 255, 255), (16, 32, 68, 238), (90, 190, 255, 150),
                       44, 18, rk.icon("send", 36, (86, 204, 242)), 14, shadow=(0, 10, 30, 150), rtl=False, icon_side="left")
    rk.blend(frame, pill, 540 - pill.width / 2, 1182 + d3, k3)

    k4, d4 = enter(t, 1.1, 0.5, 22)
    txt(frame, "در تلگرام شروع کن", 34, "Bold", SUB, cy=1436 + d4, opacity=k4, shadow=False)

    items = [("clock", "رزرو ۲۴ ساعته"), ("grid", "مدیریت آسان"), ("zap", "تجربه بهتر")]
    widths = []
    chips = []
    for ic, label in items:
        card = rk.chip_img(label, "Bold", 24, (232, 241, 252), (13, 30, 64, 210), (110, 180, 245, 110),
                           24, 12, rk.icon(ic, 26, (120, 200, 255)), 8, shadow=(0, 6, 18, 90))
        chips.append(card)
        widths.append(card.width)
    total = sum(widths) + 12 * (len(chips) - 1)
    x = 540 - total / 2
    for i, card in enumerate(chips):
        kb, dyb = enter(t, 1.3 + i * 0.12, 0.5, 26)
        rk.blend(frame, card, x, 1512 + dyb, kb)
        x += widths[i] + 12

    rk.add_grain(frame, t, 2.0)
    return frame


# ------------------------------------------------------------------ timeline

SCENES = [
    ("hook", 0.00, S1, scene_hook),
    ("intro", 3.20, S2, scene_intro),
    ("ui", 7.05, S3, scene_ui),
    ("result", 12.85, S4, scene_result),
    ("panel", 17.40, S5, scene_panel),
    ("end", 23.75, S6, scene_end),
]
TOTAL = 30.0
XFADE = 0.30

# ------------------------------------------------------------------ 15 s story edit
# Same scenes, re-cut for stories: four beats, each carrying one complete VO line.
STORY_SEGMENTS = [
    (0.00, 3.20),   # hook
    (7.35, 12.55),  # date -> free time -> tap 16:30
    (12.95, 14.65), # booking confirmed
    (23.90, 28.80), # end card
]
STORY_TOTAL = sum(b - a for a, b in STORY_SEGMENTS)  # 15.0 s

# story-local VO cues (own script, so nothing is chopped mid-sentence)
STORY_VO_CUES = {
    "01-hook": 0.45,
    "story-ui": 4.55,
    "story-result": 8.50,
    "06-end": 10.35,
}


VO_CUES = {
    "01-hook": 0.62,
    "02-intro": 3.44,
    "03-ui": 7.30,
    "04-confirmed": 13.02,
    "05-manage": 17.60,
    "06-end": 24.02,
}


def render_frame(t: float) -> np.ndarray:
    """Paint the timeline at absolute time t with symmetric crossfades.

    Blending around a boundary (rather than only before it) keeps the outgoing
    scene on screen while the incoming one animates in, so no scene ever shows
    as an empty frame at its first instant.
    """
    t = min(max(t, 0.0), TOTAL - 1e-6)
    active = 0
    for i, (name, start, dur, fn) in enumerate(SCENES):
        if start <= t:
            active = i
    name, start, dur, fn = SCENES[active]
    frame = fn(t - start)

    # fade in from the previous scene during the first half of the boundary
    if active > 0 and t - start < XFADE / 2:
        pname, pstart, pdur, pfn = SCENES[active - 1]
        k = rk.ease(rk.span(t, start - XFADE / 2, XFADE))  # 0.5 at the cut, 1 after
        frame = pfn(t - pstart) * (1 - k) + frame * k
    # fade out into the next scene during the second half
    if active < len(SCENES) - 1:
        nstart = SCENES[active + 1][1]
        if t > nstart - XFADE / 2:
            nname, nstart_, ndur, nfn = SCENES[active + 1]
            k = rk.ease(rk.span(t, nstart - XFADE / 2, XFADE))
            frame = frame * (1 - k) + nfn(max(0.0, t - nstart_)) * k
    return frame
