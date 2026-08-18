#!/usr/bin/env python3
"""Manage reusable public-proposal patterns and immutable project rounds."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "1.0"
ROUND_RE = re.compile(r"^R\d{2}_[A-Za-z][A-Za-z0-9]*$")
PATTERN_SCOPES = {"issuer", "contract_type", "universal", "project_only"}
ROLE_RE = re.compile(r"^[a-z][a-z0-9_-]*$")
REQUIRED_PATTERN_FIELDS = {
    "pattern_id",
    "title",
    "scope",
    "source_refs",
    "applicability",
    "variables",
    "validation",
    "confidentiality",
}


class ProposalSystemError(Exception):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def read_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ProposalSystemError(f"missing file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ProposalSystemError(f"invalid JSON: {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ProposalSystemError(f"JSON root must be an object: {path}")
    return data


def write_json(path: Path, data: Any, *, overwrite: bool = True) -> None:
    if path.exists() and not overwrite:
        raise ProposalSystemError(f"immutable artifact already exists: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def init_round(root: Path, round_id: str, parent: str | None, requirements: dict[str, Any]) -> Path:
    if not ROUND_RE.fullmatch(round_id):
        raise ProposalSystemError(f"invalid round id: {round_id}")
    round_dir = root / "packages" / round_id
    if round_dir.exists():
        raise ProposalSystemError(f"round is immutable and already exists: {round_id}")
    for name in ("input", "candidates", "promoted", "qa"):
        (round_dir / name).mkdir(parents=True, exist_ok=True)
    write_json(round_dir / "requirements.json", requirements, overwrite=False)
    write_json(
        round_dir / "manifest.json",
        {
            "schema_version": SCHEMA_VERSION,
            "round_id": round_id,
            "parent_round": parent,
            "created_at": now_iso(),
            "promotion_status": "draft",
            "inherited_requirements": [
                item.get("id")
                for item in requirements.get("requirements", [])
                if isinstance(item, dict) and item.get("id")
            ],
            "delta": [],
            "new_failures": [],
        },
        overwrite=False,
    )
    return round_dir


def command_init_library(args: argparse.Namespace) -> None:
    root = Path(args.root).expanduser().resolve()
    for relative in (
        "patterns/candidates",
        "patterns/accepted",
        "patterns/deprecated",
        "profiles/issuers",
        "profiles/contract-types",
        "schemas",
    ):
        (root / relative).mkdir(parents=True, exist_ok=True)
    catalog = root / "catalog.json"
    if not catalog.exists():
        write_json(
            catalog,
            {
                "schema_version": SCHEMA_VERSION,
                "created_at": now_iso(),
                "patterns": [],
            },
            overwrite=False,
        )
    schema_path = root / "schemas" / "pattern.schema.json"
    if not schema_path.exists():
        write_json(
            schema_path,
            {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "title": "Korean public proposal reusable pattern",
                "type": "object",
                "required": sorted(REQUIRED_PATTERN_FIELDS),
                "properties": {
                    "pattern_id": {"type": "string", "minLength": 1},
                    "title": {"type": "string", "minLength": 1},
                    "scope": {"enum": sorted(PATTERN_SCOPES)},
                    "issuer": {"type": "string"},
                    "contract_type": {"type": "string"},
                    "source_refs": {"type": "array", "minItems": 1, "items": {"type": "string"}},
                    "applicability": {"type": "array", "minItems": 1, "items": {"type": "string"}},
                    "variables": {"type": "array", "items": {"type": "string"}},
                    "validation": {
                        "type": "object",
                        "minProperties": 1,
                        "additionalProperties": {"type": "boolean"},
                    },
                    "confidentiality": {"type": "string", "minLength": 1},
                },
                "additionalProperties": True,
            },
            overwrite=False,
        )
    print(json.dumps({"library": str(root), "status": "ready"}, ensure_ascii=False))


def source_manifest(source_dir: Path, destination: Path) -> dict[str, Any]:
    if not source_dir.is_dir():
        raise ProposalSystemError(f"source directory does not exist: {source_dir}")
    files: list[dict[str, Any]] = []
    snapshot = destination / "input" / "sources"
    snapshot.mkdir(parents=True, exist_ok=True)
    for source in sorted(path for path in source_dir.rglob("*") if path.is_file()):
        relative = source.relative_to(source_dir)
        target = snapshot / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        files.append(
            {
                "name": str(relative),
                "bytes": source.stat().st_size,
                "sha256": sha256(source),
                "original_path": str(source.resolve()),
                "snapshot_path": str(target.relative_to(destination)),
            }
        )
    return {"captured_at": now_iso(), "files": files}


def command_init_project(args: argparse.Namespace) -> None:
    root = Path(args.root).expanduser().resolve()
    library = Path(args.library).expanduser().resolve()
    if not (library / "catalog.json").is_file():
        raise ProposalSystemError("initialize the shared library first")
    project_file = root / "project.json"
    if project_file.exists():
        raise ProposalSystemError(f"project already initialized: {root}")
    root.mkdir(parents=True, exist_ok=True)
    write_json(
        project_file,
        {
            "schema_version": SCHEMA_VERSION,
            "project_id": args.project_id,
            "issuer": args.issuer,
            "contract_type": args.contract_type,
            "library": str(library),
            "created_at": now_iso(),
            "current_promoted_round": None,
        },
        overwrite=False,
    )
    empty = {"requirements": []}
    r00 = init_round(root, "R00_SourceLock", None, empty)
    manifest = source_manifest(Path(args.source_dir).expanduser().resolve(), r00)
    write_json(r00 / "source-manifest.json", manifest, overwrite=False)
    r00_manifest_path = r00 / "manifest.json"
    r00_manifest = read_json(r00_manifest_path)
    r00_manifest.update(
        {
            "promotion_status": "promoted",
            "promoted_at": now_iso(),
            "approved_by": "deterministic-source-lock",
        }
    )
    write_json(r00_manifest_path, r00_manifest)
    init_round(root, "R01_IssuerVisualCanon", "R00_SourceLock", empty)
    write_json(
        root / "CURRENT.json",
        {
            "project_id": args.project_id,
            "working_round": "R01_IssuerVisualCanon",
            "promoted_round": "R00_SourceLock",
        },
        overwrite=False,
    )
    print(json.dumps({"project": str(root), "status": "initialized"}, ensure_ascii=False))


def validate_pattern(data: dict[str, Any]) -> None:
    missing = sorted(REQUIRED_PATTERN_FIELDS - data.keys())
    if missing:
        raise ProposalSystemError(f"pattern metadata missing fields: {', '.join(missing)}")
    if data["scope"] not in PATTERN_SCOPES:
        raise ProposalSystemError(f"invalid pattern scope: {data['scope']}")
    if not isinstance(data["validation"], dict) or not data["validation"]:
        raise ProposalSystemError("pattern validation must be a non-empty object")


def command_propose_pattern(args: argparse.Namespace) -> None:
    library = Path(args.library).expanduser().resolve()
    project_root = Path(args.project_root).expanduser().resolve()
    if not (library / "catalog.json").is_file():
        raise ProposalSystemError("shared library is not initialized")
    project = read_json(project_root / "project.json")
    data = read_json(Path(args.metadata).expanduser().resolve())
    validate_pattern(data)
    data = dict(data)
    data.update(
        {
            "status": "candidate",
            "origin_project": project["project_id"],
            "proposed_at": now_iso(),
        }
    )
    destination = library / "patterns" / "candidates" / f"{data['pattern_id']}.json"
    write_json(destination, data, overwrite=False)
    print(json.dumps({"pattern_id": data["pattern_id"], "status": "candidate"}, ensure_ascii=False))


def next_pattern_version(accepted_dir: Path, pattern_id: str) -> int:
    versions = []
    for path in accepted_dir.glob(f"{pattern_id}.v*.json"):
        match = re.search(r"\.v(\d+)\.json$", path.name)
        if match:
            versions.append(int(match.group(1)))
    return max(versions, default=0) + 1


def command_promote_pattern(args: argparse.Namespace) -> None:
    library = Path(args.library).expanduser().resolve()
    candidate_path = library / "patterns" / "candidates" / f"{args.pattern_id}.json"
    candidate = read_json(candidate_path)
    validate_pattern(candidate)
    if candidate["scope"] == "project_only":
        raise ProposalSystemError("project_only patterns cannot enter the shared library")
    if not args.approved_by:
        raise ProposalSystemError("human approval is required for promotion")
    failed = sorted(key for key, value in candidate["validation"].items() if value is not True)
    if failed:
        raise ProposalSystemError(f"pattern validations not passed: {', '.join(failed)}")
    accepted_dir = library / "patterns" / "accepted"
    version = next_pattern_version(accepted_dir, args.pattern_id)
    promoted = dict(candidate)
    promoted.update(
        {
            "status": "accepted",
            "version": version,
            "approved_by": args.approved_by,
            "promoted_at": now_iso(),
        }
    )
    destination = accepted_dir / f"{args.pattern_id}.v{version}.json"
    write_json(destination, promoted, overwrite=False)
    catalog_path = library / "catalog.json"
    catalog = read_json(catalog_path)
    catalog.setdefault("patterns", []).append(
        {
            "pattern_id": args.pattern_id,
            "version": version,
            "scope": candidate["scope"],
            "path": str(destination.relative_to(library)),
            "approved_by": args.approved_by,
            "promoted_at": promoted["promoted_at"],
        }
    )
    write_json(catalog_path, catalog)
    print(json.dumps({"pattern_id": args.pattern_id, "version": version, "status": "accepted"}, ensure_ascii=False))


def command_create_round(args: argparse.Namespace) -> None:
    root = Path(args.root).expanduser().resolve()
    if not (root / "project.json").is_file():
        raise ProposalSystemError("project is not initialized")
    parent = root / "packages" / args.parent
    if not parent.is_dir():
        raise ProposalSystemError(f"parent round does not exist: {args.parent}")
    requirements = read_json(Path(args.requirements).expanduser().resolve())
    init_round(root, args.round_id, args.parent, requirements)
    current_path = root / "CURRENT.json"
    current = read_json(current_path)
    current["working_round"] = args.round_id
    write_json(current_path, current)
    print(json.dumps({"round_id": args.round_id, "parent": args.parent, "status": "draft"}, ensure_ascii=False))


def command_promote_round(args: argparse.Namespace) -> None:
    root = Path(args.root).expanduser().resolve()
    round_dir = root / "packages" / args.round_id
    manifest_path = round_dir / "manifest.json"
    manifest = read_json(manifest_path)
    if manifest.get("promotion_status") == "promoted":
        raise ProposalSystemError(f"round is already promoted and immutable: {args.round_id}")
    if not args.approved_by:
        raise ProposalSystemError("human approval is required for round promotion")
    parent_id = manifest.get("parent_round")
    if parent_id:
        parent = read_json(root / "packages" / parent_id / "manifest.json")
        if parent.get("promotion_status") != "promoted":
            raise ProposalSystemError(f"parent round is not promoted: {parent_id}")
    gate_report = read_json(Path(args.gates).expanduser().resolve())
    gates = gate_report.get("gates")
    if not isinstance(gates, dict) or not gates:
        raise ProposalSystemError("promotion gate report must contain a non-empty gates object")
    failed = sorted(key for key, value in gates.items() if value is not True)
    if failed:
        raise ProposalSystemError(f"round gates not passed: {', '.join(failed)}")
    if parent_id:
        parent_requirements = read_json(root / "packages" / parent_id / "requirements.json")
        child_requirements = read_json(round_dir / "requirements.json")
        lost = sorted(confirmed_requirement_ids(parent_requirements) - confirmed_requirement_ids(child_requirements))
        if lost:
            raise ProposalSystemError(f"round loses inherited requirements: {', '.join(lost)}")
    promotion_record = {
        "round_id": args.round_id,
        "approved_by": args.approved_by,
        "promoted_at": now_iso(),
        "gates": gates,
    }
    write_json(round_dir / "qa" / "promotion-gates.json", promotion_record, overwrite=False)
    manifest.update(
        {
            "promotion_status": "promoted",
            "promoted_at": promotion_record["promoted_at"],
            "approved_by": args.approved_by,
        }
    )
    write_json(manifest_path, manifest)
    current_path = root / "CURRENT.json"
    current = read_json(current_path)
    current["promoted_round"] = args.round_id
    write_json(current_path, current)
    project_path = root / "project.json"
    project = read_json(project_path)
    project["current_promoted_round"] = args.round_id
    write_json(project_path, project)
    print(json.dumps({"round_id": args.round_id, "status": "promoted"}, ensure_ascii=False))


def command_capture_input(args: argparse.Namespace) -> None:
    root = Path(args.root).expanduser().resolve()
    round_dir = root / "packages" / args.round_id
    round_manifest = read_json(round_dir / "manifest.json")
    if round_manifest.get("promotion_status") == "promoted":
        raise ProposalSystemError(f"cannot change inputs of promoted round: {args.round_id}")
    if not ROLE_RE.fullmatch(args.role):
        raise ProposalSystemError(f"invalid input role: {args.role}")
    manifest_path = round_dir / "input-manifest.json"
    manifest = read_json(manifest_path) if manifest_path.exists() else {"schema_version": SCHEMA_VERSION, "inputs": []}
    existing = {(item.get("original_path"), item.get("sha256")) for item in manifest["inputs"]}
    captured = 0
    for raw_path in args.path:
        source = Path(raw_path).expanduser().resolve()
        if not source.is_file():
            raise ProposalSystemError(f"input file does not exist: {source}")
        digest = sha256(source)
        if (str(source), digest) in existing:
            continue
        destination = round_dir / "input" / args.role / source.name
        if destination.exists() and sha256(destination) != digest:
            raise ProposalSystemError(f"input filename collision with different content: {destination}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            shutil.copy2(source, destination)
        manifest["inputs"].append(
            {
                "role": args.role,
                "name": source.name,
                "bytes": source.stat().st_size,
                "sha256": digest,
                "original_path": str(source),
                "snapshot_path": str(destination.relative_to(round_dir)),
                "captured_at": now_iso(),
            }
        )
        existing.add((str(source), digest))
        captured += 1
    manifest["inputs"].sort(key=lambda item: (item["role"], item["name"], item["sha256"]))
    write_json(manifest_path, manifest)
    print(json.dumps({"round_id": args.round_id, "role": args.role, "captured": captured}, ensure_ascii=False))


def confirmed_requirement_ids(data: dict[str, Any]) -> set[str]:
    return {
        item["id"]
        for item in data.get("requirements", [])
        if isinstance(item, dict) and item.get("id") and item.get("status") in {"confirmed", "satisfied"}
    }


def command_regress(args: argparse.Namespace) -> int:
    root = Path(args.root).expanduser().resolve()
    round_dir = root / "packages" / args.round_id
    manifest = read_json(round_dir / "manifest.json")
    parent_id = manifest.get("parent_round")
    if not parent_id:
        raise ProposalSystemError("root round has no parent to compare")
    parent_requirements = read_json(root / "packages" / parent_id / "requirements.json")
    child_requirements = read_json(round_dir / "requirements.json")
    lost = sorted(confirmed_requirement_ids(parent_requirements) - confirmed_requirement_ids(child_requirements))
    report = {
        "round_id": args.round_id,
        "parent_round": parent_id,
        "checked_at": now_iso(),
        "lost_requirements": lost,
        "passed": not lost,
    }
    write_json(round_dir / "qa" / "requirement-regression.json", report)
    print(json.dumps(report, ensure_ascii=False))
    return 0 if not lost else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    command = subparsers.add_parser("init-library")
    command.add_argument("--root", required=True)
    command.set_defaults(handler=command_init_library)

    command = subparsers.add_parser("init-project")
    command.add_argument("--root", required=True)
    command.add_argument("--library", required=True)
    command.add_argument("--project-id", required=True)
    command.add_argument("--issuer", required=True)
    command.add_argument("--contract-type", required=True)
    command.add_argument("--source-dir", required=True)
    command.set_defaults(handler=command_init_project)

    command = subparsers.add_parser("propose-pattern")
    command.add_argument("--library", required=True)
    command.add_argument("--project-root", required=True)
    command.add_argument("--metadata", required=True)
    command.set_defaults(handler=command_propose_pattern)

    command = subparsers.add_parser("promote-pattern")
    command.add_argument("--library", required=True)
    command.add_argument("--pattern-id", required=True)
    command.add_argument("--approved-by")
    command.set_defaults(handler=command_promote_pattern)

    command = subparsers.add_parser("create-round")
    command.add_argument("--root", required=True)
    command.add_argument("--round-id", required=True)
    command.add_argument("--parent", required=True)
    command.add_argument("--requirements", required=True)
    command.set_defaults(handler=command_create_round)

    command = subparsers.add_parser("promote-round")
    command.add_argument("--root", required=True)
    command.add_argument("--round-id", required=True)
    command.add_argument("--gates", required=True)
    command.add_argument("--approved-by")
    command.set_defaults(handler=command_promote_round)

    command = subparsers.add_parser("capture-input")
    command.add_argument("--root", required=True)
    command.add_argument("--round-id", required=True)
    command.add_argument("--role", required=True)
    command.add_argument("--path", action="append", required=True)
    command.set_defaults(handler=command_capture_input)

    command = subparsers.add_parser("regress")
    command.add_argument("--root", required=True)
    command.add_argument("--round-id", required=True)
    command.set_defaults(handler=command_regress)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        result = args.handler(args)
        return result if isinstance(result, int) else 0
    except ProposalSystemError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
