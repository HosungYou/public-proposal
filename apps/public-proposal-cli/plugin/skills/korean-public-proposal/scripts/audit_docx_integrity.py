#!/usr/bin/env python3
"""Block Korean proposal DOCX files with broken figures or undeclared fonts."""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree as ET


NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "v": "urn:schemas-microsoft-com:vml",
}
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CAPTION_RE = re.compile(
    r"^\s*(?:그림|Figure)\s+[0-9IVXLCⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+(?:[-‐‑–—][0-9IVXLCⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+)?(?:[.)]|\s)",
    re.IGNORECASE,
)


def qname(namespace: str, local: str) -> str:
    return f"{{{namespace}}}{local}"


def parse_xml(payload: bytes) -> ET.Element:
    return ET.fromstring(payload)


def paragraph_text(paragraph: ET.Element) -> str:
    return "".join(node.text or "" for node in paragraph.findall(".//w:t", NS)).strip()


def font_inventory(archive: zipfile.ZipFile) -> dict[str, list[str]]:
    inventory: dict[str, set[str]] = {}
    for name in archive.namelist():
        if not name.startswith("word/") or not name.endswith(".xml"):
            continue
        try:
            root = parse_xml(archive.read(name))
        except ET.ParseError:
            continue
        values: set[str] = set()
        for node in root.findall(".//w:rFonts", NS):
            for attr in ("ascii", "hAnsi", "eastAsia", "cs"):
                value = node.get(qname(NS["w"], attr))
                if value:
                    values.add(value)
        if values:
            inventory[name] = values
    return {key: sorted(value) for key, value in sorted(inventory.items())}


def ledger_count(path: Path | None) -> int | None:
    if path is None:
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return len(data)
    if isinstance(data.get("figures"), list):
        return len(data["figures"])
    for key in ("figure_count", "expected_figure_count"):
        if key in data:
            return int(data[key])
    raise ValueError("figure ledger must be a list or contain figures/figure_count")


def audit(
    docx: Path,
    expected_min_figures: int,
    figure_ledger: Path | None,
    allowed_fonts: set[str],
    font_exceptions: set[str],
) -> dict:
    findings: list[dict] = []
    with zipfile.ZipFile(docx) as archive:
        document = parse_xml(archive.read("word/document.xml"))
        relationships = parse_xml(archive.read("word/_rels/document.xml.rels"))

        drawings = document.findall(".//w:drawing", NS)
        legacy_images = document.findall(".//v:imagedata", NS)
        drawing_count = len(drawings) + len(legacy_images)
        captions = [
            text
            for text in (paragraph_text(node) for node in document.findall(".//w:p", NS))
            if CAPTION_RE.match(text)
        ]

        referenced_ids = {
            node.get(qname(NS["r"], "embed"))
            for node in document.findall(".//a:blip", NS)
            if node.get(qname(NS["r"], "embed"))
        }
        referenced_ids.update(
            node.get(qname(NS["r"], "id"))
            for node in legacy_images
            if node.get(qname(NS["r"], "id"))
        )

        image_relationships: dict[str, str] = {}
        for node in relationships.findall(qname(REL_NS, "Relationship")):
            if (node.get("Type") or "").endswith("/image"):
                image_relationships[node.get("Id", "")] = node.get("Target", "")
        orphan_relationships = sorted(set(image_relationships) - referenced_ids)
        related_media = {PurePosixPath(target).name for target in image_relationships.values()}
        media_files = {
            PurePosixPath(name).name
            for name in archive.namelist()
            if name.startswith("word/media/") and not name.endswith("/")
        }
        orphan_media_files = sorted(media_files - related_media)

        zero_extents = []
        for index, node in enumerate(document.findall(".//wp:extent", NS), 1):
            cx = int(node.get("cx", "0"))
            cy = int(node.get("cy", "0"))
            if cx <= 0 or cy <= 0:
                zero_extents.append({"index": index, "cx": cx, "cy": cy})

        if drawing_count < expected_min_figures:
            findings.append({
                "rule": "minimum_figure_count",
                "expected_minimum": expected_min_figures,
                "actual": drawing_count,
                "severity": "blocker",
            })
        if len(captions) != drawing_count:
            findings.append({
                "rule": "caption_drawing_mismatch",
                "captions": len(captions),
                "drawings": drawing_count,
                "severity": "blocker",
            })
        expected_ledger_count = ledger_count(figure_ledger)
        if expected_ledger_count is not None and expected_ledger_count != drawing_count:
            findings.append({
                "rule": "ledger_drawing_mismatch",
                "ledger": expected_ledger_count,
                "drawings": drawing_count,
                "severity": "blocker",
            })
        if orphan_relationships:
            findings.append({
                "rule": "orphan_image_relationship",
                "relationship_ids": orphan_relationships,
                "severity": "blocker",
            })
        if orphan_media_files:
            findings.append({
                "rule": "orphan_media_file",
                "files": orphan_media_files,
                "severity": "blocker",
            })
        if zero_extents:
            findings.append({"rule": "zero_extent_drawing", "items": zero_extents, "severity": "blocker"})

        fonts_by_part = font_inventory(archive)
        observed_fonts = {font for fonts in fonts_by_part.values() for font in fonts}
        unexpected_fonts = sorted(observed_fonts - allowed_fonts - font_exceptions) if allowed_fonts else []
        if unexpected_fonts:
            findings.append({
                "rule": "unexpected_font",
                "fonts": unexpected_fonts,
                "allowed": sorted(allowed_fonts),
                "declared_exceptions": sorted(font_exceptions),
                "severity": "blocker",
            })

    return {
        "status": "BLOCKED" if findings else "PASS",
        "drawings": drawing_count,
        "captions": len(captions),
        "ledger_figures": expected_ledger_count,
        "image_relationships": len(image_relationships),
        "orphan_image_relationships": orphan_relationships,
        "orphan_media_files": orphan_media_files,
        "zero_extent_drawings": zero_extents,
        "fonts": sorted(observed_fonts),
        "fonts_by_part": fonts_by_part,
        "findings": findings,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("docx", type=Path)
    parser.add_argument("--expected-min-figures", type=int, default=0)
    parser.add_argument("--figure-ledger", type=Path)
    parser.add_argument("--allowed-font", action="append", default=[])
    parser.add_argument("--font-exception", action="append", default=[])
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    report = audit(
        args.docx,
        args.expected_min_figures,
        args.figure_ledger,
        set(args.allowed_font),
        set(args.font_exception),
    )
    payload = json.dumps(report, ensure_ascii=False, indent=2)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(payload, encoding="utf-8")
    print(payload)
    if report["status"] != "PASS":
        sys.exit(2)


if __name__ == "__main__":
    main()
