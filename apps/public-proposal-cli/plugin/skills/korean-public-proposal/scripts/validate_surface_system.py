#!/usr/bin/env python3
"""Validate Korean public-proposal surface tokens against the canonical contract."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


EXPECTED = {
    "schema_version": "kpp-surface-tokens-1.0",
    "page.size_mm": [210, 297],
    "page.content_inset_mm": {"top": 14, "right": 18, "bottom": 14, "left": 18},
    "typography.heading.family": "Noto Sans CJK KR",
    "typography.body.family": "Noto Serif CJK KR",
    "typography.title.tracking_em": -0.045,
    "paragraphs.body.line_height": 1.52,
    "tables.body_pt": 7.9,
    "charts.value_axis_zero_baseline": True,
    "boxes.corner_radius_mm": 0,
    "boxes.shadow": "none",
}

REQUIRED_PAGE_ROLES = {
    "chapter_opener",
    "analysis_evidence",
    "literature_baseline",
    "research_method",
    "candidate_decision",
    "roadmap_management",
    "evaluation_crosswalk",
    "evidence_ledger",
}


def resolve(data: dict[str, Any], dotted: str) -> Any:
    value: Any = data
    for part in dotted.split("."):
        if not isinstance(value, dict) or part not in value:
            raise KeyError(dotted)
        value = value[part]
    return value


def validate(data: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    for path, expected in EXPECTED.items():
        try:
            actual = resolve(data, path)
        except KeyError:
            errors.append(f"missing required token: {path}")
            continue
        if actual != expected:
            errors.append(f"{path}: expected {expected!r}, got {actual!r}")

    roles = data.get("page_roles", [])
    role_ids = {item.get("id") for item in roles if isinstance(item, dict)}
    if role_ids != REQUIRED_PAGE_ROLES:
        errors.append(
            "page_roles: expected exactly "
            + ", ".join(sorted(REQUIRED_PAGE_ROLES))
            + "; got "
            + ", ".join(sorted(str(item) for item in role_ids))
        )

    if data.get("proposal_evidence") is not False:
        errors.append("proposal_evidence must be false for a reusable composition system")
    if data.get("tables", {}).get("allow_zebra_striping") is not False:
        errors.append("tables.allow_zebra_striping must be false")
    if data.get("charts", {}).get("color_only_encoding") is not False:
        errors.append("charts.color_only_encoding must be false")
    if data.get("figures", {}).get("decorative_icons") is not False:
        errors.append("figures.decorative_icons must be false")
    return errors


def validate_fonts(data: dict[str, Any]) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    messages: list[str] = []
    fc_match = shutil.which("fc-match")
    if not fc_match:
        return ["font check unavailable: fc-match not found"], messages

    families = {
        data.get("typography", {}).get("heading", {}).get("family"),
        data.get("typography", {}).get("body", {}).get("family"),
    }
    for family in sorted(item for item in families if item):
        result = subprocess.run(
            [fc_match, "-f", "%{family}\n", family],
            check=False,
            capture_output=True,
            text=True,
        )
        resolved = result.stdout.splitlines()[0].strip() if result.stdout else ""
        if result.returncode != 0 or family.lower() not in resolved.lower():
            errors.append(f"font unavailable or substituted: requested {family!r}, resolved {resolved!r}")
        else:
            messages.append(f"font available: {family}")
    return errors, messages


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("tokens", type=Path)
    parser.add_argument("--check-fonts", action="store_true")
    args = parser.parse_args()
    try:
        data = json.loads(args.tokens.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"surface-token read error: {exc}", file=sys.stderr)
        return 2

    errors = validate(data)
    messages: list[str] = []
    if args.check_fonts:
        font_errors, font_messages = validate_fonts(data)
        errors.extend(font_errors)
        messages.extend(font_messages)
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    print(f"surface tokens valid: {args.tokens}")
    for message in messages:
        print(message)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
