#!/usr/bin/env python3
"""Evaluate proposal package gates from simple JSON inputs."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path


def is_sha256(value: object) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-fA-F]{64}", value) is not None


def verify_surface_audit_receipt(package_path: Path, qa: dict) -> dict[str, object]:
    """Verify the byte-bound surface receipt instead of trusting QA booleans."""

    if qa.get("surface_audit_status") != "PASS":
        return {"status": "BLOCKED", "reason": "surface_audit_status_missing_or_failed"}
    raw_path = qa.get("surface_audit_receipt_path")
    expected_sha = qa.get("surface_audit_receipt_sha256")
    if not isinstance(raw_path, str) or not raw_path or Path(raw_path).is_absolute():
        return {"status": "BLOCKED", "reason": "surface_audit_receipt_path_missing_or_absolute"}
    if not is_sha256(expected_sha):
        return {"status": "BLOCKED", "reason": "surface_audit_receipt_sha256_missing"}
    receipt_path = (package_path.parent / raw_path).resolve()
    try:
        receipt_path.relative_to(package_path.parent.resolve())
    except ValueError:
        return {"status": "BLOCKED", "reason": "surface_audit_receipt_outside_package"}
    if not receipt_path.is_file():
        return {"status": "BLOCKED", "reason": "surface_audit_receipt_missing", "path": raw_path}
    payload = receipt_path.read_bytes()
    actual_sha = hashlib.sha256(payload).hexdigest()
    if actual_sha.lower() != expected_sha.lower():
        return {"status": "BLOCKED", "reason": "surface_audit_receipt_hash_mismatch", "path": raw_path}
    try:
        receipt = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {"status": "BLOCKED", "reason": "surface_audit_receipt_invalid_json", "path": raw_path}
    if (
        receipt.get("schemaVersion") != "kpp-surface-audit-1.0"
        or receipt.get("status") != "PASS"
        or receipt.get("findings") != []
        or not is_sha256(receipt.get("docxSha256"))
        or not is_sha256(receipt.get("renderManifestSha256"))
        or not isinstance(receipt.get("observations"), dict)
        or receipt.get("observations", {}).get("bound") is not True
    ):
        return {"status": "BLOCKED", "reason": "surface_audit_receipt_not_clean", "path": raw_path}
    return {"status": "PASS", "path": raw_path, "sha256": actual_sha}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("package", type=Path, help="JSON containing sources, claims, criteria, QA and approval records")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    data = json.loads(args.package.read_text(encoding="utf-8"))
    sources = data.get("sources", [])
    claims = data.get("claims", [])
    criteria = data.get("criteria", [])
    qa = data.get("qa", {})
    approvals = data.get("approvals", [])
    surface_audit = verify_surface_audit_receipt(args.package, qa)
    gates = {
        "G0_input_rights": bool(sources) and all(s.get("sha256") and s.get("rights_status") not in {None, "unknown", "denied"} for s in sources),
        "G1_rfp_interpretation": bool(criteria) and all(c.get("source_clause") and c.get("owner") and c.get("human_reviewed") for c in criteria),
        "G2_evidence_lock": bool(claims) and all(c.get("status") in {"verified", "bounded"} and c.get("evidence_ids") for c in claims if c.get("critical", True)),
        "G3_evaluation_coverage": bool(criteria) and all(c.get("proposal_section") and c.get("claim_ids") and c.get("status") == "covered" for c in criteria),
        "G4_style_safety": (
            data.get("slop_lint_status") == "PASS"
            and not data.get("copyright_risks")
            and qa.get("surface_token_status") == "PASS"
            and qa.get("font_allowlist_status") == "PASS"
        ),
        "G5_render_qa": (
            bool(qa.get("all_pages_inspected"))
            and not qa.get("defects")
            and qa.get("docx_pages") == qa.get("pdf_pages")
            and qa.get("docx_integrity_status") == "PASS"
            and qa.get("page_role_status") == "PASS"
            and qa.get("figure_ledger_count") == qa.get("visible_figure_count")
            and surface_audit["status"] == "PASS"
        ),
        "G6_human_approval": any(a.get("role") == "submission_owner" and a.get("approved") for a in approvals),
    }
    report = {
        "status": "PASS" if all(gates.values()) else "BLOCKED",
        "gates": gates,
        "surface_audit": surface_audit,
        "failed": [key for key, value in gates.items() if not value],
        "submission_allowed": all(gates.values()),
    }
    payload = json.dumps(report, ensure_ascii=False, indent=2)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(payload, encoding="utf-8")
    print(payload)


if __name__ == "__main__":
    main()
