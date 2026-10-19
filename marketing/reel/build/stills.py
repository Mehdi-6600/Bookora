import os, sys, time
import numpy as np
from PIL import Image
import reelkit as rk
import scenes as sc

OUT = os.path.join(rk.REEL, 'output', '_stills')
os.makedirs(OUT, exist_ok=True)

times = [float(x) for x in (sys.argv[1:] or [1.2, 2.6, 5.4, 10.2, 15.2, 21.6, 27.4])]
for t in times:
    t0 = time.time()
    f = sc.render_frame(t)
    dt = time.time() - t0
    img = Image.fromarray(rk.to_uint8(f))
    p = os.path.join(OUT, f'still_{t:05.2f}.png')
    img.save(p)
    print(f'{p}  {dt*1000:.0f} ms')
