"""Deterministic direct OOXML geometry audit for governed KPP DOCX files."""

from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any
from xml.etree import ElementTree


W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
PR = "{http://schemas.openxmlformats.org/package/2006/relationships}"


def audit_docx_geometry(
    path: str | Path,
    *,
    expected_profile_sha256: str,
) -> dict[str, Any]:
    """Inspect the ZIP/XML package and return findings instead of raising."""

    docx = Path(path).expanduser().resolve()
    findings: list[dict[str, Any]] = []
    facts = {"bodyParagraphs": 0, "nativeTables": 0, "drawings": 0, "captions": 0}
    embedded_media: list[dict[str, str]] = []
    page_observations: list[dict[str, Any]] = []
    try:
        docx_hash = _sha256_file(docx)
    except OSError as error:
        return _report(
            docx,
            None,
            expected_profile_sha256,
            facts,
            [_finding("KPP_DOCX_PACKAGE_INVALID", "DOCX 파일을 읽을 수 없습니다.", str(error))],
            embedded_media,
            page_observations,
        )

    try:
        with zipfile.ZipFile(docx) as archive:
            document = _xml_member(archive, "word/document.xml")
            styles = _xml_member(archive, "word/styles.xml")
            relationships = _relationships(archive)
            names = set(archive.namelist())
            _audit_styles(styles, findings)
            _audit_paragraphs(document, findings, facts)
            _audit_tables(document, findings, facts)
            _audit_drawings(document, relationships, names, archive, findings, facts, embedded_media)
            page_observations = _observe_pages(document, styles, docx_hash)
    except (zipfile.BadZipFile, KeyError, ElementTree.ParseError, ValueError) as error:
        findings.append(
            _finding("KPP_DOCX_PACKAGE_INVALID", "DOCX ZIP/XML 패키지가 올바르지 않습니다.", str(error))
        )

    return _report(
        docx,
        docx_hash,
        expected_profile_sha256,
        facts,
        findings,
        embedded_media,
        page_observations,
    )


def _observe_pages(
    document: ElementTree.Element,
    styles: ElementTree.Element,
    source_sha256: str,
) -> list[dict[str, Any]]:
    style_sizes = _style_point_sizes(styles)
    body = document.find(f"./{W}body")
    if body is None:
        return []
    raw_pages: list[list[ElementTree.Element]] = [[]]
    for child in list(body):
        if child.tag == f"{W}sectPr":
            continue
        if child.tag == f"{W}p" and child.find(f".//{W}br[@{W}type='page']") is not None:
            if raw_pages[-1]:
                raw_pages.append([])
            continue
        raw_pages[-1].append(child)
    pages = [page for page in raw_pages if page]
    width_point, height_point = _page_size_points(body)
    observations: list[dict[str, Any]] = []
    for index, elements in enumerate(pages):
        headings: list[float] = []
        titles: list[dict[str, object]] = []
        signature: list[str] = []
        text_blocks = 0
        table_count = 0
        figure_count = 0
        for element_index, element in enumerate(elements):
            if element.tag == f"{W}tbl":
                table_count += 1
                signature.append(f"table:{len(element.findall(f'.//{W}tr'))}")
                continue
            if element.tag != f"{W}p":
                continue
            text = "".join(node.text or "" for node in element.findall(f".//{W}t"))
            style = _attribute(element.find(f"./{W}pPr/{W}pStyle"), W, "val") or "none"
            drawings = len(element.findall(f".//{W}drawing"))
            figure_count += drawings
            if text.strip():
                text_blocks += 1
            signature.append(f"{style}:{len(text.strip())}:{drawings}")
            if style == "KPPHeading1":
                point_size = _paragraph_heading_point_size(element, style_sizes.get(style, 0.0))
                if point_size > 0:
                    headings.append(point_size)
                    region = "top" if element_index < max(2, len(elements) // 3) else "body"
                    titles.append(
                        {
                            "textFingerprint": hashlib.sha256(text.strip().encode("utf-8")).hexdigest(),
                            "pointSize": point_size,
                            "region": region,
                        }
                    )
        observations.append(
            {
                "pageNumber": index + 1,
                "pageLocator": f"page:{index + 1:04d}",
                "sourceArtifactSha256": source_sha256,
                "measuredHeadingPointSizes": headings,
                "titleBlocks": titles,
                "surfaceFamily": _observed_surface_family(table_count, figure_count),
                "regionFingerprints": [
                    hashlib.sha256("\0".join(signature).encode("utf-8")).hexdigest()
                ],
                "geometry": {
                    "widthPoint": width_point,
                    "heightPoint": height_point,
                    "textBlockCount": text_blocks,
                    "tableCount": table_count,
                    "figureCount": figure_count,
                },
                "continuationMarkers": {
                    "fromPrevious": index > 0,
                    "toNext": index < len(pages) - 1,
                },
            }
        )
    return observations


def _style_point_sizes(styles: ElementTree.Element) -> dict[str, float]:
    sizes: dict[str, float] = {}
    for style in styles.findall(f"./{W}style"):
        style_id = _attribute(style, W, "styleId")
        raw_size = _attribute(style.find(f"./{W}rPr/{W}sz"), W, "val")
        if style_id and raw_size:
            try:
                sizes[style_id] = int(raw_size) / 2
            except ValueError:
                continue
    return sizes


def _paragraph_heading_point_size(
    paragraph: ElementTree.Element,
    fallback: float,
) -> float:
    sizes: list[float] = []
    for run in paragraph.findall(f"./{W}r"):
        raw_size = _attribute(run.find(f"./{W}rPr/{W}sz"), W, "val")
        if raw_size is None:
            continue
        try:
            sizes.append(int(raw_size) / 2)
        except ValueError:
            continue
    return max(sizes, default=fallback)


def _page_size_points(body: ElementTree.Element) -> tuple[float, float]:
    page_size = body.find(f"./{W}sectPr/{W}pgSz")
    try:
        width = int(_attribute(page_size, W, "w") or "11906") / 20
        height = int(_attribute(page_size, W, "h") or "16838") / 20
    except ValueError:
        width, height = 595.3, 841.9
    return round(width, 1), round(height, 1)


def _observed_surface_family(table_count: int, figure_count: int) -> str:
    if table_count and figure_count:
        return "mixed"
    if table_count:
        return "table"
    if figure_count:
        return "figure"
    return "narrative"


def _audit_styles(styles: ElementTree.Element, findings: list[dict[str, Any]]) -> None:
    expected = {
        "KPPBody": ("Noto Serif CJK KR", "19", "-4"),
        "KPPHeading1": ("Noto Sans CJK KR", "32", None),
        "KPPNavigation": ("Noto Sans CJK KR", "18", None),
        "KPPCaption": ("Noto Sans CJK KR", "18", None),
        "KPPTableHeader": ("Noto Sans CJK KR", "18", None),
        "KPPTableBody": ("Noto Serif CJK KR", "18", "-4"),
    }
    by_id = {
        _attribute(style, W, "styleId"): style
        for style in styles.findall(f"./{W}style")
    }
    for style_id, (font, size, character_spacing) in expected.items():
        style = by_id.get(style_id)
        properties = None if style is None else style.find(f"./{W}rPr")
        fonts = None if properties is None else properties.find(f"./{W}rFonts")
        valid = (
            properties is not None
            and all(_attribute(fonts, W, slot) == font for slot in ("ascii", "hAnsi", "eastAsia", "cs"))
            and _attribute(properties.find(f"./{W}sz"), W, "val") == size
            and _attribute(properties.find(f"./{W}szCs"), W, "val") == size
            and (
                character_spacing is None
                or _attribute(properties.find(f"./{W}spacing"), W, "val") == character_spacing
            )
        )
        if not valid:
            findings.append(
                _finding(
                    "KPP_DOCX_TYPOGRAPHY",
                    f"{style_id} style font/size/tracking이 잠금 규격과 다릅니다.",
                )
            )


def _audit_paragraphs(
    document: ElementTree.Element,
    findings: list[dict[str, Any]],
    facts: dict[str, int],
) -> None:
    for paragraph in document.findall(f".//{W}p"):
        style = paragraph.find(f"./{W}pPr/{W}pStyle")
        style_id = _attribute(style, W, "val")
        if style_id == "KPPBody":
            facts["bodyParagraphs"] += 1
            justification = paragraph.find(f"./{W}pPr/{W}jc")
            spacing = paragraph.find(f"./{W}pPr/{W}spacing")
            runs = paragraph.findall(f"./{W}r")
            valid_paragraph = (
                _attribute(justification, W, "val") == "both"
                and _attribute(spacing, W, "line") == "365"
                and _attribute(spacing, W, "lineRule") == "auto"
                and bool(runs)
                and all(_valid_body_run(run) for run in runs)
            )
            if not valid_paragraph:
                findings.append(
                    _finding(
                        "KPP_DOCX_TYPOGRAPHY",
                        "본문 글꼴·크기·자간·행간·양쪽 맞춤이 잠금 규격과 다릅니다.",
                    )
                )
        if style_id == "KPPCaption":
            facts["captions"] += 1
    if facts["bodyParagraphs"] == 0:
        findings.append(_finding("KPP_DOCX_TYPOGRAPHY", "KPP Body 본문 문단이 없습니다."))


def _valid_body_run(run: ElementTree.Element) -> bool:
    properties = run.find(f"./{W}rPr")
    if properties is None:
        return False
    fonts = properties.find(f"./{W}rFonts")
    expected_font = "Noto Serif CJK KR"
    font_slots = ("ascii", "hAnsi", "eastAsia", "cs")
    return (
        all(_attribute(fonts, W, slot) == expected_font for slot in font_slots)
        and _attribute(properties.find(f"./{W}sz"), W, "val") == "19"
        and _attribute(properties.find(f"./{W}szCs"), W, "val") == "19"
        and _attribute(properties.find(f"./{W}spacing"), W, "val") == "-4"
    )


def _audit_tables(
    document: ElementTree.Element,
    findings: list[dict[str, Any]],
    facts: dict[str, int],
) -> None:
    tables = document.findall(f".//{W}tbl")
    for table in tables:
        properties = table.find(f"./{W}tblPr")
        grid = table.find(f"./{W}tblGrid")
        fixed = properties is not None and _attribute(
            properties.find(f"./{W}tblLayout"), W, "type"
        ) == "fixed"
        margins = properties.find(f"./{W}tblCellMar") if properties is not None else None
        borders = properties.find(f"./{W}tblBorders") if properties is not None else None
        cells = table.findall(f".//{W}tc")
        valid = (
            fixed
            and grid is not None
            and bool(grid.findall(f"./{W}gridCol"))
            and margins is not None
            and all(margins.find(f"./{W}{side}") is not None for side in ("top", "start", "bottom", "end"))
            and borders is not None
            and bool(borders.findall("./*"))
            and bool(cells)
            and all(cell.find(f"./{W}tcPr/{W}tcW") is not None for cell in cells)
        )
        if valid:
            facts["nativeTables"] += 1
        else:
            findings.append(
                _finding(
                    "KPP_DOCX_TABLE_GEOMETRY",
                    "표에 고정 TableGrid·tcW·tcMar·border 규격이 없습니다.",
                )
            )
    if not tables:
        findings.append(_finding("KPP_DOCX_TABLE_GEOMETRY", "검사할 Word-native 표가 없습니다."))


def _audit_drawings(
    document: ElementTree.Element,
    relationships: dict[str, str],
    names: set[str],
    archive: zipfile.ZipFile,
    findings: list[dict[str, Any]],
    facts: dict[str, int],
    embedded_media: list[dict[str, str]],
) -> None:
    drawings = document.findall(f".//{W}drawing")
    facts["drawings"] = len(drawings)
    for drawing in drawings:
        blip = drawing.find(f".//{A}blip")
        relationship_id = None if blip is None else blip.attrib.get(f"{R}embed")
        target = relationships.get(relationship_id or "")
        member = None if target is None else str(PurePosixPath("word") / target)
        if member is None or member not in names:
            findings.append(
                _finding(
                    "KPP_DOCX_DRAWING_RELATIONSHIP",
                    "그림 relationship가 실제 embedded media와 연결되지 않습니다.",
                    relationship_id,
                )
            )
        else:
            embedded_media.append(
                {
                    "relationshipId": relationship_id or "",
                    "member": member,
                    "sha256": hashlib.sha256(archive.read(member)).hexdigest(),
                }
            )
    if facts["captions"] < facts["drawings"]:
        findings.append(
            _finding(
                "KPP_DOCX_FIGURE_CAPTION",
                "그림 수보다 KPP Caption 문단 수가 적습니다.",
            )
        )


def _relationships(archive: zipfile.ZipFile) -> dict[str, str]:
    root = _xml_member(archive, "word/_rels/document.xml.rels")
    return {
        element.attrib["Id"]: element.attrib["Target"]
        for element in root.findall(f"./{PR}Relationship")
        if "Id" in element.attrib and "Target" in element.attrib
    }


def _xml_member(archive: zipfile.ZipFile, name: str) -> ElementTree.Element:
    return ElementTree.fromstring(archive.read(name))


def _attribute(element: ElementTree.Element | None, namespace: str, name: str) -> str | None:
    return None if element is None else element.attrib.get(f"{namespace}{name}")


def _finding(code: str, message: str, actual: object | None = None) -> dict[str, Any]:
    finding: dict[str, Any] = {"code": code, "message": message}
    if actual is not None:
        finding["actual"] = actual
    return finding


def _report(
    path: Path,
    docx_hash: str | None,
    profile_hash: str,
    facts: dict[str, int],
    findings: list[dict[str, Any]],
    embedded_media: list[dict[str, str]],
    page_observations: list[dict[str, Any]],
) -> dict[str, Any]:
    ordered = sorted(findings, key=lambda item: (item["code"], item["message"]))
    return {
        "schemaVersion": "1",
        "status": "PASS" if not ordered else "BLOCKED",
        "docx": {
            "path": str(path),
            "sha256": docx_hash,
            "bytes": path.stat().st_size if path.is_file() else None,
        },
        "expectedProfileSha256": profile_hash,
        "facts": facts,
        "embeddedMedia": embedded_media,
        "pageObservations": page_observations,
        "findings": ordered,
    }


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit KPP DOCX OOXML geometry")
    parser.add_argument("docx")
    parser.add_argument("--profile-sha256", required=True)
    parser.add_argument("--output")
    args = parser.parse_args()
    report = audit_docx_geometry(args.docx, expected_profile_sha256=args.profile_sha256)
    encoded = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    if args.output:
        Path(args.output).write_text(encoded, encoding="utf-8")
    else:
        print(encoded, end="")


if __name__ == "__main__":
    main()
