"""Builds the reel cover (1080x1920) — a designed poster frame, not a raw still."""

from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import reelkit as rk
import scenes as sc


def build(t_frame: float = 2.0) -> Image.Image:
    """Cover poster: the hook's phone shot (text-free) + a single, bright headline."""
    # draw the chat mock directly (no scene headline underneath)
    phone = sc.dm_state(2.0)
    frame = sc.bg_hook()
    rk.add_glow(frame, 540, 1040, 1200, (30, 92, 220), 2.0, 0.45)

    px, py = 540, 1105
    rk.blend(frame, phone, px - phone.width / 2, py - phone.height / 2, 1.0)
    badge = rk.chip_img("۹ پیام بی‌جواب", "Bold", 30, (255, 255, 255), (232, 72, 84, 255), None,
                        26, 13, rk.icon("bell", 30, (255, 255, 255)), 10, shadow=(0, 8, 22, 140))
    rk.blend(frame, badge, 736, 560)

    # soften and dim for the poster treatment
    scene = Image.fromarray(rk.to_uint8(frame)).filter(ImageFilter.GaussianBlur(1.0))
    frame = np.asarray(scene, dtype=np.float32) * 0.62
    yy = np.arange(rk.H, dtype=np.float32)[:, None, None] / rk.H
    band = (np.clip((0.22 - yy) / 0.22, 0, 1) * 0.62
            + np.clip((yy - 0.60) / 0.40, 0, 1) * 0.70)
    frame = frame * (1 - band)

    # headline + handle, drawn last so they stay crisp and bright
    sc.txt(frame, "ربات رزرو", 92, "Black", rk.WHITE, cy=286, max_w=940)
    sc.txt(frame, "سالن زیبایی", 92, "Black", rk.CYAN, cy=382, max_w=940)
    # handle pill: Latin rendered LTR, Persian label drawn separately so bidi
    # cannot flip the @handle
    handle = rk.chip_img(rk.BOT_HANDLE, "Bold", 30, (232, 241, 252), (13, 30, 64, 225),
                         (110, 180, 245, 140), 30, 13, rk.icon("send", 26, (86, 204, 242)), 10,
                         shadow=(0, 8, 22, 120), rtl=False, icon_side="left")
    rk.blend(frame, handle, 540 - handle.width / 2 + 40, 1748)
    sc.txt(frame, "بوکورا", 34, "Bold", (206, 224, 250), cx=540 - handle.width / 2 - 60, cy=1776, max_w=300, shadow=False)

    # brand lockup above the handle
    rk.add_glow(frame, 540, 1660, 760, (36, 100, 245), 2.0, 0.55)
    sc.logo(frame, 540, 1652, 210, 0.95)

    out = Image.fromarray(rk.to_uint8(frame))
    d = ImageDraw.Draw(out)
    d.rounded_rectangle((26, 26, rk.W - 27, rk.H - 27), radius=44,
                        outline=(120, 190, 255, 110), width=3)
    return out


if __name__ == "__main__":
    import os
    p = os.path.join(rk.OUT, "bookora-reel-cover.png")
    build().save(p)
    print(p)
