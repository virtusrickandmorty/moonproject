"""
Vectorize (IMG image tools): `python vectorize.py <in> <out folder> <options.json>`; prints what it made as JSON.

Traces a picture into vector shapes with VTracer (MIT): design.svg and design.pdf at the size it will print, and for a
colour design separations.pdf, one page per ink in black with registration marks (screen-printing films).
Each colour is traced on its own: in the SVG and PDF a colour's shape includes the colours drawn over it (stacked, so
no hairline gaps show between neighbours); on the films each ink is exactly its own area.

Options (all optional):
  style    "colour" (the default); "full": full colour for sublimation, more colours, no films;
           or "cutter": one colour, black outlines for a vinyl or heat-transfer cutter
  colours  0 (the default): the picture's own colours when it has few (a flat-art result), else as many as there look
           to be; or 2-12 (full colour: 16, 32 (the default) or 64)
  specks   0-3: keep everything, or drop small, medium or large specks
  edges    "smooth" (the default) or "sharp": keep corners sharp (text, numbers)
  width    the printed width in centimetres (default 25)
  invert   true: cutter style traces the light parts instead of the dark
  mirror   true: everything flipped left to right (heat-transfer vinyl is cut mirrored)
"""
import json
import os
import re
import sys
import zlib

import cv2
import numpy as np
import vtracer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flatart import find_colours, lab_to_hex, nearest, read, tidy, to_lab  # noqa: E402

MAX_SIDE = 4000
FULL_SIDE = 2400  # full colour traces at least this size (a smaller picture is enlarged)
MAX_PATHS = 4000  # more shapes than this is a photo, not a design: say so
PT_PER_CM = 72 / 2.54
MARGIN_CM = 2.0  # around the design on a film page, for the registration marks and the label


def trace(mask: np.ndarray, specks: int, edges: str) -> list[str]:
    """One mask (True: ink) to path data in the picture's pixels, holes included."""
    pad = 2  # shapes touching the edge are traced whole
    img = np.full((mask.shape[0] + 2 * pad, mask.shape[1] + 2 * pad), 255, np.uint8)
    img[pad:-pad, pad:-pad][mask] = 0
    ok, png = cv2.imencode('.png', img)
    svg = vtracer.convert_raw_image_to_svg(
        png.tobytes(), img_format='png', colormode='binary', mode='spline',
        filter_speckle=[1, 4, 10, 24][specks], corner_threshold=60 if edges == 'smooth' else 30,
        length_threshold=4.0, splice_threshold=45, path_precision=3)
    out = []
    for d, tx, ty in re.findall(r'<path d="([^"]+)"[^>]*?transform="translate\(([-\d.]+),([-\d.]+)\)"', svg):
        out.append(shift(d, float(tx) - pad, float(ty) - pad))
    return out


NUM = re.compile(r'[MLCZ]|-?\d*\.?\d+(?:e-?\d+)?')


def shift(d: str, dx: float, dy: float) -> str:
    """Moves absolute path data (VTracer writes M, L, C and Z) by dx, dy."""
    out, xy = [], 0
    for tok in NUM.findall(d):
        if tok in 'MLCZ':
            out.append(tok)
            xy = 0
        else:
            out.append(f'{float(tok) + (dx if xy % 2 == 0 else dy):.2f}'.rstrip('0').rstrip('.'))
            xy += 1
    return ' '.join(out)


def pdf_path(d: str) -> str:
    """SVG path data (M, L, C, Z, absolute) as PDF path operators."""
    ops, cmd, nums = [], None, []
    def flush():
        if cmd == 'M':
            for i in range(0, len(nums), 2):
                ops.append(f'{nums[i]} {nums[i + 1]} {"m" if i == 0 else "l"}')
        elif cmd == 'L':
            for i in range(0, len(nums), 2):
                ops.append(f'{nums[i]} {nums[i + 1]} l')
        elif cmd == 'C':
            for i in range(0, len(nums), 6):
                ops.append(' '.join(nums[i:i + 6]) + ' c')
        elif cmd == 'Z':
            ops.append('h')
    for tok in NUM.findall(d):
        if tok in 'MLCZ':
            flush()
            cmd, nums = tok, []
        else:
            nums.append(tok)
    flush()
    return '\n'.join(ops)


def write_pdf(path: str, pages: list[tuple[float, float, str]]) -> None:
    """A plain PDF: each page (width pt, height pt, content stream), Helvetica for labels."""
    objs: list[bytes] = []
    def add(b: bytes) -> int:
        objs.append(b)
        return len(objs)
    font = add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
    pages_id = len(objs) + 1 + 2 * len(pages) + 1  # after the page objects and the catalog: fixed below
    kids = []
    for w, h, content in pages:
        data = zlib.compress(content.encode('latin-1'))
        stream = add(b'<< /Length %d /Filter /FlateDecode >>\nstream\n' % len(data) + data + b'\nendstream')
        kids.append(add(b'<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %.2f %.2f] /Contents %d 0 R /Resources << /Font << /F1 %d 0 R >> >> >>'
                        % (pages_id, w, h, stream, font)))
    catalog = add(b'<< /Type /Catalog /Pages %d 0 R >>' % pages_id)
    assert add(b'<< /Type /Pages /Kids [%s] /Count %d >>' % (b' '.join(b'%d 0 R' % k for k in kids), len(kids))) == pages_id
    out = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    offsets = []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += b'%d 0 obj\n' % i + body + b'\nendobj\n'
    xref = len(out)
    out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1) + b''.join(b'%010d 00000 n \n' % o for o in offsets)
    out += b'trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objs) + 1, catalog, xref)
    with open(path, 'wb') as f:
        f.write(out)


def rgb(hex_: str) -> str:
    return ' '.join(f'{int(hex_[i:i + 2], 16) / 255:.3f}' for i in (0, 2, 4))


def main() -> int:
    if len(sys.argv) != 4:
        print('usage: vectorize.py <in> <out folder> <options.json>', file=sys.stderr)
        return 2
    src, out_dir, opts_file = sys.argv[1:]
    with open(opts_file, encoding='utf-8') as f:
        o = json.load(f)
    style = o.get('style', 'colour')
    specks, edges = int(o.get('specks', 1)), o.get('edges', 'smooth')
    width_cm = min(300.0, max(1.0, float(o.get('width', 25))))
    mirror = bool(o.get('mirror'))

    bgr, alpha = read(src)
    scale = MAX_SIDE / max(bgr.shape[:2])
    if scale < 1:
        bgr = cv2.resize(bgr, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        if alpha is not None:
            alpha = cv2.resize(alpha, (bgr.shape[1], bgr.shape[0]), interpolation=cv2.INTER_AREA)
    if style == 'full' and max(bgr.shape[:2]) < FULL_SIDE:
        # A small picture is enlarged smoothly first: its colour edges then trace into curves, not stair-steps.
        up = min(3.0, FULL_SIDE / max(bgr.shape[:2]))
        bgr = cv2.resize(bgr, None, fx=up, fy=up, interpolation=cv2.INTER_CUBIC)
        if alpha is not None:
            alpha = cv2.resize(alpha, (bgr.shape[1], bgr.shape[0]), interpolation=cv2.INTER_LINEAR)
    h, w = bgr.shape[:2]
    opaque = alpha >= 128 if alpha is not None else np.ones((h, w), bool)
    warnings = []

    if style == 'cutter':
        if alpha is not None and not o.get('invert'):
            ink = opaque  # a picture with a clear background: what is not clear is cut
        else:
            grey = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
            _, dark = cv2.threshold(grey, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
            ink = (dark > 0) & opaque
            if o.get('invert'):
                ink = ~ink & opaque
        inks = [('000000', ink)]
        stacked = [ink]
    else:
        # The picture's own colours when it has a few (a flat-art result); else found as in flat art.
        packed = (bgr[:, :, 2].astype(np.int32) << 16) | (bgr[:, :, 1].astype(np.int32) << 8) | bgr[:, :, 0]
        own, inverse = np.unique(packed[opaque], return_inverse=True)
        k = int(o.get('colours', 0)) or (32 if style == 'full' else 0)
        labels = np.full((h, w), -1, np.int32)
        if k == 0 and len(own) <= 16:
            labels[opaque] = inverse
            hexes = ['%06x' % int(c) for c in own]
        else:
            lab = to_lab(bgr)[opaque.reshape(-1)]
            centres = find_colours(lab, k)
            labels[opaque] = nearest(lab, centres)
            labels = tidy(labels, len(centres), 1)
            hexes = lab_to_hex(centres)
        order = sorted(range(len(hexes)), key=lambda c: -int((labels == c).sum()))
        order = [c for c in order if (labels == c).any()]
        inks = [(hexes[c], labels == c) for c in order]
        # Drawn largest first; each shape covers what is drawn over it too, so neighbours meet without a gap.
        stacked = []
        if style == 'colour':
            for i in range(len(order)):
                stacked.append(np.isin(labels, order[i:]))

    if style == 'full':
        # Many colours: VTracer's own colour tracing (stacked, smaller files, no seams) on the palette picture; a
        # cluster's colour comes back averaged, so each shape is set back to the palette colour nearest it.
        palette = np.array([[int(x[4:6], 16), int(x[2:4], 16), int(x[0:2], 16)] for x in hexes], np.uint8)
        flat = np.zeros((h, w, 4), np.uint8)
        flat[labels >= 0, :3] = palette[labels[labels >= 0]]
        flat[labels >= 0, 3] = 255
        ok, png = cv2.imencode('.png', flat)
        raw = vtracer.convert_raw_image_to_svg(
            png.tobytes(), img_format='png', colormode='color', hierarchical='stacked', mode='spline',
            filter_speckle=[1, 4, 10, 24][specks], color_precision=8, layer_difference=1,
            corner_threshold=60 if edges == 'smooth' else 30, length_threshold=4.0, splice_threshold=45, path_precision=1)
        rgb_palette = palette[:, ::-1].astype(np.int32)
        layers = []
        for d, fill, tx, ty in re.findall(r'<path d="([^"]+)" fill="#([0-9A-Fa-f]{6})" transform="translate\(([-\d.]+),([-\d.]+)\)"', raw):
            c = np.array([int(fill[i:i + 2], 16) for i in (0, 2, 4)])
            hex_ = hexes[int(np.argmin(((rgb_palette - c) ** 2).sum(axis=1)))]
            if layers and layers[-1][0] == hex_:
                layers[-1][1].append(shift(d, float(tx), float(ty)))
            else:
                layers.append((hex_, [shift(d, float(tx), float(ty))]))
        if opaque.all() and inks:
            # Under everything, the main colour across the whole picture: no hairline of paper shows between shapes.
            layers.insert(0, (inks[0][0], [f'M0 0 L{w} 0 L{w} {h} L0 {h} Z']))
    else:
        layers = [(hex_, trace(m, specks, edges)) for (hex_, _), m in zip(inks, stacked)]
    paths = sum(len(p) for _, p in layers)
    if style == 'full' and paths > 60_000:
        warnings.append(f'{paths} shapes: a heavy file. Try fewer colours or remove larger specks if your design program is slow with it.')
    elif style != 'full' and paths > MAX_PATHS:
        warnings.append(f'This picture traced into {paths} shapes: it looks like a photo. Vectors suit logos, text and flat designs; try Photo to flat art first.')
    height_cm = width_cm * h / w

    flip = f' transform="translate({w},0) scale(-1,1)"' if mirror else ''
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width_cm:.2f}cm" height="{height_cm:.2f}cm" viewBox="0 0 {w} {h}">', f'<g{flip}>']
    for i, (hex_, ps) in enumerate(layers, 1):
        svg.append(f'<g id="ink-{i}-{hex_}" fill="#{hex_}">' + ''.join(f'<path d="{d}"/>' for d in ps) + '</g>')
    svg.append('</g></svg>')
    with open(os.path.join(out_dir, 'design.svg'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(svg))

    s = width_cm * PT_PER_CM / w  # points per pixel
    def placed(ox: float, oy: float) -> str:
        return f'{-s if mirror else s:.5f} 0 0 {-s:.5f} {ox + (s * w if mirror else 0):.3f} {oy + s * h:.3f} cm'
    body = '\n'.join(f'q {placed(0, 0)} {rgb(hex_)} rg\n' + '\n'.join(pdf_path(d) for d in ps) + '\nf Q' for hex_, ps in layers if ps)
    write_pdf(os.path.join(out_dir, 'design.pdf'), [(s * w, s * h, body)])

    files = ['design.svg', 'design.pdf']
    if style == 'colour' and len(inks) > 1:
        m = MARGIN_CM * PT_PER_CM
        W, H = s * w + 2 * m, s * h + 2 * m
        def mark(x: float, y: float) -> str:
            r = 0.35 * PT_PER_CM
            k = 0.5523 * r
            circle = f'{x + r} {y} m {x + r} {y + k} {x + k} {y + r} {x} {y + r} c {x - k} {y + r} {x - r} {y + k} {x - r} {y} c {x - r} {y - k} {x - k} {y - r} {x} {y - r} c {x + k} {y - r} {x + r} {y - k} {x + r} {y} c S'
            return f'{x - 1.6 * r} {y} m {x + 1.6 * r} {y} l {x} {y - 1.6 * r} m {x} {y + 1.6 * r} l S {circle}'
        marks = '0 0 0 RG 0.5 w ' + ' '.join(mark(x, y) for x, y in [(W / 2, m / 2), (W / 2, H - m / 2), (m / 2, H / 2), (W - m / 2, H / 2)])
        pages = []
        for i, (hex_, mask) in enumerate(inks, 1):
            shapes = trace(mask, specks, edges)
            label = f'Ink {i} of {len(inks)}  #{hex_.upper()}  {width_cm:.1f} x {height_cm:.1f} cm{"  MIRRORED" if mirror else ""}'
            pages.append((W, H, f'q {placed(m, m)} 0 0 0 rg\n' + '\n'.join(pdf_path(d) for d in shapes) + f'\nf Q\n{marks}\nBT /F1 8 Tf {m} {m / 2 - 3} Td ({label}) Tj ET'))
        write_pdf(os.path.join(out_dir, 'separations.pdf'), pages)
        files.append('separations.pdf')

    print(json.dumps({
        'width': w, 'height': h, 'widthCm': round(width_cm, 2), 'heightCm': round(height_cm, 2),
        'colours': [{'hex': hex_, 'share': round(float(m.sum()) / (h * w) * 100, 1)} for hex_, m in inks],
        'shapes': paths, 'files': files, 'warnings': warnings,
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
