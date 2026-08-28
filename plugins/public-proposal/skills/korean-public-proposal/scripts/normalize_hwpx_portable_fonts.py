#!/usr/bin/env python3
"""Bind generated HWPX Hamchorom faces to portable Noto CJK faces.

The pinned upstream engine remains untouched. This postprocessor changes only
the two font-face names in ``Contents/header.xml`` and proves that every other
ZIP member is byte-identical before committing the output.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
import tempfile
import zipfile
from pathlib import Path, PurePosixPath


HEADER_PATH = "Contents/header.xml"
MIMETYPE_PATH = "mimetype"
DEFAULT_SERIF = "Noto Serif CJK KR"
DEFAULT_SANS = "Noto Sans CJK KR"
SOURCE_SERIF = "함초롬바탕"
SOURCE_SANS = "함초롬돋움"


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def safe_member(info: zipfile.ZipInfo) -> bool:
    path = PurePosixPath(info.filename)
    mode = info.external_attr >> 16
    return (
        bool(info.filename)
        and not path.is_absolute()
        and ".." not in path.parts
        and not stat.S_ISLNK(mode)
    )


def font_token(face: str) -> bytes:
    if not face or any(token in face for token in ('"', "<", ">", "\x00")):
        raise ValueError("font face contains a forbidden character")
    return f'face="{face}"'.encode("utf-8")


def normalize(input_path: Path, output_path: Path, serif: str, sans: str, force: bool) -> dict[str, object]:
    input_path = input_path.resolve(strict=True)
    output_path = output_path.resolve()
    if input_path.suffix.lower() != ".hwpx" or output_path.suffix.lower() != ".hwpx":
        raise ValueError("input and output must use the .hwpx extension")
    if output_path.exists() and output_path != input_path and not force:
        raise FileExistsError(f"output already exists: {output_path}")

    with zipfile.ZipFile(input_path, "r") as source:
        infos = source.infolist()
        names = [info.filename for info in infos]
        if len(names) != len(set(names)):
            raise ValueError("HWPX contains duplicate ZIP members")
        unsafe = [info.filename for info in infos if not safe_member(info)]
        if unsafe:
            raise ValueError(f"HWPX contains unsafe ZIP members: {unsafe}")
        if not infos or infos[0].filename != MIMETYPE_PATH or infos[0].compress_type != zipfile.ZIP_STORED:
            raise ValueError("HWPX mimetype must be the first uncompressed ZIP member")
        if HEADER_PATH not in names:
            raise ValueError(f"HWPX is missing {HEADER_PATH}")
        payloads = {info.filename: source.read(info.filename) for info in infos}

    header = payloads[HEADER_PATH]
    serif_source = font_token(SOURCE_SERIF)
    sans_source = font_token(SOURCE_SANS)
    serif_target = font_token(serif)
    sans_target = font_token(sans)
    replacements = {
        SOURCE_SERIF: header.count(serif_source),
        SOURCE_SANS: header.count(sans_source),
    }
    normalized_header = header.replace(serif_source, serif_target).replace(sans_source, sans_target)
    if normalized_header.count(serif_target) < replacements[SOURCE_SERIF]:
        raise ValueError("serif face replacement did not persist")
    if normalized_header.count(sans_target) < replacements[SOURCE_SANS]:
        raise ValueError("sans face replacement did not persist")
    payloads[HEADER_PATH] = normalized_header

    output_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{output_path.name}.", suffix=".tmp", dir=output_path.parent)
    os.close(descriptor)
    temporary_path = Path(temporary_name)
    try:
        with zipfile.ZipFile(temporary_path, "w") as target:
            for info in infos:
                target.writestr(info, payloads[info.filename])
        with zipfile.ZipFile(temporary_path, "r") as verified:
            if verified.testzip() is not None:
                raise ValueError("normalized HWPX failed CRC verification")
            verified_names = verified.namelist()
            if verified_names != names:
                raise ValueError("normalized HWPX changed ZIP member ordering")
            for name in names:
                actual = verified.read(name)
                if name != HEADER_PATH and sha256(actual) != sha256(payloads[name]):
                    raise ValueError(f"normalized HWPX changed an unrelated member: {name}")
            if verified.infolist()[0].compress_type != zipfile.ZIP_STORED:
                raise ValueError("normalized HWPX compressed the mimetype member")
        os.replace(temporary_path, output_path)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()

    return {
        "ok": True,
        "input": str(input_path),
        "output": str(output_path),
        "fonts": {SOURCE_SERIF: serif, SOURCE_SANS: sans},
        "replacements": replacements,
        "headerBeforeSha256": sha256(header),
        "headerAfterSha256": sha256(normalized_header),
        "unchangedMemberCount": len(names) - 1,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Normalize generated HWPX fonts without changing its upstream structure")
    parser.add_argument("input", type=Path)
    destination = parser.add_mutually_exclusive_group(required=True)
    destination.add_argument("--output", type=Path)
    destination.add_argument("--in-place", action="store_true")
    parser.add_argument("--serif", default=DEFAULT_SERIF)
    parser.add_argument("--sans", default=DEFAULT_SANS)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    output = args.input if args.in_place else args.output
    try:
        report = normalize(args.input, output, args.serif, args.sans, args.force)
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 2
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
