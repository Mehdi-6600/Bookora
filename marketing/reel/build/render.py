"""Renders the Bookora reel to MP4 (1080x1920, 30 fps) and builds the cut-downs.

Usage:
  python render.py            # full 30 s master + 15 s story cut + cover + poster
  python render.py --still 2  # single frame for checking
"""

from __future__ import annotations

import argparse
import multiprocessing as mp
import os
import subprocess
import sys
import time

import numpy as np
from PIL import Image

import reelkit as rk
import scenes as sc

FFMPEG = os.environ.get("FFMPEG", "/tmp/fftest/node_modules/@ffmpeg-installer/linux-x64/ffmpeg")
OUT = rk.OUT
TMP = "/tmp/bookora-render"

STORY_CUTS = sc.STORY_SEGMENTS  # absolute (start, end) ranges from the master timeline


def render_worker(t: float) -> bytes:
    return rk.to_uint8(sc.render_frame(t)).tobytes()


def encode_range(times, out_path, audio_path, workers=1, crf=19, preset="medium", label=""):
    cmd = [
        FFMPEG, "-y", "-v", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{rk.W}x{rk.H}", "-r", str(rk.FPS), "-i", "pipe:0",
        "-i", audio_path,
        "-threads", "2", "-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-pix_fmt", "yuv420p",
        "-x264-params", "rc-lookahead=20:ref=3:bframes=2",
        "-profile:v", "high", "-level", "4.2", "-g", "60", "-keyint_min", "30",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
        "-shortest", "-movflags", "+faststart",
        out_path,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    t0 = time.time()
    if workers <= 1:
        results = map(render_worker, times)
    else:
        pool = mp.Pool(workers)
        results = pool.imap(render_worker, times, chunksize=1)
    try:
        for i, frame in enumerate(results):
            proc.stdin.write(frame)
            if i % 30 == 0:
                el = time.time() - t0
                fps = (i + 1) / max(el, 1e-6)
                print(f"  {label} frame {i + 1}/{len(times)}  {fps:.2f} fps  eta {(len(times) - i - 1) / max(fps, 1e-6):.0f}s", flush=True)
    finally:
        if workers > 1:
            pool.close()
            pool.join()
    proc.stdin.close()
    ret = proc.wait()
    if ret != 0:
        raise SystemExit(f"ffmpeg failed with {ret}")
    print(f"  {label} wrote {out_path} in {time.time() - t0:.0f}s")


def times_for(start, end, fps=rk.FPS):
    n = int(round((end - start) * fps))
    return [start + i / fps for i in range(n)]


def build_story_audio():
    """The 15 s story has its own VO script/timing, built by audio.py."""
    import soundfile as sf

    path = os.path.join(OUT, "audio", "story-mix.wav")
    x, sr = sf.read(path)
    return path, len(x) / sr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--still", type=float, default=None)
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--skip-full", action="store_true")
    ap.add_argument("--story-only", action="store_true")
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    if args.still is not None:
        f = sc.render_frame(args.still)
        p = os.path.join(OUT, f"still_{args.still:05.2f}.png")
        Image.fromarray(rk.to_uint8(f)).save(p)
        print(p)
        return

    mix = os.path.join(OUT, "audio", "mix.wav")
    if not os.path.exists(mix):
        raise SystemExit("run audio.py first")

    if not args.skip_full and not args.story_only:
        print("rendering 30 s master…")
        full = os.path.join(OUT, "bookora-reel-1080x1920-30s.mp4")
        encode_range(times_for(0.0, sc.TOTAL), full, mix, args.workers, crf=19, preset="medium", label="master")

    print("building 15 s story cut…")
    story_audio, dur = build_story_audio()
    story = os.path.join(OUT, "bookora-reel-1080x1920-15s-story.mp4")
    ts = []
    for a, b in STORY_CUTS:
        ts.extend(times_for(a, b))
    encode_range(ts, story, story_audio, args.workers, crf=19, preset="medium", label="story")
    print(f"  story video {len(ts) / rk.FPS:.2f}s audio {dur:.2f}s")

    if not args.story_only:
        run_cover()

def run_cover():
    import cover as cover_mod
    p = os.path.join(OUT, "bookora-reel-cover.png")
    cover_mod.build().save(p)
    print("wrote", p)


if __name__ == "__main__":
    main()
