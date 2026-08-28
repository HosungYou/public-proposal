#!/usr/bin/env python3
"""Audit HWPX-primary and DOCX-derivative surface parity from hash-bound renders."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def finding(code: str, subject: str, **details: object) -> dict[str, object]:
    return {"code": code, "subject": subject, **details}


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"JSON object required: {path}")
    return value


def verify_file(record: object, subject: str, findings: list[dict[str, object]]) -> Path | None:
    if not isinstance(record, dict):
        findings.append(finding("KPP_DERIVATIVE_MANIFEST_INVALID", subject))
        return None
    raw_path = record.get("path")
    expected = record.get("sha256")
    if not isinstance(raw_path, str) or not isinstance(expected, str):
        findings.append(finding("KPP_DERIVATIVE_MANIFEST_INVALID", subject))
        return None
    path = Path(raw_path).expanduser().resolve()
    if not path.is_file():
        findings.append(finding("KPP_DERIVATIVE_ARTIFACT_MISSING", subject, path=str(path)))
        return None
    actual = sha256_file(path)
    if actual != expected:
        findings.append(
            finding(
                "KPP_DERIVATIVE_HASH_MISMATCH",
                subject,
                path=str(path),
                expected=expected,
                actual=actual,
            )
        )
        return None
    return path


def rendered_pages(
    manifest: dict[str, Any],
    label: str,
    findings: list[dict[str, object]],
) -> tuple[str, list[tuple[int, Path]]]:
    render = manifest.get("render")
    if not isinstance(render, dict):
        findings.append(finding("KPP_DERIVATIVE_MANIFEST_INVALID", f"{label}:render"))
        return "invalid", []
    status = render.get("status")
    raw_pages = render.get("pages")
    if status not in {"available", "unavailable"} or not isinstance(raw_pages, list):
        findings.append(finding("KPP_DERIVATIVE_MANIFEST_INVALID", f"{label}:render"))
        return "invalid", []
    pages: list[tuple[int, Path]] = []
    for raw_page in raw_pages:
        if not isinstance(raw_page, dict) or not isinstance(raw_page.get("pageNumber"), int):
            findings.append(finding("KPP_DERIVATIVE_MANIFEST_INVALID", f"{label}:page"))
            continue
        path = verify_file(raw_page, f"{label}:page:{raw_page['pageNumber']}", findings)
        if path is not None:
            pages.append((raw_page["pageNumber"], path))
    return status, sorted(pages)


def pixel_difference_ratio(primary: Path, derivative: Path) -> float:
    with Image.open(primary) as primary_image, Image.open(derivative) as derivative_image:
        left = primary_image.convert("RGB")
        right = derivative_image.convert("RGB")
        if left.size != right.size:
            return 1.0
        difference = ImageChops.difference(left, right)
        total = sum(
            (value % 256) * count
            for value, count in enumerate(difference.histogram())
        )
        maximum = left.width * left.height * 3 * 255
        return total / maximum if maximum else 0.0


def audit(
    authority: dict[str, Any],
    primary: dict[str, Any],
    derivative: dict[str, Any],
) -> dict[str, object]:
    findings: list[dict[str, object]] = []
    authority_id = authority.get("authorityId")
    content_hash = primary.get("governedContentSha256")
    if (
        not isinstance(authority_id, str)
        or primary.get("designAuthorityId") != authority_id
        or derivative.get("designAuthorityId") != authority_id
    ):
        findings.append(finding("KPP_DERIVATIVE_AUTHORITY_MISMATCH", "designAuthorityId"))
    if (
        not isinstance(content_hash, str)
        or len(content_hash) != 64
        or derivative.get("governedContentSha256") != content_hash
    ):
        findings.append(finding("KPP_DERIVATIVE_CONTENT_MISMATCH", "governedContentSha256"))

    verify_file(primary.get("artifact"), "primary:artifact", findings)
    verify_file(derivative.get("artifact"), "derivative:artifact", findings)
    primary_status, primary_pages = rendered_pages(primary, "primary", findings)
    derivative_status, derivative_pages = rendered_pages(derivative, "derivative", findings)

    review_candidate = False
    if primary_status == "unavailable":
        review_candidate = True
        findings.append(finding("KPP_DERIVATIVE_PRIMARY_RENDER_UNAVAILABLE", "primary:render"))
    if derivative_status != "available":
        findings.append(finding("KPP_DERIVATIVE_DERIVATIVE_RENDER_UNAVAILABLE", "derivative:render"))

    if primary_status == "available" and derivative_status == "available":
        if [number for number, _ in primary_pages] != [number for number, _ in derivative_pages]:
            findings.append(
                finding(
                    "KPP_DERIVATIVE_PAGE_SET_MISMATCH",
                    "renderedPages",
                    primary=[number for number, _ in primary_pages],
                    derivative=[number for number, _ in derivative_pages],
                )
            )
        else:
            threshold = float(authority.get("maxPixelDifferenceRatio", 0.02))
            for (number, primary_path), (_, derivative_path) in zip(primary_pages, derivative_pages):
                ratio = pixel_difference_ratio(primary_path, derivative_path)
                if ratio > threshold:
                    findings.append(
                        finding(
                            "KPP_DERIVATIVE_PAGE_VISUAL_DRIFT",
                            f"page:{number}",
                            expectedMaximum=threshold,
                            actual=round(ratio, 6),
                        )
                    )

    required_furniture = set(authority.get("requiredFurniture", []))
    required_fonts = set(authority.get("requiredFonts", []))
    minimum_tables = int(authority.get("minimumTableCount", 0))
    minimum_figures = int(authority.get("minimumFigureCount", 0))
    for label, manifest in (("primary", primary), ("derivative", derivative)):
        surface = manifest.get("surface")
        if not isinstance(surface, dict):
            findings.append(finding("KPP_DERIVATIVE_SURFACE_MISSING", label))
            continue
        missing_furniture = sorted(required_furniture - set(surface.get("furniture", [])))
        missing_fonts = sorted(required_fonts - set(surface.get("fonts", [])))
        if missing_furniture:
            findings.append(finding("KPP_DERIVATIVE_FURNITURE_MISSING", label, missing=missing_furniture))
        if missing_fonts:
            findings.append(finding("KPP_DERIVATIVE_FONT_MISSING", label, missing=missing_fonts))
        if int(surface.get("tableCount", -1)) < minimum_tables:
            findings.append(finding("KPP_DERIVATIVE_TABLE_COUNT", label, expectedMinimum=minimum_tables, actual=surface.get("tableCount")))
        if int(surface.get("figureCount", -1)) < minimum_figures:
            findings.append(finding("KPP_DERIVATIVE_FIGURE_COUNT", label, expectedMinimum=minimum_figures, actual=surface.get("figureCount")))
        if (surface.get("pageWidthMm"), surface.get("pageHeightMm")) != (210, 297):
            findings.append(finding("KPP_DERIVATIVE_PAGE_GEOMETRY", label, actual={"widthMm": surface.get("pageWidthMm"), "heightMm": surface.get("pageHeightMm")}))

    blocker_findings = [
        item for item in findings
        if item["code"] != "KPP_DERIVATIVE_PRIMARY_RENDER_UNAVAILABLE"
    ]
    status = "BLOCKED" if blocker_findings else "REVIEW_CANDIDATE" if review_candidate else "PASS"
    return {
        "schemaVersion": "kpp-derivative-parity-1.0",
        "status": status,
        "humanReviewRequired": True,
        "observations": {
            "authorityId": authority_id,
            "governedContentSha256": content_hash,
            "pageCount": len(primary_pages) if primary_status == "available" else 0,
        },
        "findings": findings,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("authority")
    parser.add_argument("primary")
    parser.add_argument("derivative")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    output = Path(args.out).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        report = audit(
            load_json(Path(args.authority).expanduser().resolve()),
            load_json(Path(args.primary).expanduser().resolve()),
            load_json(Path(args.derivative).expanduser().resolve()),
        )
    except Exception as error:
        report = {
            "schemaVersion": "kpp-derivative-parity-1.0",
            "status": "BLOCKED",
            "humanReviewRequired": True,
            "observations": {},
            "findings": [finding("KPP_DERIVATIVE_AUDIT_ERROR", "audit", error=str(error))],
        }
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    if report["status"] == "PASS":
        return 0
    if report["status"] == "REVIEW_CANDIDATE":
        return 3
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
