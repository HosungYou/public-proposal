from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_dir", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    pages = sorted(args.input_dir.glob("page-*.png"))
    if not pages:
        raise SystemExit("no page PNGs found")
    thumb_width = 620
    margin = 32
    label_height = 42
    opened = [Image.open(path).convert("RGB") for path in pages]
    thumbs = []
    for page in opened:
        height = round(page.height * thumb_width / page.width)
        thumbs.append(page.resize((thumb_width, height), Image.Resampling.LANCZOS))
    cell_height = max(image.height for image in thumbs) + label_height
    columns = 2
    rows = (len(thumbs) + columns - 1) // columns
    sheet = Image.new("RGB", (margin + columns * (thumb_width + margin), margin + rows * (cell_height + margin)), "#E8EDF2")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=24)
    for index, image in enumerate(thumbs):
        column = index % columns
        row = index // columns
        x = margin + column * (thumb_width + margin)
        y = margin + row * (cell_height + margin)
        sheet.paste(image, (x, y + label_height))
        draw.text((x, y + 6), f"PAGE {index + 1:02d}", fill="#17324D", font=font)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.output, format="PNG", optimize=True)


if __name__ == "__main__":
    main()
