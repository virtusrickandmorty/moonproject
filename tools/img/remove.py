"""
Removes a picture's background (IMG image tools): `python remove.py <in> <out.png> <object|design>`.

object: BiRefNet, best for products, garments and people (on the processor: it fails on DirectML on the shop's card).
design: U2-Net, keeps a whole design with its text (on the graphics card through DirectML, else the processor).
Both models are free for business use (MIT and Apache-2.0); they live in models/ beside this file.
"""
import os
import sys

here = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault('U2NET_HOME', os.path.join(here, 'models'))

from PIL import Image  # noqa: E402
from rembg import new_session, remove  # noqa: E402

MODELS = {
    'object': ('birefnet-general', ['CPUExecutionProvider']),
    'design': ('u2net', ['DmlExecutionProvider', 'CPUExecutionProvider']),
}


def main() -> int:
    if len(sys.argv) != 4 or sys.argv[3] not in MODELS:
        print('usage: remove.py <in> <out.png> <object|design>', file=sys.stderr)
        return 2
    src, dst, kind = sys.argv[1:]
    name, providers = MODELS[kind]
    picture = Image.open(src)
    picture.load()
    out = remove(picture.convert('RGBA'), session=new_session(name, providers=providers))
    out.save(dst, 'PNG')
    return 0


if __name__ == '__main__':
    sys.exit(main())
