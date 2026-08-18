#!/usr/bin/env python3
"""Validate the bundled Korean public-proposal skill snapshot."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any
from urllib.parse import urlparse


ALLOWED_CLASSIFICATIONS = {"skill", "reference", "script", "asset"}
EXPECTED_TOP_LEVEL = {"SKILL.md", "references", "scripts", "assets", "BUNDLE-MANIFEST.json"}
HEX64_RE = re.compile(r"^[0-9a-f]{64}$")
URI_TOKEN_RE = re.compile(r"(?P<token>[A-Za-z][A-Za-z0-9+.\-]*:[^\s\"'`<>|]+)")
WINDOWS_DRIVE_TOKEN_RE = re.compile(r"(?:(?<=^)|(?<=[\s\"'`(=,\[]))(?P<token>[A-Za-z]:[\\/][^\s\"'`<>|]+)")
UNC_TOKEN_RE = re.compile(r"(?:(?<=^)|(?<=[\s\"'`(=,\[]))(?P<token>\\\\[^\s\"'`<>|]+)")
POSIX_TOKEN_RE = re.compile(r"(?:(?<=^)|(?<=[\s\"'`(=,\[]))(?P<token>/(?!/)[^\s\"'`<>|]+)")
KNOWN_POSIX_ROOTS = {
    "/bin",
    "/etc",
    "/home",
    "/Library",
    "/opt",
    "/private",
    "/sbin",
    "/tmp",
    "/Users",
    "/usr",
    "/var",
    "/Volumes",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate a bundled Korean proposal skill snapshot.")
    parser.add_argument("plugin_root", help="Path to the plugin root directory")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    plugin_root = Path(args.plugin_root).expanduser().resolve()
    errors = validate_bundle(plugin_root)
    if errors:
        print("Korean skill bundle validation failed:")
        for error in errors:
            print(f"- {error}")
        raise SystemExit(1)
    print(f"Korean skill bundle validation passed: {plugin_root}")


def validate_bundle(plugin_root: Path) -> list[str]:
    errors: list[str] = []
    bundle_root = plugin_root / "skills" / "korean-public-proposal"
    manifest_path = bundle_root / "BUNDLE-MANIFEST.json"

    if not bundle_root.is_dir():
        return [f"missing bundled skill directory: {bundle_root}"]
    if not manifest_path.is_file():
        return [f"missing bundle manifest: {manifest_path}"]

    manifest = load_manifest(manifest_path, errors)
    if manifest is None:
        return errors

    entries = manifest.get("files")
    if not isinstance(entries, list) or not entries:
        errors.append("BUNDLE-MANIFEST.json field `files` must be a non-empty array")
        return errors

    declared_paths: dict[str, dict[str, Any]] = {}
    for index, entry in enumerate(entries):
        label = f"files[{index}]"
        if not isinstance(entry, dict):
            errors.append(f"BUNDLE-MANIFEST.json field `{label}` must be an object")
            continue
        relative_path = entry.get("path")
        if not isinstance(relative_path, str) or not relative_path.strip():
            errors.append(f"BUNDLE-MANIFEST.json field `{label}.path` must be a non-empty string")
            continue
        if is_absolute_path_like(relative_path):
            errors.append(f"BUNDLE-MANIFEST.json field `{label}.path` must not contain an absolute source path")
            continue
        normalized_path = normalize_relative_path(relative_path)
        if normalized_path is None:
            errors.append(f"BUNDLE-MANIFEST.json field `{label}.path` must be a relative path inside the bundle")
            continue
        if normalized_path in declared_paths:
            errors.append(f"BUNDLE-MANIFEST.json declares duplicate file path `{normalized_path}`")
            continue

        classification = entry.get("classification")
        if classification not in ALLOWED_CLASSIFICATIONS:
            errors.append(
                f"BUNDLE-MANIFEST.json field `{label}.classification` must be one of {sorted(ALLOWED_CLASSIFICATIONS)}"
            )

        byte_count = entry.get("bytes")
        if not isinstance(byte_count, int) or byte_count < 0:
            errors.append(f"BUNDLE-MANIFEST.json field `{label}.bytes` must be a non-negative integer")

        sha256 = entry.get("sha256")
        if not isinstance(sha256, str) or HEX64_RE.fullmatch(sha256) is None:
            errors.append(f"BUNDLE-MANIFEST.json field `{label}.sha256` must be a lowercase SHA-256 hex digest")

        declared_paths[normalized_path] = entry

    validate_manifest_metadata(manifest, errors)
    validate_top_level_shape(bundle_root, errors)
    reject_absolute_manifest_strings(manifest, "$", errors)
    check_file_for_absolute_source_paths(manifest_path, errors)

    for relative_path, entry in declared_paths.items():
        file_path = bundle_root / relative_path
        if not file_path.is_file():
            errors.append(f"bundle manifest declares missing file `{relative_path}`")
            continue
        payload = file_path.read_bytes()
        if len(payload) != entry["bytes"]:
            errors.append(
                f"bundle manifest byte count mismatch for `{relative_path}`: expected {entry['bytes']}, found {len(payload)}"
            )
        actual_sha = hashlib.sha256(payload).hexdigest()
        if actual_sha != entry["sha256"]:
            errors.append(
                f"bundle manifest SHA-256 mismatch for `{relative_path}`: expected {entry['sha256']}, found {actual_sha}"
            )
        check_file_for_absolute_source_paths(file_path, errors)

    actual_paths = {
        path.relative_to(bundle_root).as_posix()
        for path in bundle_root.rglob("*")
        if path.is_file() and path.name != "BUNDLE-MANIFEST.json"
    }
    for relative_path in sorted(actual_paths):
        if is_absolute_path_like(relative_path):
            errors.append(f"bundle contains an absolute-looking file path `{relative_path}`")
    undeclared_paths = sorted(actual_paths - declared_paths.keys())
    for relative_path in undeclared_paths:
        errors.append(f"bundle contains undeclared file `{relative_path}`")

    return errors


def load_manifest(path: Path, errors: list[str]) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        errors.append("BUNDLE-MANIFEST.json must contain valid JSON")
        return None
    if not isinstance(payload, dict):
        errors.append("BUNDLE-MANIFEST.json must contain a JSON object")
        return None
    return payload


def validate_manifest_metadata(manifest: dict[str, Any], errors: list[str]) -> None:
    if manifest.get("schemaVersion") != "1.0.0":
        errors.append("BUNDLE-MANIFEST.json field `schemaVersion` must equal `1.0.0`")
    source_skill_name = manifest.get("sourceSkillName")
    if source_skill_name != "korean-public-proposal":
        errors.append("BUNDLE-MANIFEST.json field `sourceSkillName` must equal `korean-public-proposal`")
    source_snapshot_date = manifest.get("sourceSnapshotDate")
    if not isinstance(source_snapshot_date, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", source_snapshot_date):
        errors.append("BUNDLE-MANIFEST.json field `sourceSnapshotDate` must use `YYYY-MM-DD`")


def validate_top_level_shape(bundle_root: Path, errors: list[str]) -> None:
    actual = {path.name for path in bundle_root.iterdir()}
    missing = sorted(EXPECTED_TOP_LEVEL - actual)
    unexpected = sorted(actual - EXPECTED_TOP_LEVEL)
    for name in missing:
        errors.append(f"bundle is missing top-level entry `{name}`")
    for name in unexpected:
        errors.append(f"bundle contains unexpected top-level entry `{name}`")


def normalize_relative_path(raw_path: str) -> str | None:
    pure_path = PurePosixPath(raw_path)
    if pure_path.is_absolute():
        return None
    parts = pure_path.parts
    if not parts or any(part in {"", ".", ".."} for part in parts):
        return None
    return pure_path.as_posix()


def reject_absolute_manifest_strings(value: Any, label: str, errors: list[str]) -> None:
    if isinstance(value, str):
        if is_absolute_path_like(value):
            errors.append(f"absolute source path `{value}` found in manifest field `{label}`")
        for absolute_path in extract_absolute_path_tokens(value):
            if absolute_path != value:
                errors.append(f"absolute source path `{absolute_path}` found in manifest field `{label}`")
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            reject_absolute_manifest_strings(item, f"{label}[{index}]", errors)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            reject_absolute_manifest_strings(item, f"{label}.{key}", errors)


def check_file_for_absolute_source_paths(path: Path, errors: list[str]) -> None:
    payload = path.read_bytes()
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError:
        return
    for absolute_path in extract_absolute_path_tokens(text):
        errors.append(f"absolute source path `{absolute_path}` found in `{path}`")


def extract_absolute_path_tokens(text: str) -> list[str]:
    matches: list[str] = []
    for pattern in (URI_TOKEN_RE, WINDOWS_DRIVE_TOKEN_RE, UNC_TOKEN_RE, POSIX_TOKEN_RE):
        for match in pattern.finditer(text):
            candidate = match.group("token")
            if is_absolute_path_reference(candidate):
                matches.append(candidate)
    return dedupe(matches)


def is_absolute_path_like(value: str) -> bool:
    stripped = value.strip()
    if not stripped:
        return False
    if PurePosixPath(stripped).is_absolute():
        return True
    if PureWindowsPath(stripped).is_absolute():
        return True
    return stripped.startswith("\\\\")


def is_absolute_path_reference(value: str) -> bool:
    stripped = value.strip()
    if not stripped:
        return False
    if stripped.startswith("http://") or stripped.startswith("https://"):
        return False
    if URI_TOKEN_RE.fullmatch(stripped):
        parsed = urlparse(stripped)
        if parsed.scheme in {"http", "https"}:
            return False
        if parsed.scheme == "file":
            if parsed.netloc and parsed.path:
                return is_filesystem_absolute_path(f"//{parsed.netloc}{parsed.path}")
            return is_filesystem_absolute_path(parsed.path or parsed.netloc)
        return is_filesystem_absolute_path(stripped.split(":", 1)[1])
    return is_filesystem_absolute_path(stripped)


def is_filesystem_absolute_path(value: str) -> bool:
    stripped = value.strip()
    if not stripped:
        return False
    if stripped.startswith("\\\\"):
        return True
    if re.fullmatch(r"[A-Za-z]:[\\/].*", stripped):
        return True
    if not PurePosixPath(stripped).is_absolute():
        return False
    if stripped.startswith("//"):
        return True
    normalized = stripped.rstrip("/") or stripped
    return normalized in KNOWN_POSIX_ROOTS or "/" in stripped[1:]


def dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


if __name__ == "__main__":
    main()
