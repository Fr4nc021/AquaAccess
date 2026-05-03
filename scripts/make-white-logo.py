"""Gera logo-white.png a partir de logo.jpeg: texto em branco, A/traço dourado #A08844, fundo transparente."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "renderer" / "public" / "logo.jpeg"
OUT = ROOT / "renderer" / "public" / "logo-white.png"

# Dourado solicitado para o A (e o traço decorativo, mesma cor no JPEG original).
ACCENT = (0xA0, 0x88, 0x44)
WHITE = (255, 255, 255)
# No JPEG, cinza ≈ baixa croma; dourado ≈ croma ≥ ~20 (sem sobreposição relevante).
CHROMA_ACCENT_MIN = 20


def lum(r: int, g: int, b: int) -> float:
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def chroma(r: int, g: int, b: int) -> int:
    return max(r, g, b) - min(r, g, b)


def main() -> None:
    im = Image.open(SRC).convert("RGBA")
    px = im.load()
    w, h = im.size
    hi = 252
    lo = 235
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            L = lum(r, g, b)
            if L >= hi:
                a = 0
            elif L <= lo:
                a = 255
            else:
                a = int(255 * (hi - L) / (hi - lo))
            if a == 0:
                cr, cg, cb = 255, 255, 255
            elif chroma(r, g, b) >= CHROMA_ACCENT_MIN:
                cr, cg, cb = ACCENT
            else:
                cr, cg, cb = WHITE
            px[x, y] = (cr, cg, cb, a)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    im.save(OUT, "PNG")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
