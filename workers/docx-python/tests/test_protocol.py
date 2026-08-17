"""Contract tests for the versioned DOCX worker boundary."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from kpp_docx.protocol import PROTOCOL_VERSION, WorkerRequest, WorkerResponse


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_rejects_unknown_protocol_version() -> None:
    request = {
        "protocolVersion": "9",
        "command": "build",
        "input": {},
        "output": {},
    }

    with pytest.raises(ValidationError):
        WorkerRequest.model_validate(request)


def test_accepts_the_locked_protocol_request_shape() -> None:
    request = WorkerRequest.model_validate(
        {
            "protocolVersion": PROTOCOL_VERSION,
            "command": "build",
            "input": {"document": "request.json"},
            "output": {"directory": "build"},
        }
    )

    assert request.protocol_version == PROTOCOL_VERSION
    assert request.command == "build"


def test_response_has_a_safe_envelope() -> None:
    response = WorkerResponse.failure(
        code="KPP_WORKER_PROTOCOL_INVALID_JSON",
        message="요청 JSON을 읽을 수 없습니다.",
    )

    assert response.model_dump(by_alias=True) == {
        "ok": False,
        "code": "KPP_WORKER_PROTOCOL_INVALID_JSON",
        "message": "요청 JSON을 읽을 수 없습니다.",
        "artifacts": [],
        "findings": [],
    }


def test_main_emits_one_safe_response_for_a_malformed_line() -> None:
    completed = _run_worker("{not json}\n")

    assert completed.returncode == 0
    responses = _responses(completed.stdout)
    assert len(responses) == 1
    assert responses[0]["ok"] is False
    assert responses[0]["code"] == "KPP_WORKER_PROTOCOL_INVALID_JSON"
    assert responses[0]["artifacts"] == []
    assert responses[0]["findings"] == []


def test_main_emits_one_response_for_each_request_line() -> None:
    request = {
        "protocolVersion": PROTOCOL_VERSION,
        "command": "build",
        "input": {},
        "output": {},
    }
    completed = _run_worker(f"{json.dumps(request)}\n{json.dumps(request)}\n")

    assert completed.returncode == 0
    responses = _responses(completed.stdout)
    assert len(responses) == 2
    assert all(response["ok"] is False for response in responses)
    assert all(response["code"] == "KPP_WORKER_COMMAND_UNSUPPORTED" for response in responses)


def test_main_help_exits_successfully() -> None:
    completed = subprocess.run(
        [sys.executable, "-m", "kpp_docx.main", "--help"],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0
    assert "NDJSON" in completed.stdout


def _run_worker(stdin: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "kpp_docx.main"],
        cwd=PROJECT_ROOT,
        input=stdin,
        capture_output=True,
        text=True,
        check=False,
    )


def _responses(stdout: str) -> list[dict[str, object]]:
    return [json.loads(line) for line in stdout.splitlines() if line.strip()]
