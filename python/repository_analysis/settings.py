"""Configuration for the Python repository-analysis worker.

All credentials and runtime settings are loaded from environment variables.

The Python process is launched by the Node.js backend and inherits the
container environment, including variables loaded from the backend `.env`.

Do not hardcode API keys in this file.
Do not commit `.env` to Git.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlparse


PIPELINE_VERSION = "3.0.1"


# =========================================================
# Environment readers
# =========================================================


def read_string(name: str, default: str = "") -> str:
    """Read and trim a string environment variable."""

    return os.getenv(name, default).strip()


def read_required_string(name: str) -> str:
    """Read a mandatory non-empty string environment variable."""

    value = read_string(name)

    if not value:
        raise RuntimeError(
            f"{name}_NOT_CONFIGURED: "
            f"The required environment variable {name} is missing or empty."
        )

    return value


def read_integer(
    name: str,
    default: int,
    *,
    minimum: int | None = None,
    maximum: int | None = None,
) -> int:
    """Read an integer environment variable with range validation."""

    raw_value = os.getenv(name)

    if raw_value is None or not raw_value.strip():
        value = default
    else:
        try:
            value = int(raw_value.strip())
        except ValueError as exc:
            raise RuntimeError(
                f"{name}_INVALID: "
                f"{name} must be a valid integer; received {raw_value!r}."
            ) from exc

    if minimum is not None and value < minimum:
        raise RuntimeError(
            f"{name}_TOO_SMALL: "
            f"{name} must be greater than or equal to {minimum}; "
            f"received {value}."
        )

    if maximum is not None and value > maximum:
        raise RuntimeError(
            f"{name}_TOO_LARGE: "
            f"{name} must be less than or equal to {maximum}; "
            f"received {value}."
        )

    return value


def read_boolean(name: str, default: bool) -> bool:
    """Read a boolean environment variable."""

    raw_value = os.getenv(name)

    if raw_value is None or not raw_value.strip():
        return default

    normalized = raw_value.strip().lower()

    if normalized in {"1", "true", "yes", "on"}:
        return True

    if normalized in {"0", "false", "no", "off"}:
        return False

    raise RuntimeError(
        f"{name}_INVALID: "
        f"{name} must be one of true, false, 1, 0, yes, no, on, or off."
    )


def normalize_base_url(value: str) -> str:
    """Normalize an HTTP base URL and remove trailing slashes."""

    normalized = value.strip().rstrip("/")

    if not normalized:
        raise RuntimeError(
            "OPENAI_BASE_URL_NOT_CONFIGURED: "
            "OPENAI_BASE_URL cannot be empty."
        )

    parsed = urlparse(normalized)

    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise RuntimeError(
            "OPENAI_BASE_URL_INVALID: "
            "OPENAI_BASE_URL must be a valid HTTP or HTTPS URL."
        )

    return normalized


# =========================================================
# OpenAI configuration
# =========================================================


OPENAI_API_KEY = read_string("OPENAI_API_KEY")

OPENAI_BASE_URL = normalize_base_url(
    read_string(
        "OPENAI_BASE_URL",
        "https://api.openai.com/v1",
    )
)

OPENAI_MODEL = read_string(
    "OPENAI_REPOSITORY_ANALYSIS_MODEL",
    "gpt-4.1-mini",
)

OPENAI_REQUEST_TIMEOUT_MS = read_integer(
    "OPENAI_REPOSITORY_ANALYSIS_TIMEOUT_MS",
    180_000,
    minimum=1_000,
    maximum=900_000,
)

OPENAI_MAX_RETRIES = read_integer(
    "REPOSITORY_ANALYSIS_AI_MAX_RETRIES",
    2,
    minimum=0,
    maximum=10,
)


# =========================================================
# Multi-pass pipeline configuration
# =========================================================


MAX_ANALYSIS_BATCHES = read_integer(
    "REPOSITORY_ANALYSIS_AI_MAX_BATCHES",
    4,
    minimum=1,
    maximum=50,
)

ANALYSIS_BATCH_CHARACTERS = read_integer(
    "REPOSITORY_ANALYSIS_AI_BATCH_CHARS",
    50_000,
    minimum=1_000,
    maximum=500_000,
)

CRITIC_ENABLED = read_boolean(
    "REPOSITORY_ANALYSIS_AI_CRITIC_ENABLED",
    True,
)


# =========================================================
# Report configuration
# =========================================================


OUTPUT_LANGUAGE = read_string(
    "REPOSITORY_ANALYSIS_OUTPUT_LANGUAGE",
    "fa",
)

REPORT_LOCALE = read_string(
    "REPOSITORY_ANALYSIS_REPORT_LOCALE",
    "fa-IR",
)


# =========================================================
# Compatibility aliases
#
# Keep these aliases when other Python modules still import the previous
# constant names. They can be removed after all imports are migrated.
# =========================================================


DEFAULT_OPENAI_BASE_URL = OPENAI_BASE_URL
DEFAULT_OPENAI_MODEL = OPENAI_MODEL
DEFAULT_REQUEST_TIMEOUT_MS = OPENAI_REQUEST_TIMEOUT_MS
DEFAULT_MAX_RETRIES = OPENAI_MAX_RETRIES
DEFAULT_MAX_BATCHES = MAX_ANALYSIS_BATCHES
DEFAULT_BATCH_CHARS = ANALYSIS_BATCH_CHARACTERS
DEFAULT_CRITIC_ENABLED = CRITIC_ENABLED
DEFAULT_OUTPUT_LANGUAGE = OUTPUT_LANGUAGE
DEFAULT_REPORT_LOCALE = REPORT_LOCALE


# =========================================================
# Typed settings object
# =========================================================


@dataclass(frozen=True, slots=True)
class RepositoryAnalysisSettings:
    """Immutable configuration consumed by the Python analysis pipeline."""

    openai_api_key: str
    openai_base_url: str
    openai_model: str
    request_timeout_ms: int
    max_retries: int
    max_batches: int
    batch_characters: int
    critic_enabled: bool
    output_language: str
    report_locale: str
    pipeline_version: str


def get_settings() -> RepositoryAnalysisSettings:
    """Return the validated repository-analysis settings."""

    validate_settings()

    return RepositoryAnalysisSettings(
        openai_api_key=OPENAI_API_KEY,
        openai_base_url=OPENAI_BASE_URL,
        openai_model=OPENAI_MODEL,
        request_timeout_ms=OPENAI_REQUEST_TIMEOUT_MS,
        max_retries=OPENAI_MAX_RETRIES,
        max_batches=MAX_ANALYSIS_BATCHES,
        batch_characters=ANALYSIS_BATCH_CHARACTERS,
        critic_enabled=CRITIC_ENABLED,
        output_language=OUTPUT_LANGUAGE,
        report_locale=REPORT_LOCALE,
        pipeline_version=PIPELINE_VERSION,
    )


# =========================================================
# Validation
# =========================================================


def validate_settings() -> None:
    """Validate all settings before the first OpenAI request."""

    if not OPENAI_API_KEY:
        raise RuntimeError(
            "OPENAI_API_KEY_NOT_CONFIGURED: "
            "OPENAI_API_KEY is missing from the Python process environment. "
            "Define it in the backend .env file and recreate the container."
        )

    if not OPENAI_API_KEY.startswith("sk-"):
        raise RuntimeError(
            "OPENAI_API_KEY_INVALID_FORMAT: "
            "OPENAI_API_KEY does not start with the expected 'sk-' prefix."
        )

    if not OPENAI_MODEL:
        raise RuntimeError(
            "OPENAI_MODEL_NOT_CONFIGURED: "
            "OPENAI_REPOSITORY_ANALYSIS_MODEL cannot be empty."
        )

    if not OUTPUT_LANGUAGE:
        raise RuntimeError(
            "OUTPUT_LANGUAGE_NOT_CONFIGURED: "
            "REPOSITORY_ANALYSIS_OUTPUT_LANGUAGE cannot be empty."
        )

    if not REPORT_LOCALE:
        raise RuntimeError(
            "REPORT_LOCALE_NOT_CONFIGURED: "
            "REPOSITORY_ANALYSIS_REPORT_LOCALE cannot be empty."
        )


# =========================================================
# Safe diagnostic output
# =========================================================


def get_safe_settings_summary() -> dict[str, object]:
    """Return diagnostic settings without exposing the OpenAI credential."""

    return {
        "pipelineVersion": PIPELINE_VERSION,
        "openAiConfigured": bool(OPENAI_API_KEY),
        "openAiKeyPrefixValid": OPENAI_API_KEY.startswith("sk-"),
        "openAiKeyLength": len(OPENAI_API_KEY),
        "openAiBaseUrl": OPENAI_BASE_URL,
        "openAiModel": OPENAI_MODEL,
        "requestTimeoutMs": OPENAI_REQUEST_TIMEOUT_MS,
        "maxRetries": OPENAI_MAX_RETRIES,
        "maxBatches": MAX_ANALYSIS_BATCHES,
        "batchCharacters": ANALYSIS_BATCH_CHARACTERS,
        "criticEnabled": CRITIC_ENABLED,
        "outputLanguage": OUTPUT_LANGUAGE,
        "reportLocale": REPORT_LOCALE,
    }