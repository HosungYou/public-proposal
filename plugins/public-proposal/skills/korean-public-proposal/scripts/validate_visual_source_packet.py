#!/usr/bin/env python3
"""Validate Korean public-proposal visual references before Product Design/ImageGen."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


SOURCE_CLASSES = {"actual_submission", "official_template", "evaluation_result", "report_reference"}
RIGHTS = {"public_official", "open_license", "permission", "internal_reference"}
ALLOWED_PURPOSES = {"cover_composition", "chapter_opener", "evaluator_page", "placement_study", "topology_study"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("packet", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    data = json.loads(args.packet.read_text(encoding="utf-8"))
    findings: list[dict] = []
    refs = data.get("references", [])

    if len(refs) < 3:
        findings.append({"rule": "minimum_references", "expected": 3, "actual": len(refs), "severity": "blocker"})

    seen_classes: set[str] = set()
    has_issuer = False
    for index, ref in enumerate(refs, 1):
        source_class = ref.get("source_class")
        seen_classes.add(source_class or "")
        if source_class not in SOURCE_CLASSES:
            findings.append({"rule": "source_class", "reference": index, "actual": source_class, "severity": "blocker"})
        if ref.get("issuer_source") is True:
            has_issuer = True
        if ref.get("rights_status") not in RIGHTS:
            findings.append({"rule": "rights_status", "reference": index, "actual": ref.get("rights_status"), "severity": "blocker"})
        sha256 = ref.get("sha256", "")
        if not re.fullmatch(r"[0-9a-fA-F]{64}", sha256):
            findings.append({"rule": "invalid_sha256", "reference": index, "actual": sha256, "severity": "blocker"})
        if not ref.get("use_boundary"):
            findings.append({"rule": "missing_use_boundary", "reference": index, "severity": "blocker"})
        if ref.get("visual_inspected") is not True:
            findings.append({"rule": "not_visual_inspected", "reference": index, "severity": "blocker"})
        images = ref.get("rendered_images", [])
        if not images:
            findings.append({"rule": "missing_rendered_images", "reference": index, "severity": "blocker"})
        for image in images:
            if not Path(image).expanduser().is_file():
                findings.append({"rule": "missing_attached_image", "reference": index, "path": image, "severity": "blocker"})
        if source_class == "actual_submission" and ref.get("provenance_verified") is not True:
            findings.append({"rule": "unverified_actual_submission", "reference": index, "severity": "blocker"})

    if not has_issuer:
        findings.append({"rule": "missing_issuer_source", "severity": "blocker"})
    if "official_template" not in seen_classes:
        findings.append({"rule": "missing_official_template", "severity": "blocker"})
    if "report_reference" not in seen_classes:
        findings.append({"rule": "missing_report_reference", "severity": "blocker"})

    generation = data.get("generation", {})
    if generation.get("purpose") not in ALLOWED_PURPOSES:
        findings.append({"rule": "generation_purpose", "actual": generation.get("purpose"), "severity": "blocker"})
    if generation.get("final_evidence_bearing_asset") is not False:
        findings.append({"rule": "stochastic_final_asset", "severity": "blocker"})
    if generation.get("actual_images_attached") is not True:
        findings.append({"rule": "images_not_attached", "severity": "blocker"})
    if generation.get("deterministic_rebuild_required") is not True:
        findings.append({"rule": "missing_rebuild_gate", "severity": "blocker"})

    report = {
        "status": "BLOCKED" if any(item["severity"] == "blocker" for item in findings) else "PASS",
        "references": len(refs),
        "source_classes": sorted(seen_classes - {""}),
        "findings": findings,
    }
    payload = json.dumps(report, ensure_ascii=False, indent=2)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(payload + "\n", encoding="utf-8")
    print(payload)
    if report["status"] == "BLOCKED":
        sys.exit(1)


if __name__ == "__main__":
    main()
