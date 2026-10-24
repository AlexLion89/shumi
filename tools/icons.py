"""Иконки полки из site/icon.svg: PNG для iPhone, Android и вкладки браузера.

Рисует SVG в headless Edge в 1024x1024 и уменьшает Pillow. Для иконок приложения фон без скругления —
углы скругляет система; для favicon — скруглённый, с прозрачными углами.

    python tools/icons.py
"""
import pathlib
import subprocess
import tempfile

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BIG = 1024


def render(svg_text: str, tmp: pathlib.Path, name: str) -> Image.Image:
    (tmp / f"{name}.svg").write_text(svg_text, encoding="utf-8")
    page = tmp / f"{name}.html"
    page.write_text(f'<html><body style="margin:0;background:transparent">'
                    f'<img src="{name}.svg" style="display:block;width:{BIG}px;height:{BIG}px"></body></html>',
                    encoding="utf-8")
    shot = tmp / f"{name}.png"
    subprocess.run([EDGE, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    "--default-background-color=00000000", f"--user-data-dir={tmp / 'profile'}",
                    f"--window-size={BIG},{BIG}", f"--screenshot={shot}", page.as_uri()],
                   check=True, capture_output=True, timeout=120)
    img = Image.open(shot).convert("RGBA")
    if img.size != (BIG, BIG):
        raise SystemExit(f"Edge отдал {img.size}, ждали {BIG}x{BIG}")
    return img


def main() -> None:
    svg = (SITE / "icon.svg").read_text(encoding="utf-8")
    flat = svg.replace('rx="112" fill="#F7F2EA"', 'rx="0" fill="#F7F2EA"')
    if flat == svg:
        raise SystemExit("в icon.svg не нашёлся фон с rx=\"112\" — поправь замену в tools/icons.py")
    with tempfile.TemporaryDirectory() as t:
        tmp = pathlib.Path(t)
        square, rounded = render(flat, tmp, "square"), render(svg, tmp, "rounded")
        for name, img, size in [("apple-touch-icon.png", square, 180), ("icon-192.png", square, 192),
                                ("icon-512.png", square, 512), ("favicon-32.png", rounded, 32)]:
            out = img.resize((size, size), Image.LANCZOS)
            if name != "favicon-32.png":
                out = out.convert("RGB")
            out.save(SITE / name, optimize=True)
            print(f"{name}: {size}x{size}, {(SITE / name).stat().st_size} байт")


if __name__ == "__main__":
    main()
