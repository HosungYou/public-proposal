"""KPP's local, versioned DOCX worker."""

from .protocol import PROTOCOL_VERSION, WorkerRequest, WorkerResponse

__all__ = ["PROTOCOL_VERSION", "WorkerRequest", "WorkerResponse"]
