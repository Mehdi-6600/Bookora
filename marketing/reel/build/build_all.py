"""One-shot build: audio -> master -> story cut -> cover -> subtitles.

    python build_all.py

Requires FFMPEG (env var) pointing at a static ffmpeg binary. Rendering is
single-process on purpose: the frame pipe + x264 encoder must stay in lockstep
so memory stays flat on small machines.
"""

from __future__ import annotations

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable


def run(*args):
    print("\n$", " ".join(args), flush=True)
    subprocess.run([PY, *args], cwd=HERE, check=True)


if __name__ == "__main__":
    run("audio.py")
    run("render.py")
    run("cover.py")
    run("subs.py")
    print("\nall artefacts rebuilt in", os.path.join(HERE, "..", "output"))
