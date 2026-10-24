"""Иконки полки из art/raccoon.png (енот с книгой, 1254x1254, фон #F7EEE0).

Иконки приложения — весь кадр: енот занимает около 70% по центру, углы iOS и Android скругляют сами.
Значок вкладки — кадр плотнее (32 px иначе мелко) и со скруглёнными прозрачными углами.

    python tools/icons.py
"""
import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
SOURCE = ROOT / "art" / "raccoon.png"
# Рамка содержимого исходника — (212, 166)–(1040, 1134); квадрат вокруг неё с запасом около 4%.
FAVICON_CROP = (92, 116, 1160, 1184)


def rounded(img: Image.Image, radius_share: float) -> Image.Image:
    big = img.convert("RGBA")
    mask = Image.new("L", big.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *big.size), radius=int(big.size[0] * radius_share), fill=255)
    big.putalpha(mask)
    return big


def main() -> None:
    src = Image.open(SOURCE).convert("RGB")
    if src.size[0] != src.size[1]:
        raise SystemExit(f"исходник не квадратный: {src.size}")
    out = {
        "apple-touch-icon.png": src.resize((180, 180), Image.LANCZOS),
        "icon-192.png": src.resize((192, 192), Image.LANCZOS),
        "icon-512.png": src.resize((512, 512), Image.LANCZOS),
        # Скругляем в большом размере и уменьшаем — края получаются гладкими.
        "favicon-32.png": rounded(src.crop(FAVICON_CROP), 0.22).resize((32, 32), Image.LANCZOS),
    }
    for name, img in out.items():
        img.save(SITE / name, optimize=True)
        print(f"{name}: {img.size[0]}x{img.size[1]}, {(SITE / name).stat().st_size} байт")


if __name__ == "__main__":
    main()
