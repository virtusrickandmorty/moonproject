"""
Photo to flat art (IMG image tools): `python flatart.py <in> <out.png> <options.json>`; prints what it found as JSON.

A photo of a printed design (a shirt, a tarpaulin, paper) back to clean artwork: straighten it from four corners, smooth
away fabric texture and noise, even out the light, reduce it to a few exact colours, drop specks and smooth the edges,
and clear the background. Runs on the processor with OpenCV (Apache-2.0); a picture takes seconds.

Options (all optional):
  corners  [[x, y] x4] as fractions of the picture, top-left, top-right, bottom-right, bottom-left: straighten
  clean    0-3: none, light, medium, strong smoothing of texture and noise
  light    true: even out uneven light (a shadow across the photo)
  colours  2-12: how many colours to find; 0 (the default): as many as there look to be
  palette  ["rrggbb", ...]: use exactly these colours instead of finding them (the colours a first run found)
  paint    ["rrggbb" | null, ...]: what each palette colour becomes (null: clear); merging two = the same paint
  specks   0-3: drop no, small, medium or large specks
  clear    true: the background (the colour around the edge) becomes clear
"""
import json
import os
import sys

import cv2
import numpy as np

ALIKE = 26  # Lab distance (0-255 scale) under which two found colours are one ink
MAX_SIDE = 3000  # the working size: larger photos are made smaller first (upscale the result if it must be bigger)


def read(path: str) -> tuple[np.ndarray, np.ndarray | None]:
    """The picture as BGR, and its opacity when it has one (np.fromfile: the path may have any characters)."""
    img = cv2.imdecode(np.fromfile(path, np.uint8), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise SystemExit('The picture could not be read.')
    if img.dtype != np.uint8:
        img = cv2.convertScaleAbs(img, alpha=255.0 / max(1, int(img.max())))
    if img.ndim == 2:
        return cv2.cvtColor(img, cv2.COLOR_GRAY2BGR), None
    if img.shape[2] == 4:
        alpha = img[:, :, 3]
        return np.ascontiguousarray(img[:, :, :3]), (alpha if alpha.min() < 255 else None)
    return img, None


def write_png(path: str, img: np.ndarray) -> None:
    ok, data = cv2.imencode('.png', img)
    if not ok:
        raise SystemExit('The result could not be saved.')
    data.tofile(path)


def straighten(bgr, alpha, corners):
    h, w = bgr.shape[:2]
    src = np.float32([[x * w, y * h] for x, y in corners])
    d = lambda a, b: float(np.hypot(*(src[a] - src[b])))
    W, H = int(round(max(d(0, 1), d(3, 2)))), int(round(max(d(0, 3), d(1, 2))))
    if W < 8 or H < 8:
        raise SystemExit('The corners are too close together. Drag them to the corners of the design.')
    M = cv2.getPerspectiveTransform(src, np.float32([[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]]))
    bgr = cv2.warpPerspective(bgr, M, (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    if alpha is not None:
        alpha = cv2.warpPerspective(alpha, M, (W, H), flags=cv2.INTER_LINEAR, borderValue=0)
    return bgr, alpha


def even_light(bgr):
    """
    Evens out the slow change of brightness across the photo (a shadow, a lamp on one side). The light is measured on the
    shirt or paper itself: a wide closing (light ground) or opening (dark ground) wipes the design out, leaving the ground.
    """
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    L = lab[:, :, 0].astype(np.float32)
    h, w = L.shape
    small = cv2.resize(L, (max(1, w // 4), max(1, h // 4)), interpolation=cv2.INTER_AREA)
    edge = np.concatenate([small[0], small[-1], small[:, 0], small[:, -1]])
    light_ground = float(np.median(edge)) >= 128
    k = max(9, (max(small.shape) // 12) | 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    ground = cv2.morphologyEx(small, cv2.MORPH_CLOSE if light_ground else cv2.MORPH_OPEN, kernel)
    ground = cv2.GaussianBlur(ground, (0, 0), k / 2)
    ground = cv2.resize(ground, (w, h), interpolation=cv2.INTER_LINEAR)
    target = float(np.median(ground))
    # A light ground scales (ink in the shadow darkens in proportion); a dark one shifts (dividing would lift its noise).
    L = L * (target / np.maximum(ground, 1)) if light_ground else L + (target - ground)
    lab[:, :, 0] = np.clip(L, 0, 255).astype(np.uint8)
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)


def smooth(bgr, level: int):
    """Edge-keeping smoothing: fabric weave, halftone grain and camera noise go, the design's edges stay."""
    if level <= 0:
        return bgr
    sp, sr = [(0, 0), (5, 14), (9, 22), (14, 34)][level]
    out = cv2.pyrMeanShiftFiltering(bgr, sp, sr)
    return cv2.medianBlur(out, 3 if level < 3 else 5)


def to_lab(bgr: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)


def hex_to_lab(colours: list[str]) -> np.ndarray:
    bgr = np.uint8([[[int(c[4:6], 16), int(c[2:4], 16), int(c[0:2], 16)] for c in colours]])
    return to_lab(bgr)


def lab_to_hex(centres: np.ndarray) -> list[str]:
    bgr = cv2.cvtColor(np.clip(np.round(centres), 0, 255).astype(np.uint8).reshape(1, -1, 3), cv2.COLOR_LAB2BGR)[0]
    return ['%02x%02x%02x' % (int(r), int(g), int(b)) for b, g, r in bgr]


def find_colours(lab: np.ndarray, k: int) -> np.ndarray:
    """
    k-means in Lab (colour distances as the eye sees them) on a sample; the same picture gives the same colours. k 0 is
    auto: twelve, then the closest two merged while they look alike (shades of one ink from light and wear).
    """
    rng = np.random.default_rng(1)
    sample = lab if len(lab) <= 200_000 else lab[rng.choice(len(lab), 200_000, replace=False)]
    want = k if k > 0 else 12
    want = max(1, min(want, len(np.unique(sample.astype(np.uint8), axis=0))))
    cv2.setRNGSeed(1)
    _, labels, centres = cv2.kmeans(sample, want, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5), 3, cv2.KMEANS_PP_CENTERS)
    if k > 0:
        return centres
    counts = np.bincount(labels.reshape(-1), minlength=len(centres)).astype(np.float64)
    centres = centres.astype(np.float64)
    keep = counts > len(sample) * 0.0005  # a colour on almost nothing is noise
    centres, counts = centres[keep], counts[keep]
    while len(centres) > 1:
        d = np.sqrt(((centres[:, None, :] - centres[None, :, :]) ** 2).sum(axis=2))
        np.fill_diagonal(d, np.inf)
        i, j = np.unravel_index(int(np.argmin(d)), d.shape)
        if d[i, j] > ALIKE:
            break
        centres[i] = (centres[i] * counts[i] + centres[j] * counts[j]) / (counts[i] + counts[j])
        counts[i] += counts[j]
        centres, counts = np.delete(centres, j, axis=0), np.delete(counts, j)
    # A small colour that lies between two bigger ones is their blended edge, not an ink of its own.
    share = counts / counts.sum()
    blend = np.zeros(len(centres), bool)
    for c in np.argsort(share):
        if share[c] >= 0.03:
            break
        big = [i for i in range(len(centres)) if share[i] > share[c] and not blend[i]]
        for a in big:
            for b in big:
                if a < b:
                    ab = centres[b] - centres[a]
                    t = np.clip(np.dot(centres[c] - centres[a], ab) / max(1e-9, np.dot(ab, ab)), 0, 1)
                    if np.linalg.norm(centres[a] + t * ab - centres[c]) < ALIKE and 0.05 < t < 0.95:
                        blend[c] = True
        blend[c] |= share[c] < 0.002
    return centres[~blend].astype(np.float32)


def nearest(lab: np.ndarray, centres: np.ndarray) -> np.ndarray:
    out = np.empty(len(lab), np.int32)
    step = max(20_000, 12_000_000 // len(centres))  # in parts: pixels x colours distances need memory
    for i in range(0, len(lab), step):
        part = lab[i:i + step]
        out[i:i + len(part)] = np.argmin(((part[:, None, :] - centres[None, :, :]) ** 2).sum(axis=2), axis=1)
    return out


def tidy(labels: np.ndarray, k: int, specks: int, edges: bool = True) -> np.ndarray:
    """Specks (small islands of a colour) take the colour around them; then the edges are smoothed (no stair-steps)."""
    h, w = labels.shape
    valid = labels >= 0
    min_area = [0, max(6, h * w // 200_000), max(20, h * w // 40_000), max(60, h * w // 8_000)][specks]
    if min_area:
        unknown = np.zeros_like(valid)
        for c in range(k):
            n, comp, stats, _ = cv2.connectedComponentsWithStats((labels == c).astype(np.uint8), connectivity=8)
            small = stats[:, cv2.CC_STAT_AREA] < min_area
            small[0] = False
            unknown |= small[comp]
            if specks >= 2:
                # Slivers: a colour only a pixel or two wide along another's edge is that edge's blend, not a line.
                mask = (labels == c).astype(np.uint8)
                unknown |= (mask > 0) & (cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) == 0)
        if unknown.any() and not unknown.all():
            # Each unknown pixel takes the colour of the nearest known one: the distance runs to the nearest zero, so the
            # known pixels are the zeros, and each carries its own label (DIST_LABEL_PIXEL) back to its colour.
            _, near = cv2.distanceTransformWithLabels(unknown.astype(np.uint8), cv2.DIST_L2, 3, labelType=cv2.DIST_LABEL_PIXEL)
            lut = np.zeros(int(near.max()) + 1, np.int32)
            lut[near[~unknown]] = labels[~unknown]
            labels = labels.copy()
            labels[unknown] = lut[near[unknown]]
    if edges and k > 1:
        sigma = max(0.8, max(h, w) / 1500)
        score = np.stack([cv2.GaussianBlur((labels == c).astype(np.float32), (0, 0), sigma) for c in range(k)])
        smoothed = np.argmax(score, axis=0).astype(np.int32)
        labels = np.where(labels >= 0, smoothed, labels)
    return labels


def background_of(labels: np.ndarray) -> int | None:
    """The colour around the edge, when most of the edge has it."""
    edge = np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])
    edge = edge[edge >= 0]
    if not len(edge):
        return None
    counts = np.bincount(edge)
    top = int(np.argmax(counts))
    return top if counts[top] >= 0.4 * len(edge) else None


def main() -> int:
    if len(sys.argv) != 4:
        print('usage: flatart.py <in> <out.png> <options.json>', file=sys.stderr)
        return 2
    src, dst, opts_file = sys.argv[1:]
    with open(opts_file, encoding='utf-8') as f:
        o = json.load(f)
    bgr, alpha = read(src)
    if o.get('corners'):
        bgr, alpha = straighten(bgr, alpha, o['corners'])
    scale = MAX_SIDE / max(bgr.shape[:2])
    if scale < 1:
        bgr = cv2.resize(bgr, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        if alpha is not None:
            alpha = cv2.resize(alpha, (bgr.shape[1], bgr.shape[0]), interpolation=cv2.INTER_AREA)
    if o.get('light'):
        bgr = even_light(bgr)
    bgr = smooth(bgr, int(o.get('clean', 2)))

    h, w = bgr.shape[:2]
    lab = to_lab(bgr)
    opaque = (alpha.reshape(-1) >= 128) if alpha is not None else np.ones(h * w, bool)
    if not opaque.any():
        raise SystemExit('The picture is all clear: there is nothing to work on.')
    if o.get('palette'):
        centres = hex_to_lab(o['palette'])
        found = list(o['palette'])
    else:
        centres = find_colours(lab[opaque], int(o.get('colours', 0)))
        found = lab_to_hex(centres)
    labels = np.full(h * w, -1, np.int32)
    labels[opaque] = nearest(lab[opaque], centres)
    labels = tidy(labels.reshape(h, w), len(centres), int(o.get('specks', 2)))

    background = background_of(labels)
    if o.get('paint'):
        paint = [p if p else None for p in o['paint']]
    else:
        paint = list(found)
        if o.get('clear', True) and background is not None and len(found) > 1:
            paint[background] = None
    shares = np.bincount(labels[labels >= 0].reshape(-1), minlength=len(found)) / (h * w)

    out = np.zeros((h, w, 4), np.uint8)
    for c, p in enumerate(paint):
        if p:
            out[labels == c] = (int(p[4:6], 16), int(p[2:4], 16), int(p[0:2], 16), 255)
    write_png(dst, out)
    print(json.dumps({
        'width': w, 'height': h,
        'colours': [{'hex': found[c], 'paint': paint[c], 'share': round(float(shares[c]) * 100, 1), 'background': c == background} for c in range(len(found))],
    }))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except SystemExit as e:
        if isinstance(e.code, str):
            print(e.code, file=sys.stderr)
            sys.exit(1)
        raise
