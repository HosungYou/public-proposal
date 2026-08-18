#!/usr/bin/env python3
"""Evaluate proposal package gates from simple JSON inputs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


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
        ),
        "G6_human_approval": any(a.get("role") == "submission_owner" and a.get("approved") for a in approvals),
    }
    report = {
        "status": "PASS" if all(gates.values()) else "BLOCKED",
        "gates": gates,
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
