"""Compose final ESP image: main render + labelled colorbar + caption.

Inputs: water-esp.tga (Tachyon 24-bit TGA), mol-preview.tga
Output: water-esp.png (>=1800 px wide), mol-preview.png
"""
import sys
from PIL import Image, ImageDraw, ImageFont

def load_font(size):
    for name in ["segoeui.ttf", "arial.ttf"]:
        try:
            return ImageFont.truetype(f"C:/Windows/Fonts/{name}", size)
        except Exception:
            pass
    return ImageFont.load_default()

def rwb_gradient(height, width):
    """Vertical gradient: top=+max (blue), middle=0 (white), bottom=-max (red)."""
    img = Image.new("RGB", (width, height))
    d = ImageDraw.Draw(img)
    half = height // 2
    for y in range(height):
        t = abs(y - half) / half  # 0 at middle, 1 at ends
        t = t ** 1.0
        if y < half:   # upper half: white -> blue (positive)
            r = int(255 * (1 - t))
            g = int(255 * (1 - t))
            b = int(255 * (1 - t) + 255 * t)
        else:          # lower half: white -> red (negative)
            r = int(255 * (1 - t) + 255 * t)
            g = int(255 * (1 - t))
            b = int(255 * (1 - t))
        d.line([(0, y), (width, y)], fill=(r, g, b))
    return img

def main():
    main_tga, mol_tga = sys.argv[1], sys.argv[2]
    rend = Image.open(main_tga).convert("RGB")
    mol = Image.open(mol_tga).convert("RGB")
    W, H = rend.size
    print("main render size:", rend.size)

    # ---- colorbar panel ----
    CB_W, CB_H, PAD = 340, 1100, 60
    bar_w, bar_h = 90, CB_H - 220
    bar = rwb_gradient(bar_h, bar_w)
    panel = Image.new("RGB", (CB_W, CB_H), "white")
    panel.paste(bar, (40, 50))
    d = ImageDraw.Draw(panel)
    f_big = load_font(34)
    f_mid = load_font(28)
    f_small = load_font(24)

    vmax = 0.07  # a.u., symmetric range (must match mol scaleminmax)
    ticks = [(0.0, f"+{vmax:.2f}"), (0.25, f"+{vmax/2:.3f}"), (0.5, "0.000"),
             (0.75, f"-{vmax/2:.3f}"), (1.0, f"-{vmax:.2f}")]
    for frac, label in ticks:
        y = 50 + int(frac * (bar_h - 1))
        d.line([(40 + bar_w, y), (40 + bar_w + 10, y)], fill="black", width=3)
        d.text((40 + bar_w + 18, y - 17), label, fill="black", font=f_mid)
    d.text((40, 50 + bar_h + 12), "ESP (a.u.)", fill="black", font=f_big)
    d.text((40, 50 + bar_h + 58), "red = negative", fill=(200, 30, 30), font=f_small)
    d.text((40, 50 + bar_h + 92), "blue = positive", fill=(30, 30, 200), font=f_small)

    # ---- final canvas ----
    total_w = W + CB_W
    cap_h = 90
    canvas = Image.new("RGB", (total_w, H + cap_h), "white")
    canvas.paste(rend, (0, 0))
    y0 = (H - CB_H) // 2
    canvas.paste(panel, (W, y0))
    d = ImageDraw.Draw(canvas)
    caption = ("H2O electrostatic potential on the electron density isosurface "
               "rho = 0.001 e/bohr^3 (0.20 bohr surface grid spacing)")
    caption2 = ("Gas phase, B3LYP/def2TZVP, genuine wavefunction ESP (Multiwfn) "
                "- color range +/-0.07 a.u. (+/-43.93 kcal/mol), white = 0")
    d.text((30, H + 14), caption, fill="black", font=f_mid)
    d.text((30, H + 52), caption2, fill="black", font=f_small)
    canvas.save("water-esp.png")
    print("water-esp.png:", canvas.size)

    mol.save("mol-preview.png")
    print("mol-preview.png:", mol.size)

if __name__ == "__main__":
    main()
