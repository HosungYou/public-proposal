#!/usr/bin/env python3
"""Audit byte-bound table, SVG, and rendered-page surface contracts.

This gate intentionally inspects the produced bytes.  It does not accept a
producer-provided ``PASS`` field as proof that a table or figure looks right.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
SVG_NS = {"svg": "http://www.w3.org/2000/svg"}


def qname(namespace: str, local: str) -> str:
    return f"{{{namespace}}}{local}"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_fill(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().upper()
    if normalized in {"", "AUTO", "NONE", "TRANSPARENT"}:
        return None
    return f"#{normalized.lstrip('#')}"


def element_fill(element: ET.Element) -> str | None:
    fill = element.get("fill")
    if fill is not None:
        return normalize_fill(fill)
    style = element.get("style", "")
    for declaration in style.split(";"):
        key, separator, value = declaration.partition(":")
        if separator and key.strip().lower() == "fill":
            return normalize_fill(value)
    return None


def _int_attr(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(float(value.rstrip("px")))
    except ValueError:
        return None


def _artifact_key(path: Path, manifest_parent: Path) -> str:
    try:
        return str(path.relative_to(manifest_parent))
    except ValueError:
        return path.name


def _finding(code: str, subject: str, **details: object) -> dict[str, object]:
    return {"code": code, "subject": subject, "severity": "blocker", **details}


def _cell_fill(cell: ET.Element) -> str | None:
    shading = cell.find("./w:tcPr/w:shd", NS)
    return normalize_fill(shading.get(qname(NS["w"], "fill")) if shading is not None else None)


def _paragraph_value(paragraph: ET.Element, attribute: str) -> str | None:
    node = paragraph.find(f"./w:pPr/w:{attribute}", NS)
    return node.get(qname(NS["w"], "val")) if node is not None else None


def audit_tables(document_xml: bytes, contract: dict[str, object]) -> tuple[list[dict[str, object]], int]:
    root = ET.fromstring(document_xml)
    table_contract = contract.get("tables", {})
    if not isinstance(table_contract, dict):
        return [_finding("KPP_SURFACE_CONTRACT_INVALID", "tables", reason="tables must be an object")], 0

    findings: list[dict[str, object]] = []
    tables = root.findall(".//w:tbl", NS)
    expected_header = normalize_fill(str(table_contract.get("headerFill", "")))
    expected_body = normalize_fill(str(table_contract.get("bodyFill", "")))
    require_repeat = bool(table_contract.get("repeatHeader", True))
    header_alignment = str(table_contract.get("headerAlignment", "center"))
    body_alignment = str(table_contract.get("bodyAlignment", "left"))
    body_line = table_contract.get("bodyLine")
    allow_zebra = bool(table_contract.get("allowZebraStriping", False))

    for table_index, table in enumerate(tables, 1):
        rows = table.findall("./w:tr", NS)
        if not rows:
            findings.append(_finding("KPP_SURFACE_TABLE_EMPTY", f"table:{table_index}"))
            continue
        header_row = rows[0]
        has_repeat = header_row.find("./w:trPr/w:tblHeader", NS) is not None
        if require_repeat and not has_repeat:
            findings.append(_finding("KPP_SURFACE_TABLE_REPEAT_HEADER", f"table:{table_index}"))

        for cell_index, cell in enumerate(header_row.findall("./w:tc", NS), 1):
            subject = f"table:{table_index}:header:{cell_index}"
            actual = _cell_fill(cell)
            if expected_header is not None and actual != expected_header:
                findings.append(_finding("KPP_SURFACE_TABLE_HEADER_FILL", subject, expected=expected_header, actual=actual))
            for paragraph in cell.findall("./w:p", NS):
                actual_alignment = _paragraph_value(paragraph, "jc")
                if actual_alignment != header_alignment:
                    findings.append(_finding("KPP_SURFACE_TABLE_HEADER_ALIGNMENT", subject, expected=header_alignment, actual=actual_alignment))

        body_fills: set[str | None] = set()
        for row_index, row in enumerate(rows[1:], 1):
            for cell_index, cell in enumerate(row.findall("./w:tc", NS), 1):
                subject = f"table:{table_index}:body:{row_index}:{cell_index}"
                actual = _cell_fill(cell)
                body_fills.add(actual)
                if expected_body is not None and actual != expected_body:
                    findings.append(_finding("KPP_SURFACE_TABLE_BODY_FILL", subject, expected=expected_body, actual=actual))
                for paragraph in cell.findall("./w:p", NS):
                    actual_alignment = _paragraph_value(paragraph, "jc")
                    if actual_alignment != body_alignment:
                        findings.append(_finding("KPP_SURFACE_TABLE_BODY_ALIGNMENT", subject, expected=body_alignment, actual=actual_alignment))
                    if isinstance(body_line, dict):
                        spacing = paragraph.find("./w:pPr/w:spacing", NS)
                        actual_line = spacing.get(qname(NS["w"], "line")) if spacing is not None else None
                        actual_rule = spacing.get(qname(NS["w"], "lineRule")) if spacing is not None else None
                        if actual_line != body_line.get("line") or actual_rule != body_line.get("lineRule"):
                            findings.append(_finding(
                                "KPP_SURFACE_TABLE_LINE_SPACING",
                                subject,
                                expected=body_line,
                                actual={"line": actual_line, "lineRule": actual_rule},
                            ))
        if not allow_zebra and len(body_fills) > 1:
            findings.append(_finding("KPP_SURFACE_TABLE_ZEBRA_FILL", f"table:{table_index}", fills=sorted(value or "none" for value in body_fills)))
    return findings, len(tables)


def audit_svgs(svg_dir: Path, contract: dict[str, object]) -> tuple[list[dict[str, object]], list[Path]]:
    svg_contract = contract.get("svg", {})
    if not isinstance(svg_contract, dict):
        return [_finding("KPP_SURFACE_CONTRACT_INVALID", "svg", reason="svg must be an object")], []
    findings: list[dict[str, object]] = []
    svg_paths = sorted(svg_dir.glob("*.svg")) if svg_dir.is_dir() else []
    allow_canvas = bool(svg_contract.get("allowOuterCanvasFill", False))
    expected_body = normalize_fill(str(svg_contract.get("bodyFill", "")))
    row_roles = {str(value) for value in svg_contract.get("rowRoles", [])}
    allow_zebra = bool(svg_contract.get("allowZebraStriping", False))

    for path in svg_paths:
        try:
            root = ET.fromstring(path.read_bytes())
        except ET.ParseError as error:
            findings.append(_finding("KPP_SURFACE_SVG_INVALID", str(path), reason=str(error)))
            continue
        width = _int_attr(root.get("width"))
        height = _int_attr(root.get("height"))
        for rect_index, rect in enumerate(root.findall(".//svg:rect", SVG_NS), 1):
            rect_width = _int_attr(rect.get("width"))
            rect_height = _int_attr(rect.get("height"))
            x = _int_attr(rect.get("x")) or 0
            y = _int_attr(rect.get("y")) or 0
            fill = element_fill(rect)
            if not allow_canvas and width is not None and height is not None and x == 0 and y == 0 and rect_width == width and rect_height == height and fill is not None:
                findings.append(_finding("KPP_SURFACE_SVG_OUTER_CANVAS_FILL", f"{path.name}:rect:{rect_index}", fill=fill))

        for role_group in root.findall(".//*[@data-kpp-role]", {}):
            role = role_group.get("data-kpp-role")
            if role not in row_roles:
                continue
            rect = role_group.find(".//svg:rect", SVG_NS)
            fill = element_fill(rect) if rect is not None else None
            if expected_body is not None and fill != expected_body:
                findings.append(_finding("KPP_SURFACE_SVG_ROW_FILL", f"{path.name}:role:{role}", expected=expected_body, actual=fill))
            if not allow_zebra:
                sibling_rows = [group for group in root.findall(".//*[@data-kpp-role]", {}) if group.get("data-kpp-role") == role]
                fills = {element_fill(group.find(".//svg:rect", SVG_NS)) for group in sibling_rows}
                if len(fills) > 1:
                    findings.append(_finding("KPP_SURFACE_SVG_ZEBRA_FILL", f"{path.name}:role:{role}", fills=sorted(value or "none" for value in fills)))
                    break
    return findings, svg_paths


def audit_render_manifest(
    manifest_path: Path | None,
    docx: Path,
    svg_paths: list[Path],
    contract: dict[str, object],
    figure_manifest_dir: Path | None,
) -> tuple[list[dict[str, object]], dict[str, object], str | None]:
    render_contract = contract.get("render", {})
    if not isinstance(render_contract, dict):
        render_contract = {}
    findings: list[dict[str, object]] = []
    observation: dict[str, object] = {"pageCount": 0, "bound": False}
    if manifest_path is None or not manifest_path.exists():
        if bool(contract.get("requireRenderManifest", True)):
            findings.append(_finding("KPP_SURFACE_RENDER_MANIFEST_MISSING", str(manifest_path) if manifest_path else "<missing>"))
        return findings, observation, None
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        findings.append(_finding("KPP_SURFACE_RENDER_MANIFEST_INVALID", str(manifest_path), reason=str(error)))
        return findings, observation, sha256(manifest_path)

    expected_docx = manifest.get("docx", {})
    if not isinstance(expected_docx, dict) or "sha256" not in expected_docx:
        expected_docx = manifest.get("input", {}).get("docx", {}) if isinstance(manifest.get("input"), dict) else {}
    if not isinstance(expected_docx, dict) or expected_docx.get("sha256") != sha256(docx):
        findings.append(_finding("KPP_SURFACE_RENDER_HASH_MISMATCH", "docx", expected=expected_docx.get("sha256") if isinstance(expected_docx, dict) else None, actual=sha256(docx)))
    expected_figures = manifest.get("figures", [])
    expected_by_path = {str(entry.get("path")): entry.get("sha256") for entry in expected_figures if isinstance(entry, dict)}
    actual_by_path = {_artifact_key(path, manifest_path.parent): sha256(path) for path in svg_paths}
    if not expected_by_path and figure_manifest_dir is not None:
        for path in svg_paths:
            manifest_for_figure = figure_manifest_dir / f"{path.stem}.render.json"
            if not manifest_for_figure.exists():
                continue
            try:
                figure_payload = json.loads(manifest_for_figure.read_text(encoding="utf-8"))
                output = figure_payload.get("output", {})
                if isinstance(output, dict) and isinstance(output.get("sha256"), str):
                    expected_by_path[_artifact_key(path, manifest_path.parent)] = output["sha256"]
            except (OSError, json.JSONDecodeError):
                findings.append(_finding("KPP_SURFACE_RENDER_FIGURE_MANIFEST_INVALID", str(manifest_for_figure)))
    if not expected_by_path:
        findings.append(_finding("KPP_SURFACE_RENDER_FIGURE_MANIFEST_MISSING", "figures"))
    if set(expected_by_path) != set(actual_by_path):
        findings.append(_finding("KPP_SURFACE_RENDER_FIGURE_SET_MISMATCH", "figures", expected=sorted(expected_by_path), actual=sorted(actual_by_path)))
    for path, actual_hash in actual_by_path.items():
        if expected_by_path.get(path) != actual_hash:
            findings.append(_finding("KPP_SURFACE_RENDER_HASH_MISMATCH", path, expected=expected_by_path.get(path), actual=actual_hash))

    pages = manifest.get("pages")
    if not isinstance(pages, list) and isinstance(manifest.get("output"), dict):
        pages = manifest["output"].get("pages", [])
    if not isinstance(pages, list):
        pages = []
    required_pages = int(render_contract.get("requirePages", 0))
    observation["pageCount"] = len(pages)
    if required_pages and len(pages) != required_pages:
        findings.append(_finding("KPP_SURFACE_RENDER_PAGE_COUNT", "pages", expected=required_pages, actual=len(pages)))
    page_numbers: set[int] = set()
    for entry in pages:
        if not isinstance(entry, dict):
            findings.append(_finding("KPP_SURFACE_RENDER_PAGE_INVALID", "pages", entry=entry))
            continue
        page_no = int(entry.get("pageNo", entry.get("page", 0)))
        page_numbers.add(page_no)
        page_path = manifest_path.parent / str(entry.get("path", ""))
        if not page_path.exists():
            findings.append(_finding("KPP_SURFACE_RENDER_PAGE_MISSING", f"page:{page_no}", path=str(page_path)))
            continue
        actual_hash = sha256(page_path)
        if entry.get("sha256") != actual_hash:
            findings.append(_finding("KPP_SURFACE_RENDER_HASH_MISMATCH", f"page:{page_no}", expected=entry.get("sha256"), actual=actual_hash))
    if page_numbers and page_numbers != set(range(1, len(pages) + 1)):
        findings.append(_finding("KPP_SURFACE_RENDER_PAGE_SEQUENCE", "pages", actual=sorted(page_numbers)))
    observation["bound"] = not any(item["code"].startswith("KPP_SURFACE_RENDER_") for item in findings)
    return findings, observation, sha256(manifest_path)


def audit(
    docx: Path,
    contract_path: Path,
    svg_dir: Path,
    manifest_path: Path | None,
    figure_manifest_dir: Path | None,
) -> dict[str, object]:
    contract = json.loads(contract_path.read_text(encoding="utf-8"))
    with zipfile.ZipFile(docx) as archive:
        document_xml = archive.read("word/document.xml")
    table_findings, table_count = audit_tables(document_xml, contract)
    svg_findings, svg_paths = audit_svgs(svg_dir, contract)
    render_findings, render_observation, manifest_hash = audit_render_manifest(manifest_path, docx, svg_paths, contract, figure_manifest_dir)
    findings = table_findings + svg_findings + render_findings
    return {
        "schemaVersion": "kpp-surface-audit-1.0",
        "status": "BLOCKED" if findings else "PASS",
        "docxSha256": sha256(docx),
        "renderManifestSha256": manifest_hash,
        "observations": {
            "tableCount": table_count,
            "svgCount": len(svg_paths),
            **render_observation,
        },
        "findings": findings,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("docx", type=Path)
    parser.add_argument("--contract", type=Path, required=True)
    parser.add_argument("--svg-dir", type=Path, required=True)
    parser.add_argument("--render-manifest", type=Path)
    parser.add_argument("--figure-manifest-dir", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    report = audit(args.docx, args.contract, args.svg_dir, args.render_manifest, args.figure_manifest_dir)
    payload = json.dumps(report, ensure_ascii=False, indent=2)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(payload, encoding="utf-8")
    print(payload)
    if report["status"] != "PASS":
        sys.exit(2)


if __name__ == "__main__":
    main()
