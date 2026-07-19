from __future__ import annotations

import json
import sys
import traceback

from .errors import PipelineFailure
from .pipeline import run_pipeline
from .protocol import emit_event, write_result


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        write_result(run_pipeline(payload))
        return 0
    except PipelineFailure as exc:
        emit_event({"type": "fatal", "code": exc.code, "message": exc.message, "details": exc.details})
        return 1
    except Exception as exc:  # process boundary must serialize all failures
        emit_event(
            {
                "type": "fatal",
                "code": "REPOSITORY_AI_PIPELINE_UNEXPECTED_ERROR",
                "message": str(exc),
                "details": {
                    "exceptionType": type(exc).__name__,
                    "traceback": traceback.format_exc(limit=20),
                },
            }
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
