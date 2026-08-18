"""NDJSON process entrypoint for the local KPP DOCX worker."""

from __future__ import annotations

import argparse
import json
import sys

from pydantic import ValidationError

from .protocol import PROTOCOL_VERSION
from .protocol import WorkerRequest, WorkerResponse


def main(argv: list[str] | None = None) -> int:
    """Read NDJSON requests from stdin and write one safe response per line."""

    parser = argparse.ArgumentParser(
        description="Run the KPP DOCX worker NDJSON protocol on standard input."
    )
    parser.add_argument(
        "--protocol-version",
        action="store_true",
        help="Print the supported worker protocol version and exit.",
    )
    args = parser.parse_args(argv)
    if args.protocol_version:
        print(PROTOCOL_VERSION)
        return 0

    for raw_line in sys.stdin:
        if not raw_line.strip():
            continue
        response = handle_line(raw_line)
        print(response.model_dump_json(by_alias=True), flush=True)

    return 0


def handle_line(raw_line: str) -> WorkerResponse:
    """Convert one untrusted NDJSON line into a protocol response."""

    try:
        payload = json.loads(raw_line)
    except json.JSONDecodeError:
        return WorkerResponse.failure(
            code="KPP_WORKER_PROTOCOL_INVALID_JSON",
            message="요청 JSON을 읽을 수 없습니다.",
        )

    try:
        request = WorkerRequest.model_validate(payload)
    except ValidationError:
        return WorkerResponse.failure(
            code="KPP_WORKER_PROTOCOL_INVALID_REQUEST",
            message="요청이 KPP DOCX 워커 프로토콜과 일치하지 않습니다.",
        )

    return dispatch(request)


def dispatch(request: WorkerRequest) -> WorkerResponse:
    """Reserve supported command routing for later worker capabilities."""

    return WorkerResponse.failure(
        code="KPP_WORKER_COMMAND_UNSUPPORTED",
        message=f"지원하지 않는 DOCX 워커 명령입니다: {request.command}",
    )


if __name__ == "__main__":
    raise SystemExit(main())
