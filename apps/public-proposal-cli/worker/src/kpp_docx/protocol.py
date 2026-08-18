"""Stable models for the TypeScript-to-Python NDJSON boundary."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


PROTOCOL_VERSION = "1.0.0"


class WorkerRequest(BaseModel):
    """One line of a caller's NDJSON request stream."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    protocol_version: Literal[PROTOCOL_VERSION] = Field(alias="protocolVersion")
    command: str = Field(min_length=1, max_length=128)
    input: dict[str, Any]
    output: dict[str, Any]


class WorkerResponse(BaseModel):
    """One safe, JSON-serializable response for each request line."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    ok: bool
    code: str = Field(min_length=1, max_length=128)
    message: str = Field(min_length=1, max_length=2_000)
    artifacts: list[dict[str, Any]] = Field(default_factory=list)
    findings: list[dict[str, Any]] = Field(default_factory=list)

    @classmethod
    def failure(cls, *, code: str, message: str) -> "WorkerResponse":
        return cls(ok=False, code=code, message=message)

    @classmethod
    def success(
        cls,
        *,
        code: str = "KPP_WORKER_OK",
        message: str = "요청을 처리했습니다.",
        artifacts: list[dict[str, Any]] | None = None,
        findings: list[dict[str, Any]] | None = None,
    ) -> "WorkerResponse":
        return cls(
            ok=True,
            code=code,
            message=message,
            artifacts=artifacts or [],
            findings=findings or [],
        )
