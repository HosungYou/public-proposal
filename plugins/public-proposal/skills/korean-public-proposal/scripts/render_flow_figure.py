#!/usr/bin/env python3
"""Render a deterministic public-proposal flow figure from locked JSON."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, Rectangle


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    data = json.loads(args.input.read_text(encoding="utf-8"))
    nodes = data["nodes"]
    width = max(9.0, 2.15 * len(nodes))
    plt.rcParams.update({"font.family": "sans-serif", "font.sans-serif": ["Noto Sans CJK KR", "Apple SD Gothic Neo", "DejaVu Sans"]})
    fig, ax = plt.subplots(figsize=(width, 3.2), dpi=240)
    ax.set_xlim(0, width)
    ax.set_ylim(0, 3.2)
    ax.axis("off")

    gap = width / len(nodes)
    positions = []
    for i, node in enumerate(nodes):
        x = i * gap + 0.18
        w = gap - 0.42
        positions.append((x, w))
        ax.add_patch(Rectangle((x, 1.18), w, 1.08, facecolor="#F3F5F6", edgecolor="#17324D", lw=1.15))
        ax.text(x + 0.10, 2.07, node["title"], fontsize=9.4, weight="bold", color="#17324D", va="top")
        ax.text(x + 0.10, 1.76, node["detail"], fontsize=7.7, color="#161B22", va="top", linespacing=1.3)
        if node.get("evidence"):
            ax.text(x + 0.10, 1.29, node["evidence"], fontsize=6.9, color="#4D555D", va="bottom")
    for i in range(len(positions) - 1):
        x, w = positions[i]
        nx, _ = positions[i + 1]
        ax.add_patch(FancyArrowPatch((x + w + 0.04, 1.72), (nx - 0.04, 1.72), arrowstyle="-|>", mutation_scale=10, lw=0.95, color="#17324D"))

    ax.text(0.18, 3.0, data["title"], fontsize=11.5, weight="bold", color="#161B22", va="top")
    ax.text(0.18, 2.73, data["subtitle"], fontsize=8.0, color="#4D555D", va="top")
    ax.text(0.18, 0.52, data["source"], fontsize=7.2, color="#4D555D", va="top")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(args.output, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print(args.output)


if __name__ == "__main__":
    main()
