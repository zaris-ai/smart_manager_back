from __future__ import annotations

from typing import Any


class PipelineFailure(RuntimeError):
    def __init__(self, code: str, message: str, details: Any = None) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.details = details


class OpenAIRequestFailure(PipelineFailure):
    pass


def fail(code: str, message: str, details: Any = None) -> None:
    raise PipelineFailure(code, message, details)
