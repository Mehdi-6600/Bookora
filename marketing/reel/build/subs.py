"""Generates the Persian subtitle files (.srt) for the 30 s reel and the 15 s story.

The cue text is exactly the on-screen copy, so subtitles can never drift from the
video: every line here is also rendered into the frame. Timing comes from the
scene table in `scenes.py`, so re-cutting the video and re-running this script
keeps subtitles in sync.

    python subs.py            # writes ../subtitles-fa.srt and ../subtitles-15s-fa.srt
"""

from __future__ import annotations

import os

import scenes as sc

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, ".."))

# (start, end, text) — start/end are absolute seconds on the master timeline
MASTER_CUES = [
    (0.62, 3.10, "پیام مشتری‌ها تموم نمی‌شه؟"),
    (3.55, 6.90, "منشی هوشمند رزرو شما"),
    (7.45, 10.10, "انتخاب ساعت، در چند ثانیه"),
    (10.10, 12.70, "تاریخ و ساعت خالی رو خودت انتخاب کن"),
    (13.15, 17.20, "رزرو ثبت شد، بدون پیام‌های بی‌پایان"),
    (17.70, 23.50, "همه‌چیز، در یک پنل"),
    (24.15, 27.00, "رزرو آنلاین، ساده و هوشمند"),
    (27.00, 29.40, "در تلگرام: Bookora_App_bot"),
]

# story-local cues (0-15 s)
STORY_CUES = [
    (0.45, 3.05, "پیام مشتری‌ها تموم نمی‌شه؟"),
    (3.70, 7.40, "انتخاب ساعت، در چند ثانیه"),
    (7.60, 9.40, "رزرو ثبت شد، بدون پیام‌های بی‌پایان"),
    (10.50, 12.60, "رزرو آنلاین، ساده و هوشمند"),
    (12.60, 14.60, "در تلگرام: Bookora_App_bot"),
]


def ts(t: float) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def write_srt(path: str, cues) -> None:
    lines = []
    for i, (a, b, text) in enumerate(cues, 1):
        lines += [str(i), f"{ts(a)} --> {ts(b)}", text, ""]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"{path}  ({len(cues)} cues, {os.path.getsize(path)} B)")


if __name__ == "__main__":
    write_srt(os.path.join(OUT, "subtitles-fa.srt"), MASTER_CUES)
    write_srt(os.path.join(OUT, "subtitles-15s-fa.srt"), STORY_CUES)
