from __future__ import annotations

import json
import sys
from typing import Any, Dict, Mapping


def emit_event(payload: Mapping[str, Any]) -> None:
    sys.stderr.write(json.dumps(dict(payload), ensure_ascii=False) + "\n")
    sys.stderr.flush()


def emit_progress(stage: str, percent: int, message: str = "") -> None:
    event: Dict[str, Any] = {"type": "progress", "stage": stage, "percent": percent}
    if message:
        event["message"] = message
    emit_event(event)


def write_result(payload: Mapping[str, Any]) -> None:
    sys.stdout.write(json.dumps(dict(payload), ensure_ascii=False))
    sys.stdout.flush()
