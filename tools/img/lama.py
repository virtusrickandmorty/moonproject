"""
Erase marked areas and fill them from what is around (IMG image tools): `python lama.py <in> <mask.png> <out.png>`.

LaMa (Apache-2.0), the big-lama model as ONNX at 512 x 512, on the processor (it fails on DirectML on the shop's card).
Used to take a team name, number or logo off a photo before the online AI redraws it (the AI then never sees the
letters, so it cannot leave their shapes behind), and to touch up a leftover on flat art. The mask is white where to
erase. Each marked area is filled in a square window around it with as much again of the picture for context; a large
area is filled at a smaller scale (softer), and the picture keeps its own size and transparency.
"""
import os
import sys

import cv2
import numpy as np
import onnxruntime as ort

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.path.join(HERE, 'models', 'lama_fp32.onnx')


def read(path: str) -> np.ndarray:
    img = cv2.imdecode(np.fromfile(path, np.uint8), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise SystemExit('The picture could not be read.')
    return img


def main() -> int:
    if len(sys.argv) != 4:
        print('usage: lama.py <in> <mask.png> <out.png>', file=sys.stderr)
        return 2
    src, mask_file, dst = sys.argv[1:]
    img = read(src)
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    alpha = img[:, :, 3] if img.shape[2] == 4 else None
    bgr = np.ascontiguousarray(img[:, :, :3])
    h, w = bgr.shape[:2]
    m = read(mask_file)
    m = m if m.ndim == 2 else m[:, :, 3] if m.shape[2] == 4 and m[:, :, 3].min() < 255 else cv2.cvtColor(m[:, :, :3], cv2.COLOR_BGR2GRAY)
    if m.shape[:2] != (h, w):
        m = cv2.resize(m, (w, h), interpolation=cv2.INTER_NEAREST)
    # A little wider than marked: the soft edge of a letter and its outline go too.
    grow = max(3, round(max(h, w) / 300)) | 1
    todo = cv2.dilate((m > 127).astype(np.uint8) * 255, np.ones((grow, grow), np.uint8))
    if not todo.any():
        raise SystemExit('Nothing is marked to erase.')

    sess = ort.InferenceSession(MODEL, providers=['CPUExecutionProvider'])

    def lama(window: np.ndarray, wmask: np.ndarray) -> np.ndarray:
        wh, ww = window.shape[:2]
        im = cv2.resize(window, (512, 512), interpolation=cv2.INTER_AREA)[:, :, ::-1].astype(np.float32) / 255
        mk = (cv2.resize(wmask, (512, 512), interpolation=cv2.INTER_NEAREST) > 0).astype(np.float32)
        res = sess.run(None, {'image': im.transpose(2, 0, 1)[None], 'mask': mk[None, None]})[0][0].transpose(1, 2, 0)
        if res.max() <= 1.5:
            res = res * 255
        res = np.clip(res, 0, 255).astype(np.uint8)[:, :, ::-1]
        return cv2.resize(res, (ww, wh), interpolation=cv2.INTER_CUBIC)

    out = bgr.copy()
    for _ in range(4):  # what a window could not reach waits for the next pass
        if not todo.any():
            break
        n, _, stats, _ = cv2.connectedComponentsWithStats(todo)
        for i in range(1, n):
            x, y, bw, bh = (int(v) for v in stats[i, :4])
            side = max(512, int(max(bw, bh) * 1.8) + 32)
            sw, sh = min(side, w), min(side, h)
            cx, cy = x + bw // 2, y + bh // 2
            x0, y0 = max(0, min(w - sw, cx - sw // 2)), max(0, min(h - sh, cy - sh // 2))
            wm = todo[y0:y0 + sh, x0:x0 + sw]
            if not wm.any():
                continue
            filled = lama(out[y0:y0 + sh, x0:x0 + sw], wm)
            sel = wm > 0
            out[y0:y0 + sh, x0:x0 + sw][sel] = filled[sel]
            todo[y0:y0 + sh, x0:x0 + sw][sel] = 0
    result = np.dstack([out, alpha]) if alpha is not None else out
    ok, data = cv2.imencode('.png', result)
    if not ok:
        raise SystemExit('The result could not be saved.')
    data.tofile(dst)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except SystemExit as e:
        if isinstance(e.code, str):
            print(e.code, file=sys.stderr)
            sys.exit(1)
        raise
