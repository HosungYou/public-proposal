#!/usr/bin/env python3
"""Audit rendered PDF/page surfaces for clipping, overlap, and report quality.

The structural and byte-bound audits cannot tell whether a rendered page is
usable at print size.  This gate reads Poppler's rendered layout XML, checks
the actual page/image/text coordinates, and inspects deterministic SVG label
geometry.  It is deliberately independent of a producer-provided PASS field.

The output is still a technical visual gate.  ``humanReviewRequired`` remains
true until a reviewer opens every rendered page and records the evaluator task
and any legibility decision.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET


FLOAT_RE = re.compile(r"^-?\d+(?:\.\d+)?$")
SVG_NS = "http://www.w3.org/2000/svg"


@dataclass(frozen=True)
class Box:
    left: float
    top: float
    right: float
    bottom: float

    @property
    def width(self) -> float:
        return max(0.0, self.right - self.left)

    @property
    def height(self) -> float:
        return max(0.0, self.bottom - self.top)

    @property
    def area(self) -> float:
        return self.width * self.height


def finding(code: str, subject: str, **details: Any) -> dict[str, Any]:
    return {"code": code, "subject": subject, "severity": "blocker", **details}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def number(value: str | None, default: float = 0.0) -> float:
    if value is None or not FLOAT_RE.fullmatch(value.strip()):
        return default
    return float(value)


def box_from_xml(element: ET.Element) -> Box | None:
    left = number(element.get("left"), default=-1.0)
    top = number(element.get("top"), default=-1.0)
    width = number(element.get("width"), default=-1.0)
    height = number(element.get("height"), default=-1.0)
    if min(left, top, width, height) < 0:
        return None
    return Box(left, top, left + width, top + height)


def intersects(left: Box, right: Box, *, minimum_area: float = 1.0) -> bool:
    return overlap_area(left, right) > minimum_area


def overlap_area(left: Box, right: Box) -> float:
    overlap_width = max(0.0, min(left.right, right.right) - max(left.left, right.left))
    overlap_height = max(0.0, min(left.bottom, right.bottom) - max(left.top, right.top))
    return overlap_width * overlap_height


def read_png_size(path: Path) -> tuple[int, int] | None:
    try:
        payload = path.read_bytes()
    except OSError:
        return None
    if len(payload) < 24 or payload[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", payload[16:24])


def parse_pdf_layout(pdf: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    try:
        result = subprocess.run(
            ["pdftohtml", "-xml", "-hidden", "-nodrm", "-stdout", str(pdf)],
            check=False,
            capture_output=True,
            text=False,
        )
    except OSError as error:
        return [], [finding("KPP_VISUAL_TOOL_MISSING", "pdftohtml", reason=str(error))]
    if result.returncode != 0:
        return [], [finding("KPP_VISUAL_LAYOUT_EXTRACTION_FAILED", str(pdf), stderr=result.stderr.decode("utf-8", "replace"))]
    try:
        root = ET.fromstring(result.stdout)
    except ET.ParseError as error:
        return [], [finding("KPP_VISUAL_LAYOUT_INVALID", str(pdf), reason=str(error))]

    pages: list[dict[str, Any]] = []
    findings: list[dict[str, Any]] = []
    for page_element in root.findall("page"):
        page_number = int(number(page_element.get("number"), 0))
        page = {
            "page": page_number,
            "width": number(page_element.get("width")),
            "height": number(page_element.get("height")),
            "texts": [],
            "images": [],
        }
        for text_element in page_element.findall("text"):
            text = "".join(text_element.itertext()).strip()
            box = box_from_xml(text_element)
            if text and box is not None:
                page["texts"].append({"text": text, "box": box})
        for image_element in page_element.findall("image"):
            box = box_from_xml(image_element)
            if box is not None:
                page["images"].append({"src": image_element.get("src", ""), "box": box})
        pages.append(page)
    return pages, findings


def parse_font_size(svg_root: ET.Element, element: ET.Element) -> float:
    classes = set((element.get("class") or "").split())
    styles = svg_root.findall("{%s}style" % SVG_NS)
    style = "".join(styles[0].itertext()) if styles else ""
    sizes: dict[str, float] = {}
    for class_name, size in re.findall(r"\.([\w-]+)\{[^}]*font-size:([\d.]+)pt", style):
        sizes[class_name] = float(size)
    for class_name in classes:
        if class_name in sizes:
            return sizes[class_name]
    match = re.search(r"font-size:([\d.]+)pt", style)
    return float(match.group(1)) if match else 8.0


def estimate_svg_text_box(svg_root: ET.Element, element: ET.Element) -> Box | None:
    text = "".join(element.itertext()).strip()
    if not text:
        return None
    x = number(element.get("x"), 0.0)
    y = number(element.get("y"), 0.0)
    point_size = parse_font_size(svg_root, element)
    # Korean glyphs are close to one em; Latin and punctuation are narrower.
    estimated_width = sum(point_size * (0.95 if ord(char) > 0x3000 else 0.62) for char in text) * (4.0 / 3.0)
    anchor = element.get("text-anchor", "start")
    if anchor == "middle":
        left = x - estimated_width / 2
    elif anchor == "end":
        left = x - estimated_width
    else:
        left = x
    top = y - point_size * 1.05
    bottom = y + point_size * 0.25
    return Box(left, top, left + estimated_width, bottom)


def descendant_text_boxes(svg_root: ET.Element, group: ET.Element) -> list[Box]:
    boxes: list[Box] = []
    for element in group.findall(".//{%s}text" % SVG_NS):
        box = estimate_svg_text_box(svg_root, element)
        if box is not None:
            boxes.append(box)
    return boxes


def svg_rect_box(rect: ET.Element) -> Box | None:
    x = number(rect.get("x"), 0.0)
    y = number(rect.get("y"), 0.0)
    width = number(rect.get("width"), -1.0)
    height = number(rect.get("height"), -1.0)
    if width < 0 or height < 0:
        return None
    return Box(x, y, x + width, y + height)


def audit_svg_geometry(svg_dir: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    observations = {"svgTextCount": 0, "svgConnectorLabels": 0, "svgTextOverflow": 0, "svgHiddenLabels": 0}
    for svg_path in sorted(svg_dir.glob("*.svg")) if svg_dir.is_dir() else []:
        try:
            root = ET.fromstring(svg_path.read_bytes())
        except (OSError, ET.ParseError) as error:
            findings.append(finding("KPP_VISUAL_SVG_INVALID", str(svg_path), reason=str(error)))
            continue
        view_box = root.get("viewBox", "").split()
        if len(view_box) != 4:
            findings.append(finding("KPP_VISUAL_SVG_VIEWBOX_INVALID", svg_path.name))
            continue
        canvas = Box(number(view_box[0]), number(view_box[1]), number(view_box[0]) + number(view_box[2]), number(view_box[1]) + number(view_box[3]))
        node_boxes: list[Box] = []
        for group in root.findall(".//*[@data-kpp-role='framework-node']"):
            rect = group.find("{%s}rect" % SVG_NS)
            if rect is not None and (box := svg_rect_box(rect)) is not None:
                node_boxes.append(box)
        for element in root.findall(".//{%s}text" % SVG_NS):
            observations["svgTextCount"] += 1
            box = estimate_svg_text_box(root, element)
            if box is None:
                continue
            if box.left < canvas.left or box.right > canvas.right or box.top < canvas.top or box.bottom > canvas.bottom:
                observations["svgTextOverflow"] += 1
                findings.append(finding("KPP_VISUAL_FIGURE_TEXT_OVERFLOW", f"{svg_path.name}:text", text="".join(element.itertext()).strip(), box=box.__dict__, canvas=canvas.__dict__))
            if element.get("data-kpp-role") == "connector-label":
                observations["svgConnectorLabels"] += 1
                hidden_overlap = next((overlap_area(box, node_box) / box.area for node_box in node_boxes if box.area > 0 and overlap_area(box, node_box) / box.area > 0.10), None)
                if hidden_overlap is not None:
                    observations["svgHiddenLabels"] += 1
                    findings.append(finding("KPP_VISUAL_FIGURE_TEXT_HIDDEN_BY_NODE", f"{svg_path.name}:connector-label", text="".join(element.itertext()).strip(), box=box.__dict__, overlapRatio=round(hidden_overlap, 3)))
        for group in root.findall(".//*[@data-kpp-role='framework-node']"):
            texts = descendant_text_boxes(root, group)
            for left_index, left_box in enumerate(texts):
                for right_box in texts[left_index + 1 :]:
                    if intersects(left_box, right_box, minimum_area=2.0):
                        findings.append(finding("KPP_VISUAL_FIGURE_TEXT_COLLISION", f"{svg_path.name}:framework-node", boxes=[left_box.__dict__, right_box.__dict__]))
                        break
    return findings, observations


def audit_page_images(pages_dir: Path, page_count: int, page_width: float, page_height: float) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    page_paths = sorted(pages_dir.glob("page-*.png")) if pages_dir.is_dir() else []
    observations: dict[str, Any] = {"pageImageCount": len(page_paths), "pageImageSize": None}
    if len(page_paths) != page_count:
        findings.append(finding("KPP_VISUAL_PAGE_IMAGE_COUNT", str(pages_dir), expected=page_count, actual=len(page_paths)))
    expected_ratio = page_width / page_height if page_height else 0.0
    for path in page_paths:
        size = read_png_size(path)
        if size is None:
            findings.append(finding("KPP_VISUAL_PAGE_IMAGE_INVALID", str(path)))
            continue
        observations["pageImageSize"] = list(size)
        actual_ratio = size[0] / size[1] if size[1] else 0.0
        if expected_ratio and abs(actual_ratio - expected_ratio) / expected_ratio > 0.01:
            findings.append(finding("KPP_VISUAL_PAGE_IMAGE_CROPPED", path.name, expectedRatio=expected_ratio, actualRatio=actual_ratio, size=list(size)))
    return findings, observations


def audit_pdf_pages(pages: list[dict[str, Any]], contract: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    visual = contract.get("visual", {}) if isinstance(contract.get("visual"), dict) else {}
    margins = visual.get("safeMarginsPt", {}) if isinstance(visual.get("safeMarginsPt"), dict) else {}
    left_margin = float(margins.get("left", 72))
    right_margin = float(margins.get("right", 72))
    top_margin = float(margins.get("top", 36))
    bottom_margin = float(margins.get("bottom", 36))
    overlap_area = float(visual.get("textImageOverlapArea", 1.0))
    min_density = float(visual.get("minPageDensity", 0.03))
    max_density = float(visual.get("maxPageDensity", 0.82))
    findings: list[dict[str, Any]] = []
    observations: dict[str, Any] = {"pageCount": len(pages), "pageDensity": [], "textBlocks": 0, "imageBlocks": 0}
    required_text = visual.get("requiredText", []) if isinstance(visual.get("requiredText"), list) else []
    for page in pages:
        page_no = int(page["page"])
        width = float(page["width"])
        height = float(page["height"])
        safe = Box(left_margin, top_margin, width - right_margin, height - bottom_margin)
        text_blocks = page["texts"]
        image_blocks = page["images"]
        observations["textBlocks"] += len(text_blocks)
        observations["imageBlocks"] += len(image_blocks)
        occupied_area = 0.0
        for item in text_blocks + image_blocks:
            box = item["box"]
            occupied_area += min(box.area, width * height)
            if box.left < safe.left or box.right > safe.right or box.top < safe.top or box.bottom > safe.bottom:
                findings.append(finding("KPP_VISUAL_PAGE_BOUNDARY", f"page:{page_no}", kind="text" if item in text_blocks else "image", text=item.get("text"), box=box.__dict__, safe=safe.__dict__))
        for text_item in text_blocks:
            for image_item in image_blocks:
                if intersects(text_item["box"], image_item["box"], minimum_area=overlap_area):
                    findings.append(finding("KPP_VISUAL_TEXT_IMAGE_OVERLAP", f"page:{page_no}", text=text_item["text"], textBox=text_item["box"].__dict__, imageBox=image_item["box"].__dict__))
        density = min(1.0, occupied_area / (width * height)) if width and height else 0.0
        observations["pageDensity"].append({"page": page_no, "ratio": round(density, 4)})
        if density < min_density or density > max_density:
            findings.append(finding("KPP_FRONTIER_PAGE_DENSITY", f"page:{page_no}", ratio=round(density, 4), expected=[min_density, max_density]))
        page_text = " ".join(item["text"] for item in text_blocks)
        for requirement in required_text:
            if not isinstance(requirement, dict) or int(requirement.get("page", -1)) != page_no:
                continue
            expected = str(requirement.get("text", "")).strip()
            if expected and expected not in page_text:
                findings.append(finding("KPP_VISUAL_REQUIRED_TEXT_MISSING", f"page:{page_no}", text=expected))
    return findings, observations


def audit_frontier_architecture(architecture_path: Path | None, figure_manifest_path: Path | None, contract: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    observations: dict[str, Any] = {"surfaceTypes": [], "figureFamilies": []}
    frontier = contract.get("frontier", {}) if isinstance(contract.get("frontier"), dict) else {}
    if architecture_path is not None and architecture_path.exists():
        architecture = json.loads(architecture_path.read_text(encoding="utf-8"))
        pages = architecture.get("pages", []) if isinstance(architecture, dict) else []
        surface_types = [str(page.get("dominantSurface")) for page in pages if isinstance(page, dict)]
        observations["surfaceTypes"] = sorted(set(surface_types))
        max_same = int(frontier.get("maxConsecutiveSameSurface", 3))
        run = 0
        previous = None
        for index, surface in enumerate(surface_types, 1):
            run = run + 1 if surface == previous else 1
            previous = surface
            if run > max_same:
                findings.append(finding("KPP_FRONTIER_SURFACE_REPETITION", f"page:{index}", surface=surface, consecutive=run, maximum=max_same))
        for index, page in enumerate(pages, 1):
            if not isinstance(page, dict):
                continue
            if page.get("continuation") and float(page.get("titlePointSize", 0) or 0) > 12:
                findings.append(finding("KPP_FRONTIER_CONTINUATION_TITLE", f"page:{index}", pointSize=page.get("titlePointSize")))
    if figure_manifest_path is not None and figure_manifest_path.exists():
        payload = json.loads(figure_manifest_path.read_text(encoding="utf-8"))
        figures = payload.get("figures", []) if isinstance(payload, dict) else []
        families = [str(figure.get("renderer")) for figure in figures if isinstance(figure, dict)]
        observations["figureFamilies"] = sorted(set(families))
    required_families = {str(value) for value in frontier.get("requiredFigureFamilies", [])}
    missing_families = sorted(required_families - set(observations["figureFamilies"]))
    if missing_families:
        findings.append(finding("KPP_FRONTIER_FIGURE_DIVERSITY", "figureManifest", missing=missing_families))
    required_surfaces = {str(value) for value in frontier.get("requiredSurfaceTypes", [])}
    missing_surfaces = sorted(required_surfaces - set(observations["surfaceTypes"]))
    if missing_surfaces:
        findings.append(finding("KPP_FRONTIER_SURFACE_DIVERSITY", "pageArchitecture", missing=missing_surfaces))
    return findings, observations


def audit(args: argparse.Namespace) -> dict[str, Any]:
    contract = json.loads(args.contract.read_text(encoding="utf-8"))
    pages, layout_findings = parse_pdf_layout(args.pdf)
    page_findings, page_observations = audit_pdf_pages(pages, contract)
    image_findings, image_observations = audit_page_images(args.pages_dir, len(pages), pages[0]["width"] if pages else 0, pages[0]["height"] if pages else 0)
    svg_findings, svg_observations = audit_svg_geometry(args.svg_dir)
    architecture_findings, architecture_observations = audit_frontier_architecture(args.architecture, args.figure_manifest, contract)
    findings = layout_findings + page_findings + image_findings + svg_findings + architecture_findings
    return {
        "schemaVersion": "kpp-rendered-visual-audit-1.0",
        "status": "BLOCKED" if findings else "PASS",
        "humanReviewRequired": True,
        "pdfSha256": sha256(args.pdf),
        "observations": {**page_observations, **image_observations, **svg_observations, **architecture_observations},
        "findings": findings,
        "humanReviewChecklist": [
            {"page": page_no, "status": "required", "task": "문서 크기에서 텍스트·표·도식의 의미와 가독성을 직접 확인"}
            for page_no in range(1, len(pages) + 1)
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--pages-dir", type=Path, required=True)
    parser.add_argument("--svg-dir", type=Path, required=True)
    parser.add_argument("--contract", type=Path, required=True)
    parser.add_argument("--architecture", type=Path)
    parser.add_argument("--figure-manifest", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    report = audit(args)
    payload = json.dumps(report, ensure_ascii=False, indent=2)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(payload, encoding="utf-8")
    print(payload)
    if report["status"] != "PASS":
        sys.exit(2)


if __name__ == "__main__":
    main()
