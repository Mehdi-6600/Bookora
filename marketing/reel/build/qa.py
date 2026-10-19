"""Contact sheet QA: samples frames from a rendered mp4 and tiles them."""
import os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

FFMPEG = "/tmp/fftest/node_modules/@ffmpeg-installer/linux-x64/ffmpeg"
FONT = "/tmp/venv/fonts/Vazirmatn-Bold.ttf"

def sheet(video, out, n=12, cols=6):
    dur = float(subprocess.run([FFMPEG, "-i", video], capture_output=True, text=True).stderr
                .split("Duration: ")[1].split(",")[0].strip().split(":")[2])
    tmp = "/tmp/qa_frames"; os.makedirs(tmp, exist_ok=True)
    imgs = []
    for i in range(n):
        t = dur * (i + 0.5) / n
        p = f"{tmp}/{i:02d}.png"
        subprocess.run([FFMPEG, "-v", "error", "-y", "-i", video, "-ss", f"{t:.3f}", "-frames:v", "1", p], check=True)
        imgs.append((t, Image.open(p).resize((216, 384))))
    rows = (n + cols - 1) // cols
    sh = Image.new("RGB", (216 * cols, (384 + 26) * rows), (16, 16, 22))
    d = ImageDraw.Draw(sh)
    f = ImageFont.truetype(FONT, 17)
    for i, (t, im) in enumerate(imgs):
        x, y = (i % cols) * 216, (i // cols) * (384 + 26)
        sh.paste(im, (x, y + 26))
        d.text((x + 8, y + 4), f"{t:.2f}s", font=f, fill=(240, 240, 240))
    sh.save(out)
    print(out, sh.size)

if __name__ == "__main__":
    sheet(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 12,
          int(sys.argv[4]) if len(sys.argv) > 4 else 6)
