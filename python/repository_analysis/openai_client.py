from __future__ import annotations

import json
import os
import socket
import time
import urllib.error
import urllib.request
import uuid
from typing import Any, Dict, Mapping

from .errors import OpenAIRequestFailure, PipelineFailure, fail
from .settings import (
    DEFAULT_MAX_RETRIES,
    DEFAULT_OPENAI_BASE_URL,
    DEFAULT_OPENAI_MODEL,
    DEFAULT_REQUEST_TIMEOUT_MS,
    OPENAI_API_KEY,
)
from .utils import as_dict, as_list, extract_json_object


def _selected_headers(headers: Any) -> Dict[str, str]:
    names = [
        "x-request-id",
        "openai-organization",
        "openai-processing-ms",
        "openai-version",
        "retry-after",
        "x-ratelimit-limit-requests",
        "x-ratelimit-limit-tokens",
        "x-ratelimit-remaining-requests",
        "x-ratelimit-remaining-tokens",
        "x-ratelimit-reset-requests",
        "x-ratelimit-reset-tokens",
    ]
    output: Dict[str, str] = {}
    if headers is None:
        return output
    for name in names:
        try:
            value = headers.get(name)
        except Exception:
            value = None
        if value is not None:
            output[name] = str(value)
    return output


def _parse_body(raw: str) -> Any:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


def _is_retryable_openai_error(http_status: int, api_code: str, api_type: str) -> bool:
    permanent_codes = {
        "insufficient_quota",
        "billing_hard_limit_reached",
        "invalid_api_key",
        "model_not_found",
        "unsupported_value",
        "context_length_exceeded",
    }
    permanent_types = {"authentication_error", "permission_error", "invalid_request_error"}
    if api_code in permanent_codes or api_type in permanent_types:
        return False
    return http_status in {408, 409, 429, 500, 502, 503, 504}


def _retry_delay_seconds(headers: Mapping[str, str], attempt: int) -> float:
    retry_after = headers.get("retry-after", "").strip()
    try:
        if retry_after:
            return max(0.0, min(30.0, float(retry_after)))
    except ValueError:
        pass
    return min(8.0, 1.5 * (2**attempt))


class OpenAIJsonClient:
    def __init__(self, config: Mapping[str, Any]) -> None:
        self.api_key = OPENAI_API_KEY.strip()
        if not self.api_key or self.api_key == "REPLACE_WITH_A_NEW_OPENAI_API_KEY":
            fail(
                "OPENAI_API_KEY_NOT_CONFIGURED",
                "Set OPENAI_API_KEY in python/repository_analysis/settings.py.",
            )

        self.base_url = str(config.get("baseUrl") or os.environ.get("OPENAI_BASE_URL") or DEFAULT_OPENAI_BASE_URL).rstrip("/")
        self.model = str(config.get("model") or os.environ.get("OPENAI_REPOSITORY_ANALYSIS_MODEL") or DEFAULT_OPENAI_MODEL)
        request_timeout_ms = config.get("requestTimeoutMs")
        max_retries = config.get("maxRetries")
        self.timeout_seconds = max(
            15,
            int(request_timeout_ms if request_timeout_ms is not None else DEFAULT_REQUEST_TIMEOUT_MS) // 1000,
        )
        self.max_retries = max(
            0,
            min(3, int(max_retries if max_retries is not None else DEFAULT_MAX_RETRIES)),
        )
        self.total_calls = 0

    def call_json(
        self,
        *,
        stage: str,
        role: str,
        task: str,
        context: Mapping[str, Any],
        max_output_tokens: int = 8000,
    ) -> Dict[str, Any]:
        system = " ".join(
            [
                f"You are the {role} in a strict, evidence-driven static software repository audit.",
                "Use only the supplied context. Repository code was not built, executed, load-tested, penetration-tested, or deployed.",
                "Never invent repository paths, runtime measurements, test results, infrastructure, security controls, or business behavior.",
                "When evidence is insufficient, explicitly return unknown or insufficient_evidence instead of guessing.",
                "All explanatory prose must be professional natural Persian (Farsi).",
                "Keep package names, framework names, language names, paths, identifiers, API names, and technical acronyms unchanged.",
                "Return one valid JSON object only. Do not use Markdown fences.",
            ]
        )
        user = json.dumps({"task": task, "context": context}, ensure_ascii=False, separators=(",", ":"))

        payload = {
            "model": self.model,
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }

        last_failure: PipelineFailure | None = None
        endpoint = f"{self.base_url}/chat/completions"

        for attempt in range(self.max_retries + 1):
            self.total_calls += 1
            client_request_id = str(uuid.uuid4())
            request = urllib.request.Request(
                endpoint,
                data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                    "X-Client-Request-Id": client_request_id,
                },
                method="POST",
            )

            try:
                with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                    raw_body = response.read().decode("utf-8", errors="replace")
                    response_headers = _selected_headers(response.headers)
                    http_status = int(getattr(response, "status", 200) or 200)

                try:
                    body = json.loads(raw_body)
                except json.JSONDecodeError as exc:
                    raise PipelineFailure(
                        "OPENAI_INVALID_JSON_RESPONSE",
                        "OpenAI returned a non-JSON success response.",
                        {
                            "source": "openai",
                            "stage": stage,
                            "endpoint": endpoint,
                            "model": self.model,
                            "httpStatus": http_status,
                            "requestId": response_headers.get("x-request-id"),
                            "clientRequestId": client_request_id,
                            "headers": response_headers,
                            "rawResponseBody": raw_body[:12000],
                            "attempt": attempt + 1,
                            "maxAttempts": self.max_retries + 1,
                            "retryable": False,
                            "exceptionType": type(exc).__name__,
                        },
                    ) from exc

                choices = as_list(body.get("choices"))
                content = choices[0].get("message", {}).get("content", "") if choices else ""
                if not isinstance(content, str) or not content.strip():
                    raise PipelineFailure(
                        "OPENAI_EMPTY_RESPONSE",
                        "OpenAI returned a successful response without message content.",
                        {
                            "source": "openai",
                            "stage": stage,
                            "endpoint": endpoint,
                            "model": self.model,
                            "httpStatus": http_status,
                            "requestId": response_headers.get("x-request-id"),
                            "clientRequestId": client_request_id,
                            "headers": response_headers,
                            "rawResponseBody": raw_body[:12000],
                            "attempt": attempt + 1,
                            "maxAttempts": self.max_retries + 1,
                            "retryable": False,
                        },
                    )

                try:
                    return extract_json_object(content)
                except (ValueError, json.JSONDecodeError) as exc:
                    raise PipelineFailure(
                        "OPENAI_INVALID_STRUCTURED_OUTPUT",
                        "OpenAI message content did not contain a valid JSON object.",
                        {
                            "source": "openai",
                            "stage": stage,
                            "endpoint": endpoint,
                            "model": self.model,
                            "httpStatus": http_status,
                            "requestId": response_headers.get("x-request-id"),
                            "clientRequestId": client_request_id,
                            "headers": response_headers,
                            "rawModelContent": content[:12000],
                            "attempt": attempt + 1,
                            "maxAttempts": self.max_retries + 1,
                            "retryable": False,
                            "exceptionType": type(exc).__name__,
                            "exceptionMessage": str(exc),
                        },
                    ) from exc

            except urllib.error.HTTPError as exc:
                raw = exc.read().decode("utf-8", errors="replace")
                headers = _selected_headers(exc.headers)
                parsed_body = _parse_body(raw)
                api_error = as_dict(as_dict(parsed_body).get("error")) if isinstance(parsed_body, dict) else {}
                api_message = str(api_error.get("message") or raw or exc.reason or "OpenAI HTTP error")
                api_type = str(api_error.get("type") or "")
                api_code = str(api_error.get("code") or "")
                api_param = api_error.get("param")
                retryable = _is_retryable_openai_error(exc.code, api_code, api_type)
                details = {
                    "source": "openai",
                    "stage": stage,
                    "endpoint": endpoint,
                    "model": self.model,
                    "httpStatus": exc.code,
                    "openaiError": {
                        "message": api_message,
                        "type": api_type or None,
                        "code": api_code or None,
                        "param": api_param,
                    },
                    "requestId": headers.get("x-request-id"),
                    "clientRequestId": client_request_id,
                    "organization": headers.get("openai-organization"),
                    "processingMs": headers.get("openai-processing-ms"),
                    "headers": headers,
                    "rawResponseBody": raw[:12000],
                    "attempt": attempt + 1,
                    "maxAttempts": self.max_retries + 1,
                    "retryable": retryable,
                }
                backend_code = f"OPENAI_{api_code.upper()}" if api_code else f"OPENAI_HTTP_{exc.code}"
                last_failure = OpenAIRequestFailure(backend_code, api_message, details)
                if not retryable or attempt >= self.max_retries:
                    raise last_failure
                time.sleep(_retry_delay_seconds(headers, attempt))
                continue

            except (TimeoutError, socket.timeout) as exc:
                details = {
                    "source": "network",
                    "stage": stage,
                    "endpoint": endpoint,
                    "model": self.model,
                    "clientRequestId": client_request_id,
                    "attempt": attempt + 1,
                    "maxAttempts": self.max_retries + 1,
                    "retryable": True,
                    "timeoutSeconds": self.timeout_seconds,
                    "exceptionType": type(exc).__name__,
                    "exceptionMessage": str(exc),
                }
                last_failure = OpenAIRequestFailure("OPENAI_REQUEST_TIMEOUT", "OpenAI request timed out.", details)
                if attempt >= self.max_retries:
                    raise last_failure
                time.sleep(_retry_delay_seconds({}, attempt))
                continue

            except urllib.error.URLError as exc:
                reason = getattr(exc, "reason", exc)
                details = {
                    "source": "network",
                    "stage": stage,
                    "endpoint": endpoint,
                    "model": self.model,
                    "clientRequestId": client_request_id,
                    "attempt": attempt + 1,
                    "maxAttempts": self.max_retries + 1,
                    "retryable": True,
                    "exceptionType": type(reason).__name__,
                    "exceptionMessage": str(reason),
                }
                last_failure = OpenAIRequestFailure("OPENAI_NETWORK_ERROR", f"OpenAI network request failed: {reason}", details)
                if attempt >= self.max_retries:
                    raise last_failure
                time.sleep(_retry_delay_seconds({}, attempt))
                continue

            except PipelineFailure:
                raise
            except Exception as exc:
                raise PipelineFailure(
                    "OPENAI_CLIENT_UNEXPECTED_ERROR",
                    f"Unexpected OpenAI client error: {exc}",
                    {
                        "source": "client",
                        "stage": stage,
                        "endpoint": endpoint,
                        "model": self.model,
                        "clientRequestId": client_request_id,
                        "attempt": attempt + 1,
                        "maxAttempts": self.max_retries + 1,
                        "retryable": False,
                        "exceptionType": type(exc).__name__,
                        "exceptionMessage": str(exc),
                    },
                ) from exc

        if last_failure:
            raise last_failure
        raise PipelineFailure("OPENAI_REQUEST_FAILED", "OpenAI request failed without a structured error.")
