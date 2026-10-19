"""reelkit — small vector/typography toolkit for rendering the Bookora reel.

Everything is composed with Pillow (for crisp anti-aliased shapes and Persian
text shaping) and NumPy (for fast full-frame blending).  The renderer never
touches a browser, so output is fully reproducible from this repository.
"""

from __future__ import annotations

import functools
import math
import os

import arabic_reshaper
import numpy as np
from bidi.algorithm import get_display
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REEL = os.path.dirname(HERE)
ASSETS = os.path.join(REEL, "assets")
FONTS = os.path.join(ASSETS, "fonts")
OUT = os.path.join(REEL, "output")

W, H, FPS = 1080, 1920, 30

# Brand palette (sampled from the Bookora app / poster).
NAVY = (6, 12, 32)
NAVY_2 = (10, 24, 62)
NAVY_3 = (14, 34, 84)
BLUE = (47, 128, 237)
SKY = (86, 204, 242)
CYAN = (53, 224, 242)
VIOLET = (79, 95, 232)
INK = (26, 31, 54)
PAPER = (232, 241, 252)
CREAM = (243, 234, 221)
GOLD = (217, 168, 108)
WHITE = (255, 255, 255)
MUTED = (150, 170, 205)

SAFE_TOP = 268
SAFE_BOTTOM = 1636

# Telegram handle shown in the end card. The repo (messages, outreach docs,
# landing page) uses @Bookora_App_bot; change this one line to re-render.
BOT_HANDLE = "@Bookora_App_bot"

# ---------------------------------------------------------------- text helpers

_resh = arabic_reshaper.ArabicReshaper(
    configuration={"delete_harakat": False, "support_ligatures": True}
)

_FA_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")


def fa(text: str) -> str:
    """Convert ASCII digits to Persian digits."""
    return str(text).translate(_FA_DIGITS)


def shape(text: str) -> str:
    """Shape Persian/Arabic text and apply the bidi algorithm."""
    if not text:
        return text
    return get_display(_resh.reshape(text))


@functools.lru_cache(maxsize=64)
def font(weight: str = "Black", size: int = 64) -> ImageFont.FreeTypeFont:
    path = os.path.join(FONTS, f"Vazirmatn-{weight}.ttf")
    return ImageFont.truetype(path, size)


def text_size(text: str, weight="Black", size=64, rtl: bool = True) -> tuple[int, int]:
    f = font(weight, size)
    lines = text.split("\n")
    widths = [f.getlength(shape(l) if rtl else l) for l in lines]
    lh = int(size * 1.36)
    return int(max(widths)), lh * len(lines)


@functools.lru_cache(maxsize=1024)
def _text_img_cached(
    text: str,
    weight: str = "Black",
    size: int = 72,
    color: tuple = (255, 255, 255),
    align: str = "center",
    line_spacing: float = 1.36,
    shadow: tuple | None = None,
    shadow_blur: int = 22,
    shadow_dy: int = 8,
    shadow_alpha: int = 150,
    stroke: int = 0,
    stroke_fill: tuple = (0, 0, 0),
    pad: int = 48,
    max_width: int | None = None,
    rtl: bool = True,
) -> Image.Image:
    """Render (possibly multi-line) text to a transparent RGBA image (RTL by default)."""
    if max_width is not None:
        guard = 0
        while guard < 60:
            tw, _ = text_size(text, weight, size, rtl)
            if tw <= max_width or size <= 18:
                break
            size = int(size * 0.94)
            guard += 1

    f = font(weight, size)
    lines = [shape(l) if rtl else l for l in text.split("\n")]
    widths = [f.getlength(l) for l in lines]
    lh = int(size * line_spacing)
    wmax = max(widths)
    width = int(wmax) + pad * 2
    height = lh * len(lines) + pad * 2

    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i, line in enumerate(lines):
        lw = widths[i]
        if align == "center":
            x = pad + (wmax - lw) / 2
        elif align == "right":
            x = pad + (wmax - lw)
        else:
            x = pad
        y = pad + i * lh + lh / 2
        d.text(
            (x, y),
            line,
            font=f,
            fill=color,
            anchor="lm",
            stroke_width=stroke,
            stroke_fill=stroke_fill,
        )

    if shadow is not None:
        sh = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        ds = ImageDraw.Draw(sh)
        for i, line in enumerate(lines):
            lw = widths[i]
            if align == "center":
                x = pad + (wmax - lw) / 2
            elif align == "right":
                x = pad + (wmax - lw)
            else:
                x = pad
            y = pad + i * lh + lh / 2
            ds.text((x, y + shadow_dy), line, font=f, fill=tuple(shadow) + (shadow_alpha,), anchor="lm")
        sh = sh.filter(ImageFilter.GaussianBlur(shadow_blur))
        layer = Image.alpha_composite(sh, layer)
    return layer


def text_img(*args, **kwargs) -> Image.Image:
    """Public wrapper: cached images are shared, so hand out a private copy."""
    return _text_img_cached(*args, **kwargs).copy()


def fit_text_size(text: str, weight: str, max_width: int, start: int) -> int:
    size = start
    while size > 20 and text_size(text, weight, size)[0] > max_width:
        size -= 2
    return size


# ---------------------------------------------------------------- easing


def clamp01(x: float) -> float:
    return 0.0 if x < 0 else 1.0 if x > 1 else x


def ease(t: float) -> float:
    t = clamp01(t)
    return 0.5 - 0.5 * math.cos(math.pi * t)


def ease_out(t: float) -> float:
    t = clamp01(t)
    return 1 - (1 - t) ** 3


def ease_in(t: float) -> float:
    t = clamp01(t)
    return t ** 3


def ease_out_back(t: float, s: float = 1.70158) -> float:
    t = clamp01(t)
    return 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2


def spring(t: float, freq: float = 9.0, damp: float = 6.0) -> float:
    t = clamp01(t)
    if t >= 1:
        return 1.0
    return 1 - math.exp(-damp * t) * math.cos(freq * t)


def span(t: float, start: float, dur: float) -> float:
    return clamp01((t - start) / dur)


def pulse(t: float, period: float = 1.6, lo: float = 0.0, hi: float = 1.0) -> float:
    return lo + (hi - lo) * (0.5 + 0.5 * math.sin(2 * math.pi * t / period))


# ---------------------------------------------------------------- shapes


def _rgba(color: tuple, alpha: int = 255) -> tuple:
    if len(color) == 4:
        return color
    return (color[0], color[1], color[2], alpha)


@functools.lru_cache(maxsize=512)
def _card_img_cached(
    width: int,
    height: int,
    radius: int = 40,
    fill: tuple = (255, 255, 255, 255),
    border: tuple | None = None,
    border_w: int = 0,
    shadow: tuple | None = (0, 0, 0, 120),
    shadow_blur: int = 40,
    shadow_dy: int = 26,
    pad: int = 0,
    gradient_bottom: tuple | None = None,
) -> Image.Image:
    """Rounded rectangle, optional vertical gradient fill and soft shadow."""
    if shadow is not None:
        pad = max(pad, shadow_blur * 2)
    w = width + pad * 2
    h = height + pad * 2
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    shape_mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(shape_mask).rounded_rectangle(
        (pad, pad, pad + width - 1, pad + height - 1), radius=radius, fill=255
    )
    if shadow is not None:
        sh = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        sh.paste(_rgba(shadow), (0, 0), shape_mask)
        sh = sh.filter(ImageFilter.GaussianBlur(shadow_blur))
        sh = sh.transform(sh.size, Image.AFFINE, (1, 0, 0, 0, 1, -shadow_dy))
        layer = Image.alpha_composite(layer, sh)

    body = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    if gradient_bottom is None:
        body.paste(_rgba(fill), (0, 0), shape_mask)
    else:
        grad = Image.new("RGBA", (w, h), _rgba(fill))
        top = _rgba(fill)
        bot = _rgba(gradient_bottom)
        pix = np.zeros((h, w, 4), dtype=np.uint8)
        ys = np.linspace(0, 1, h)[:, None, None]
        for c in range(4):
            pix[:, :, c] = (top[c] * (1 - ys) + bot[c] * ys).astype(np.uint8)
        grad = Image.fromarray(pix, "RGBA")
        body.paste(grad, (0, 0), shape_mask)

    if border is not None and border_w > 0:
        ImageDraw.Draw(body).rounded_rectangle(
            (pad, pad, pad + width - 1, pad + height - 1),
            radius=radius,
            outline=_rgba(border),
            width=border_w,
        )
    layer = Image.alpha_composite(layer, body)
    return layer


def card_img(*args, **kwargs) -> Image.Image:
    """Cached rounded-rect builder; returns a private copy (callers composite into it)."""
    return _card_img_cached(*args, **kwargs).copy()


def chip_img(
    text: str,
    weight: str = "Bold",
    size: int = 34,
    fg: tuple = (255, 255, 255),
    fill: tuple = (255, 255, 255, 255),
    border: tuple | None = None,
    pad_x: int = 34,
    pad_y: int = 16,
    icon_img: Image.Image | None = None,
    gap: int = 12,
    shadow: tuple | None = (0, 8, 24, 90),
    rtl: bool = True,
    icon_side: str = "right",
) -> Image.Image:
    """Pill with optional icon; text is laid out RTL (icon on the right by default)."""
    label = text_img(text, weight, size, fg, pad=6, rtl=rtl)
    tw, th = label.width - 12, label.height - 12
    iw = icon_img.width if icon_img is not None else 0
    ih = icon_img.height if icon_img is not None else 0
    inner_w = tw + (iw + gap if icon_img is not None else 0)
    w = inner_w + pad_x * 2
    h = max(th, ih) + pad_y * 2
    radius = h // 2
    out = card_img(w, h, radius, fill, border, 2 if border else 0, shadow, 26, 12)
    ox, oy = (out.width - w) // 2, (out.height - h) // 2
    # inner content origin
    if icon_img is not None and icon_side == "right":
        out.alpha_composite(icon_img, (ox + pad_x + tw + gap, oy + (h - ih) // 2))
        out.alpha_composite(label, (ox + pad_x - 6, oy + (h - th) // 2 - 6))
    elif icon_img is not None:
        out.alpha_composite(icon_img, (ox + pad_x, oy + (h - ih) // 2))
        out.alpha_composite(label, (ox + pad_x + iw + gap - 6, oy + (h - th) // 2 - 6))
    else:
        out.alpha_composite(label, (ox + pad_x - 6, oy + (h - th) // 2 - 6))
    return out


def pill_img(text, weight="Bold", size=40, color=(255, 255, 255), fill=(255, 255, 255, 255), border=None, pad_x=40, pad_y=18, icon=None, icon_gap=16, shadow=(0, 0, 0, 90)):
    return chip_img(text, weight, size, color, fill, border, pad_x, pad_y, icon, icon_gap, shadow)


def glow_sprite(size: int, color: tuple, power: float = 2.0, alpha: int = 255) -> Image.Image:
    """Radial falloff sprite (cached)."""
    return _glow_sprite(int(size), tuple(color), float(power), int(alpha))


@functools.lru_cache(maxsize=128)
def _glow_sprite(size: int, color: tuple, power: float, alpha: int) -> Image.Image:
    n = np.linspace(-1, 1, size)
    xx, yy = np.meshgrid(n, n)
    r = np.clip(1 - np.sqrt(xx**2 + yy**2), 0, 1) ** power
    a = (r * alpha).astype(np.uint8)
    img = np.zeros((size, size, 4), dtype=np.uint8)
    img[:, :, 0], img[:, :, 1], img[:, :, 2] = color
    img[:, :, 3] = a
    return Image.fromarray(img, "RGBA")


def arc_sprite(size: int, color: tuple, width: int = 2, alpha: int = 90, spread: int = 10) -> Image.Image:
    """Thin blurred ring for the background 'aurora' lines."""

    @functools.lru_cache(maxsize=32)
    def _make(size, color, width, alpha, spread):
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.ellipse((spread, spread, size - spread, size - spread), outline=_rgba(color, alpha), width=width)
        return img.filter(ImageFilter.GaussianBlur(width * 1.2))

    return _make(size, tuple(color), width, alpha, spread)


# ---------------------------------------------------------------- icons


def icon(name: str, size: int = 56, color: tuple = (255, 255, 255), width: int | None = None) -> Image.Image:
    return _icon(name, size, tuple(color), width).copy()


@functools.lru_cache(maxsize=256)
def _icon(name: str, size: int, color: tuple, width: int | None) -> Image.Image:
    S = size * 4  # supersample for crisp strokes
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    lw = int(S * 0.075) if width is None else width * 4
    col = _rgba(color)
    c = S / 2
    if name == "check":
        d.line([(S * 0.22, S * 0.53), (S * 0.42, S * 0.72), (S * 0.79, S * 0.30)], fill=col, width=lw, joint="curve")
    elif name == "send":
        d.polygon([(S * 0.16, S * 0.46), (S * 0.86, S * 0.16), (S * 0.62, S * 0.86), (S * 0.47, S * 0.58)], fill=col)
        d.polygon([(S * 0.47, S * 0.58), (S * 0.86, S * 0.16), (S * 0.50, S * 0.66)], fill=col)
    elif name == "calendar":
        d.rounded_rectangle((S * 0.17, S * 0.24, S * 0.83, S * 0.82), radius=S * 0.10, outline=col, width=lw)
        d.line([(S * 0.17, S * 0.40), (S * 0.83, S * 0.40)], fill=col, width=lw)
        d.line([(S * 0.33, S * 0.14), (S * 0.33, S * 0.30)], fill=col, width=lw)
        d.line([(S * 0.67, S * 0.14), (S * 0.67, S * 0.30)], fill=col, width=lw)
        d.rounded_rectangle((S * 0.36, S * 0.52, S * 0.64, S * 0.68), radius=S * 0.04, fill=col)
    elif name == "clock":
        d.ellipse((S * 0.15, S * 0.15, S * 0.85, S * 0.85), outline=col, width=lw)
        d.line([(c, c), (c, S * 0.32)], fill=col, width=lw)
        d.line([(c, c), (S * 0.68, S * 0.57)], fill=col, width=lw)
    elif name == "zap":
        d.polygon(
            [(S * 0.56, S * 0.10), (S * 0.24, S * 0.55), (S * 0.47, S * 0.55), (S * 0.42, S * 0.90), (S * 0.77, S * 0.43), (S * 0.53, S * 0.43)],
            fill=col,
        )
    elif name == "shield":
        d.line([(c, S * 0.12), (S * 0.82, S * 0.30), (S * 0.78, S * 0.66), (c, S * 0.89), (S * 0.22, S * 0.66), (S * 0.18, S * 0.30), (c, S * 0.12)], fill=col, width=lw, joint="curve")
        d.line([(S * 0.36, S * 0.50), (S * 0.47, S * 0.61), (S * 0.65, S * 0.38)], fill=col, width=lw, joint="curve")
    elif name == "user":
        d.ellipse((S * 0.34, S * 0.16, S * 0.66, S * 0.48), outline=col, width=lw)
        d.arc((S * 0.20, S * 0.50, S * 0.80, S * 1.02), start=200, end=340, fill=col, width=lw)
    elif name == "bell":
        d.arc((S * 0.22, S * 0.18, S * 0.78, S * 0.74), start=180, end=360, fill=col, width=lw)
        d.line([(S * 0.22, S * 0.46), (S * 0.22, S * 0.70)], fill=col, width=lw)
        d.line([(S * 0.78, S * 0.46), (S * 0.78, S * 0.70)], fill=col, width=lw)
        d.line([(S * 0.14, S * 0.70), (S * 0.86, S * 0.70)], fill=col, width=lw)
        d.arc((S * 0.40, S * 0.70, S * 0.60, S * 0.88), start=0, end=180, fill=col, width=lw)
    elif name == "chevron":
        d.line([(S * 0.62, S * 0.22), (S * 0.36, S * 0.50), (S * 0.62, S * 0.78)], fill=col, width=lw, joint="curve")
    elif name == "spark":
        d.line([(c, S * 0.12), (c, S * 0.88)], fill=col, width=lw)
        d.line([(S * 0.12, c), (S * 0.88, c)], fill=col, width=lw)
        d.line([(S * 0.25, S * 0.25), (S * 0.75, S * 0.75)], fill=col, width=max(2, lw // 2))
        d.line([(S * 0.75, S * 0.25), (S * 0.25, S * 0.75)], fill=col, width=max(2, lw // 2))
    elif name == "menu":
        for k in (0.30, 0.50, 0.70):
            d.line([(S * 0.18, S * k), (S * 0.82, S * k)], fill=col, width=lw)
    elif name == "grid":
        d.rounded_rectangle((S * 0.16, S * 0.16, S * 0.46, S * 0.46), radius=S * 0.06, outline=col, width=lw)
        d.rounded_rectangle((S * 0.54, S * 0.16, S * 0.84, S * 0.46), radius=S * 0.06, outline=col, width=lw)
        d.rounded_rectangle((S * 0.16, S * 0.54, S * 0.46, S * 0.84), radius=S * 0.06, outline=col, width=lw)
        d.rounded_rectangle((S * 0.54, S * 0.54, S * 0.84, S * 0.84), radius=S * 0.06, outline=col, width=lw)
    elif name == "scissors":
        d.line([(S * 0.24, S * 0.18), (S * 0.72, S * 0.72)], fill=col, width=lw)
        d.line([(S * 0.76, S * 0.18), (S * 0.28, S * 0.72)], fill=col, width=lw)
        d.ellipse((S * 0.14, S * 0.70, S * 0.34, S * 0.90), outline=col, width=lw)
        d.ellipse((S * 0.66, S * 0.70, S * 0.86, S * 0.90), outline=col, width=lw)
    elif name == "plus":
        d.line([(c, S * 0.22), (c, S * 0.78)], fill=col, width=lw)
        d.line([(S * 0.22, c), (S * 0.78, c)], fill=col, width=lw)
    else:
        raise ValueError(f"unknown icon {name}")
    return img.resize((size, size), Image.LANCZOS)


# ---------------------------------------------------------------- images


def cover(img: Image.Image, w: int, h: int, focus=(0.5, 0.5), zoom: float = 1.0) -> Image.Image:
    iw, ih = img.size
    scale = max(w / iw, h / ih) * zoom
    nw, nh = max(w, int(iw * scale + 0.5)), max(h, int(ih * scale + 0.5))
    im = img.resize((nw, nh), Image.LANCZOS)
    cx, cy = focus
    left = int((nw - w) * clamp01(cx))
    top = int((nh - h) * clamp01(cy))
    return im.crop((left, top, left + w, top + h))


def grade(
    img: Image.Image,
    brightness: float = 1.0,
    contrast: float = 1.0,
    saturation: float = 1.0,
    warmth: float = 0.0,
    cool: float = 0.0,
) -> Image.Image:
    out = img.convert("RGB")
    if brightness != 1.0:
        out = ImageEnhance.Brightness(out).enhance(brightness)
    if contrast != 1.0:
        out = ImageEnhance.Contrast(out).enhance(contrast)
    if saturation != 1.0:
        out = ImageEnhance.Color(out).enhance(saturation)
    if warmth or cool:
        a = np.asarray(out).astype(np.float32)
        if warmth:
            a[:, :, 0] *= 1 + 0.10 * warmth
            a[:, :, 1] *= 1 + 0.03 * warmth
            a[:, :, 2] *= 1 - 0.08 * warmth
        if cool:
            a[:, :, 2] *= 1 + 0.12 * cool
            a[:, :, 0] *= 1 - 0.06 * cool
        out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGB")
    return out


def round_mask(w: int, h: int, radius: int) -> Image.Image:
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=255)
    return mask


def image_card(
    img: Image.Image,
    w: int,
    h: int,
    radius: int = 48,
    focus=(0.5, 0.5),
    zoom: float = 1.0,
    border: tuple | None = None,
    border_w: int = 0,
    shadow=(0, 0, 0, 130),
    shadow_blur: int = 50,
    shadow_dy: int = 30,
) -> Image.Image:
    pad = shadow_blur * 2 if shadow else 0
    body = cover(img, w, h, focus, zoom).convert("RGBA")
    body.putalpha(round_mask(w, h, radius))
    layer = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    if shadow is not None:
        sh = card_img(w, h, radius, (0, 0, 0, 0), None, 0, shadow, shadow_blur, shadow_dy, 0)
        layer.alpha_composite(sh, (0, 0))
    if border and border_w:
        ImageDraw.Draw(body).rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, outline=_rgba(border), width=border_w)
    layer.alpha_composite(body, (pad, pad))
    return layer


# ---------------------------------------------------------------- compositing


def blend(dst: np.ndarray, src: Image.Image, x: int, y: int, opacity: float = 1.0) -> None:
    """Alpha-composite an RGBA PIL image onto a float32 RGB frame in place."""
    if opacity <= 0.002:
        return
    x, y = int(round(x)), int(round(y))
    sw, sh = src.size
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(dst.shape[1], x + sw), min(dst.shape[0], y + sh)
    if x1 <= x0 or y1 <= y0:
        return
    src_arr = np.asarray(src, dtype=np.float32)[y0 - y : y1 - y, x0 - x : x1 - x]
    a = src_arr[:, :, 3:4] * (opacity / 255.0)
    region = dst[y0:y1, x0:x1]
    region *= 1 - a
    region += src_arr[:, :, :3] * a


def blend_scaled(dst: np.ndarray, src: Image.Image, x: float, y: float, scale: float, opacity: float = 1.0, resample=Image.LANCZOS) -> None:
    if abs(scale - 1.0) > 1e-4:
        w = max(1, int(src.width * scale))
        h = max(1, int(src.height * scale))
        src = src.resize((w, h), resample)
    cx = x - src.width / 2
    cy = y - src.height / 2
    blend(dst, src, cx, cy, opacity)


def blend_add(dst: np.ndarray, src: Image.Image, x: float, y: float, opacity: float = 1.0, scale: float = 1.0) -> None:
    """Additive screen-style blend (for glows / emissive logo)."""
    if abs(scale - 1.0) > 1e-4:
        src = src.resize((max(1, int(src.width * scale)), max(1, int(src.height * scale))), Image.LANCZOS)
    x, y = int(round(x)), int(round(y))
    sw, sh = src.size
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(dst.shape[1], x + sw), min(dst.shape[0], y + sh)
    if x1 <= x0 or y1 <= y0:
        return
    arr = np.asarray(src, dtype=np.float32)[y0 - y : y1 - y, x0 - x : x1 - x]
    a = arr[:, :, 3:4] * (opacity / 255.0)
    region = dst[y0:y1, x0:x1]
    region += arr[:, :, :3] * a


# ---------------------------------------------------------------- background


@functools.lru_cache(maxsize=8)
def _noise_tile(seed: int = 7, size: int = 540) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return rng.normal(0, 1, (size, size)).astype(np.float32)


def base_background(
    top=(8, 16, 44),
    bottom=(3, 7, 20),
    glow_center=(0.5, 0.34),
    glow_radius=0.62,
    glow_color=(30, 90, 220),
    glow_strength=1.0,
    grid=True,
    arcs=True,
    vignette=True,
) -> np.ndarray:
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    g = (yy / (H - 1))[:, :, None]
    frame = np.array(top, dtype=np.float32) * (1 - g) + np.array(bottom, dtype=np.float32) * g

    cx, cy = glow_center[0] * W, glow_center[1] * H
    r = ((xx - cx) ** 2 + (yy - cy) ** 2) / (glow_radius * H) ** 2
    gl = np.exp(-r * 2.4)[:, :, None] * (np.array(glow_color, dtype=np.float32) * glow_strength)
    frame += gl

    if grid:
        step = 96
        lines = np.zeros((H, W), dtype=np.float32)
        lines[:, ::step] = 1
        lines[::step, :] = 1
        lines = np.asarray(
            Image.fromarray((lines * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)),
            dtype=np.float32,
        ) / 255.0
        frame += lines[:, :, None] * np.array([16, 34, 70], dtype=np.float32)

    frame = np.clip(frame, 0, 255)
    img = Image.fromarray(frame.astype(np.uint8), "RGB")

    if arcs:
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        for i, (rr, alpha) in enumerate([(720, 55), (900, 34), (1120, 22)]):
            d.ellipse((540 - rr, 1420 - rr, 540 + rr, 1420 + rr), outline=(70, 150, 255, alpha), width=2)
        layer = layer.filter(ImageFilter.GaussianBlur(1.4))
        img = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")

    if vignette:
        yy2, xx2 = np.mgrid[0:H, 0:W].astype(np.float32)
        nx = (xx2 - W / 2) / (W / 2)
        ny = (yy2 - H / 2) / (H / 2)
        v = np.clip(1 - 0.58 * (nx**2 * 0.55 + ny**2 * 0.75), 0.35, 1)[:, :, None]
        img = Image.fromarray(np.clip(np.asarray(img, dtype=np.float32) * v, 0, 255).astype(np.uint8), "RGB")

    return np.asarray(img, dtype=np.uint8)


def add_grain(frame: np.ndarray, t: float, amount: float = 2.2) -> None:
    seed = int(t * FPS) % 8
    tile = _noise_tile(seed)
    reps = (H // tile.shape[0] + 1, W // tile.shape[1] + 1)
    noise = np.tile(tile, reps)[:H, :W]
    frame += noise[:, :, None] * amount


def add_glow(frame: np.ndarray, cx: float, cy: float, size: int, color, power=2.0, opacity=1.0) -> None:
    sprite = glow_sprite(size, color, power, 255)
    blend_add(frame, sprite, cx - size / 2, cy - size / 2, opacity * 0.55)


def fade_frame(frame: np.ndarray, alpha: float) -> np.ndarray:
    return frame * alpha


def to_uint8(frame: np.ndarray) -> np.ndarray:
    return np.clip(frame, 0, 255).astype(np.uint8)


# ---------------------------------------------------------------- phone / browser chrome


def screen_shot_crop(path_or_img, box, target_w: int, target_h: int, zoom: float = 1.0, focus=(0.5, 0.0)) -> Image.Image:
    img = Image.open(path_or_img).convert("RGB") if isinstance(path_or_img, str) else path_or_img.convert("RGB")
    crop = img.crop(box)
    return cover(crop, target_w, target_h, focus, zoom)


def status_bar(width: int, bg_color: tuple, fg_color: tuple = (255, 255, 255), time_text: str = "9:41") -> Image.Image:
    h = 64
    bar = Image.new("RGBA", (width, h), tuple(bg_color) + (255,))
    d = ImageDraw.Draw(bar)
    f = font("Bold", 27)
    d.text((34, h / 2 + 2), time_text, font=f, fill=fg_color, anchor="lm")
    # signal bars, wifi, battery (right side)
    bx = width - 200
    for i, hh in enumerate((7, 10, 13, 16)):
        d.rounded_rectangle((bx + i * 9, h / 2 + 8 - hh, bx + i * 9 + 5, h / 2 + 8), radius=1, fill=fg_color)
    wx = bx + 46
    d.arc((wx, h / 2 - 9, wx + 26, h / 2 + 15), start=205, end=335, fill=fg_color, width=4)
    d.ellipse((wx + 10, h / 2 + 2, wx + 16, h / 2 + 8), fill=fg_color)
    ax = width - 62
    d.rounded_rectangle((ax, h / 2 - 5, ax + 38, h / 2 + 11), radius=5, outline=fg_color, width=3)
    d.rounded_rectangle((ax + 3, h / 2 - 2, ax + 28, h / 2 + 8), radius=3, fill=fg_color)
    d.rounded_rectangle((ax + 41, h / 2 - 1, ax + 45, h / 2 + 7), radius=2, fill=fg_color)
    return bar


@functools.lru_cache(maxsize=16)
def phone_frame(screen_w: int, screen_h: int, body_color=(10, 16, 34), radius: int = 66, bezel: int = 12) -> Image.Image:
    """Phone body with a transparent 'hole' where the screen goes.

    The hole is cleared through an alpha mask (a plain rounded_rectangle with
    fill alpha 0 would *replace* the screen pixels with transparent black).
    """
    w, h = screen_w + bezel * 2, screen_h + bezel * 2
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=radius + bezel, fill=tuple(body_color) + (255,))
    d.rounded_rectangle((1, 1, w - 2, h - 2), radius=radius + bezel, outline=(70, 92, 140, 150), width=2)
    hole = Image.new("L", (screen_w, screen_h), 255)
    img.paste(Image.new("RGBA", (screen_w, screen_h), (0, 0, 0, 0)), (bezel, bezel), hole)
    d = ImageDraw.Draw(img)
    d.ellipse((w / 2 - 7, bezel + 16, w / 2 + 7, bezel + 30), fill=(5, 8, 18, 255))
    return img


def phone_layer(screen: Image.Image, body_color=(10, 16, 34), radius=62, bezel=12, glare=True) -> Image.Image:
    """Phone body + masked screen + screen glare."""
    sw, sh = screen.size
    screen = screen.convert("RGBA")
    screen.putalpha(round_mask(sw, sh, radius))
    out = Image.new("RGBA", (sw + bezel * 2, sh + bezel * 2), (0, 0, 0, 0))
    out.alpha_composite(screen, (bezel, bezel))
    out.alpha_composite(phone_frame(sw, sh, body_color, radius, bezel))
    if glare:
        glare_img = Image.new("RGBA", out.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(glare_img)
        d.polygon(
            [(0, sh * 0.10), (sw * 0.55, 0), (sw * 0.95, 0), (0, sh * 0.75)],
            fill=(255, 255, 255, 12),
        )
        mask = Image.new("L", out.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            (bezel, bezel, bezel + sw - 1, bezel + sh - 1), radius=radius, fill=255
        )
        out.alpha_composite(Image.composite(glare_img, Image.new("RGBA", out.size, (0, 0, 0, 0)), mask))
    return out


def shadow_rect(w: int, h: int, radius: int, blur: int = 60, dy: int = 30, alpha: int = 150) -> Image.Image:
    pad = blur * 2
    layer = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((pad, pad + dy, pad + w, pad + h + dy), radius=radius, fill=(0, 0, 0, alpha))
    return layer.filter(ImageFilter.GaussianBlur(blur))
