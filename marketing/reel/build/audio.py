"""Builds the reel soundtrack: an original synthesized music bed + the Persian VO.

The bed is generated from scratch (chords, bass, pulse, sparkle arpeggio) so the
reel ships with music that is free to use commercially, with no third-party
sample or track.  VO clips are laid on the timeline, normalised to broadcast-ish
loudness, and the bed is side-chain ducked under the voice.
"""

from __future__ import annotations

import glob
import os

import numpy as np
import soundfile as sf

import reelkit as rk
import scenes as sc

SR = 48000
DUR = sc.TOTAL
VO_DIR = os.path.join(rk.ASSETS, "vo")
OUT = os.path.join(rk.OUT, "audio")
os.makedirs(OUT, exist_ok=True)


def t_axis(dur=DUR):
    return np.arange(int(dur * SR), dtype=np.float64) / SR


def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def env_adsr(n, a=0.01, d=0.1, s=0.7, r=0.2):
    a_n, d_n, r_n = int(a * SR), int(d * SR), int(r * SR)
    s_n = max(0, n - a_n - d_n - r_n)
    parts = [
        np.linspace(0, 1, a_n, endpoint=False) if a_n else np.array([]),
        np.linspace(1, s, d_n, endpoint=False) if d_n else np.array([]),
        np.full(s_n, s),
        np.linspace(s, 0, r_n) if r_n else np.array([]),
    ]
    e = np.concatenate(parts)
    if len(e) < n:
        e = np.pad(e, (0, n - len(e)))
    return e[:n]


def add(buf, sig, t0, gain=1.0):
    i0 = int(t0 * SR)
    i1 = min(len(buf), i0 + len(sig))
    if i1 > i0:
        buf[i0:i1] += sig[: i1 - i0] * gain


# ----------------------------------------------------------------- harmony


def chord_notes(name):
    table = {
        "Am": [57, 60, 64], "F": [53, 57, 60], "C": [48, 52, 55], "G": [55, 59, 62],
        "Dm": [50, 53, 57], "Em": [52, 55, 59],
    }
    return table[name]


def pad_tone(freq, n, detune=0.0025):
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k, amp in ((1, 1.0), (2, 0.14), (3, 0.04)):
        out += amp * np.sin(2 * np.pi * freq * k * t + k * 0.7)
    out += 0.6 * np.sin(2 * np.pi * freq * (1 + detune) * t + 1.3)
    return out


def pluck(freq, n, bright=0.5):
    t = np.arange(n) / SR
    sig = np.sin(2 * np.pi * freq * t) + bright * 0.5 * np.sin(2 * np.pi * freq * 2 * t)
    e = np.exp(-t * 11.0)
    return sig * e


def kick(n, gain=1.0):
    t = np.arange(n) / SR
    f = 108 * np.exp(-t * 26) + 46
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 5.2) * gain


def hat(n, seed=0):
    rng = np.random.default_rng(seed)
    t = np.arange(n) / SR
    noise = rng.normal(0, 1, n)
    noise = np.diff(noise, prepend=0)  # brighten
    return noise * np.exp(-t * 55) * 0.5


def build_music(dur: float = DUR) -> np.ndarray:
    dur_s = dur
    n = int(dur_s * SR)
    L = np.zeros(n)
    R = np.zeros(n)

    # 92 BPM, one bar = 2.6087 s -> 16th = 0.163 s
    bpm = 92
    beat = 60.0 / bpm
    bar = beat * 4
    prog = ["Am", "F", "C", "G", "Am", "F", "C", "G", "Am", "F", "C", "G"]

    # ---- warm pad
    for b, name in enumerate(prog):
        t0 = b * bar
        if t0 >= dur_s:
            break
        dur = bar * 1.05
        nn = int(dur * SR)
        env = env_adsr(nn, a=0.35, d=0.4, s=0.75, r=0.9)
        for i, m in enumerate(chord_notes(name)):
            f = midi_hz(m)
            sig = pad_tone(f, nn) * env * 0.10
            pan = (i - 1) * 0.18
            add(L, sig, t0, 1 - pan)
            add(R, sig, t0, 1 + pan)

    # ---- soft bass on beats 1 and 3
    for b, name in enumerate(prog):
        root = chord_notes(name)[0] - 12
        for k in (0, 2):
            t0 = b * bar + k * beat
            if t0 >= dur_s:
                continue
            nn = int(beat * 0.9 * SR)
            t = np.arange(nn) / SR
            sig = (np.sin(2 * np.pi * midi_hz(root) * t) + 0.25 * np.sin(2 * np.pi * midi_hz(root) * 2 * t))
            sig *= env_adsr(nn, 0.01, 0.15, 0.55, 0.25) * 0.16
            add(L, sig, t0, 1.0)
            add(R, sig, t0, 1.0)

    # ---- pulse arpeggio (enters at 7s), 16ths
    arp_pattern = [0, 1, 2, 1, 2, 0, 1, 2]
    start_arp = max(0.0, sc.SCENES[2][1] - 0.4) if dur_s > 18 else 3.2
    step = beat / 4
    k = 0
    t0 = start_arp
    while t0 < min(24.4, dur_s - 1.0):
        b = int(t0 // bar)
        if b >= len(prog):
            break
        notes = chord_notes(prog[b])
        m = notes[arp_pattern[k % len(arp_pattern)]] + 12
        nn = int(step * 2.4 * SR)
        sig = pluck(midi_hz(m), nn, 0.4) * 0.055
        pan = 0.35 if k % 2 else -0.35
        add(L, sig, t0, 1 - pan)
        add(R, sig, t0, 1 + pan)
        t0 += step
        k += 1

    # ---- drums: kick from 7s, hats from 7s, drop out during the last 1.6s
    t = 7.0 if dur_s > 18 else 3.2
    i = 0
    while t < min(27.4, dur_s - 0.6):
        if t < 23.6 or t > 23.75:
            if i % 4 == 0:
                add(L, kick(int(0.5 * SR)), t, 0.30)
                add(R, kick(int(0.5 * SR)), t, 0.30)
            if i % 2 == 1:
                h = hat(int(0.09 * SR), seed=i)
                add(L, h, t, 0.10)
                add(R, h, t, 0.12)
        t += beat / 2
        i += 1

    # ---- riser into the CTA (22.9 -> 23.75) and a soft impact at 23.75
    nn = int(0.9 * SR)
    tt = np.arange(nn) / SR
    rng = np.random.default_rng(5)
    riser = rng.normal(0, 1, nn) * np.linspace(0, 1, nn) ** 2.2 * 0.10
    # gentle band emphasis
    riser = np.convolve(riser, np.ones(6) / 6, mode="same")
    if dur_s > 18:
        add(L, riser, 22.85)
        add(R, riser, 22.85)
        imp = kick(int(1.2 * SR), 1.0) * 0.22
        add(L, imp, 23.75)
        add(R, imp, 23.75)

    # ---- shimmer for the end card
    shimmer_t0 = 24.2 if dur_s > 18 else dur_s - 4.9
    for j, m in enumerate([76, 79, 83, 86]):
        nn = int(max(0.1, dur_s - shimmer_t0) * SR)
        tt = np.arange(nn) / SR
        sig = np.sin(2 * np.pi * midi_hz(m) * tt) * np.exp(-tt * 0.55) * 0.020
        add(L, sig, shimmer_t0 + j * 0.12, 1.0 - 0.1 * j)
        add(R, sig, shimmer_t0 + j * 0.12, 0.9 + 0.1 * j)

    # ---- gentle low-pass character on the bed
    def onepole(x, cutoff):
        a = np.exp(-2 * np.pi * cutoff / SR)
        y = np.empty_like(x)
        acc = 0.0
        for idx in range(len(x)):
            acc = a * acc + (1 - a) * x[idx]
            y[idx] = acc
        return y

    # vectorised approximation via FFT filtering (fast for 30 s)
    def lp(x, cutoff):
        X = np.fft.rfft(x)
        f = np.fft.rfftfreq(len(x), 1 / SR)
        X *= 1 / (1 + (f / cutoff) ** 2)
        return np.fft.irfft(X, len(x))

    L = lp(L, 5200)
    R = lp(R, 5200)

    # fade in / out
    fade_in = int(min(0.6, dur_s / 6) * SR)
    fade_out = int(1.1 * SR)
    L[:fade_in] *= np.linspace(0, 1, fade_in)
    R[:fade_in] *= np.linspace(0, 1, fade_in)
    L[-fade_out:] *= np.linspace(1, 0, fade_out)
    R[-fade_out:] *= np.linspace(1, 0, fade_out)

    peak = max(np.abs(L).max(), np.abs(R).max())
    L /= peak / 0.75
    R /= peak / 0.75
    return np.stack([L, R], axis=1)


# ----------------------------------------------------------------- voiceover


def load_clip(name: str) -> np.ndarray:
    sub = os.path.join(OUT, "_tmp")
    os.makedirs(sub, exist_ok=True)
    src = os.path.join(VO_DIR, f"{name}.mp3")
    wav = os.path.join(sub, f"{name}.wav")
    if not os.path.exists(wav) or os.path.getmtime(src) > os.path.getmtime(wav):
        os.system(f'"{FFMPEG}" -v error -y -i "{src}" -ar {SR} -ac 1 "{wav}"')
    x, sr = sf.read(wav)
    assert sr == SR
    env = np.abs(x)
    thr = max(env.max() * 0.02, 10 ** (-46 / 20))
    idx = np.where(env > thr)[0]
    if len(idx):
        x = x[max(0, idx[0] - int(0.04 * SR)): min(len(x), idx[-1] + int(0.10 * SR))]
    return x / max(1e-9, np.abs(x).max()) * 0.7


def assemble(vo_cues: dict, dur: float):
    """Build VO track, music bed, ducking and master mix for an arbitrary cut."""
    vo = np.zeros(int(dur * SR))
    for name, cue in vo_cues.items():
        x = load_clip(name)
        add(vo, x, cue)
        print(f"  VO {name}: cue {cue:.2f}s len {len(x) / SR:.2f}s")
    vo = compress(vo, 0.32, 2.6, 0.004, 0.09)
    vo = np.convolve(vo, np.ones(3) / 3, mode="same")

    music = build_music(dur)
    env = np.abs(vo)
    win = int(0.16 * SR)
    smooth = np.convolve(env, np.ones(win) / win, mode="same")
    smooth = smooth / max(1e-9, smooth.max())
    duck = 1.0 - 0.62 * np.clip(smooth * 3.0, 0, 1)

    tt = np.arange(len(music)) / SR
    beat = 60.0 / 92
    phase = np.mod(tt / beat, 1.0)
    pump = 1.0 - 0.16 * np.exp(-phase * 7.0)
    pump[: int(min(7.0, dur - 0.5) * SR)] = 1.0
    bed = music * (duck * pump)[:, None] * 0.53

    mix = bed + vo[:, None] * 1.12
    mix = mix / max(1e-9, np.abs(mix).max()) * 0.89
    return vo, music, bed, mix


def load_vo() -> np.ndarray:
    """Place every VO clip on the timeline (mono)."""
    vo = np.zeros(int(DUR * SR))
    for name, cue in sc.VO_CUES.items():
        path = os.path.join(VO_DIR, f"{name}.mp3")
        sub = os.path.join(OUT, "_tmp")
        os.makedirs(sub, exist_ok=True)
        wav = os.path.join(sub, f"{name}.wav")
        if not os.path.exists(wav):
            os.system(
                f'"{FFMPEG}" -v error -y -i "{path}" -ar {SR} -ac 1 "{wav}"'
            )
        x, sr = sf.read(wav)
        assert sr == SR
        # trim leading/trailing silence
        env = np.abs(x)
        thr = max(env.max() * 0.02, 10 ** (-46 / 20))
        idx = np.where(env > thr)[0]
        if len(idx):
            a = max(0, idx[0] - int(0.04 * SR))
            b = min(len(x), idx[-1] + int(0.10 * SR))
            x = x[a:b]
        # peak normalise each clip; loudness evened later
        x = x / max(1e-9, np.abs(x).max()) * 0.7
        add(vo, x, cue)
        print(f"  VO {name}: cue {cue:.2f}s len {len(x)/SR:.2f}s")
    return vo


def compress(x, thresh=0.45, ratio=3.0, attack=0.004, release=0.12):
    """Simple feed-forward compressor (peak-based, mono/stereo-safe)."""
    env = np.abs(x)
    a = np.exp(-1 / (attack * SR))
    r = np.exp(-1 / (release * SR))
    e = np.empty_like(env)
    acc = 0.0
    # vectorised-ish envelope follower using cumulative approach per block
    for i in range(len(env)):
        c = a if env[i] > acc else r
        acc = c * acc + (1 - c) * env[i]
        e[i] = acc
    over = np.maximum(e - thresh, 0)
    gain = 1.0 / (1.0 + over * (ratio - 1) / max(thresh, 1e-6))
    return x * gain


def main():
    print("building music bed…")
    music = build_music()
    sf.write(os.path.join(OUT, "music-bed.wav"), music, SR)

    print("placing voiceover…")
    vo = load_vo()
    # smooth the VO: tiny de-ess-ish low-pass + gentle compression
    vo = compress(vo, 0.32, 2.6, 0.004, 0.09)
    vo = np.convolve(vo, np.ones(3) / 3, mode="same")
    sf.write(os.path.join(OUT, "voiceover.wav"), vo, SR)

    # duck the bed under the voice (side-chain style with a slow envelope)
    env = np.abs(vo)
    win = int(0.16 * SR)
    kernel = np.ones(win) / win
    smooth = np.convolve(env, kernel, mode="same")
    smooth = smooth / max(1e-9, smooth.max())
    duck = 1.0 - 0.62 * np.clip(smooth * 3.0, 0, 1)

    # gentle pump synced to the kick (every beat, 92 BPM) for a modern feel
    tt = np.arange(len(music)) / SR
    beat = 60.0 / 92
    phase = np.mod(tt / beat, 1.0)
    pump = 1.0 - 0.16 * np.exp(-phase * 7.0)
    pump[: int(7.0 * SR)] = 1.0

    bed = music * (duck * pump)[:, None] * 0.53

    sf.write(os.path.join(OUT, "bed-ducked.wav"), bed, SR)
    mix = bed + vo[:, None] * 1.12
    # master: gentle limiter and normalise to about -1 dBFS
    peak = np.abs(mix).max()
    mix = mix / max(1e-9, peak) * 0.89
    sf.write(os.path.join(OUT, "mix.wav"), mix, SR)
    print(f"wrote {OUT}/mix.wav  ({len(mix)/SR:.2f}s)  peak {np.abs(mix).max():.3f}")

    # ---------- 15 s story cut: its own script, timing and music ----------
    print("building 15 s story audio…")
    svo, smusic, sbed, smix = assemble(sc.STORY_VO_CUES, sc.STORY_TOTAL)
    sf.write(os.path.join(OUT, "story-mix.wav"), smix, SR)
    print(f"wrote {OUT}/story-mix.wav ({len(smix)/SR:.2f}s)")


FFMPEG = os.environ.get("FFMPEG", "/tmp/fftest/node_modules/@ffmpeg-installer/linux-x64/ffmpeg")

if __name__ == "__main__":
    main()
