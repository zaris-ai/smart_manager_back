
"""Configuration for the Python repository-analysis worker.

All credentials and runtime settings are read from environment variables.
The OpenAI key must be defined in the backend `.env` file and passed into
the Docker container.
"""

from __future__ import annotations

import os


# =========================================================
# Environment helpers
# =========================================================

def get_env_string(name: str, default: str = "") -> str:
    """Return a trimmed string environment variable."""

    return os.getenv(name, default).strip()


def get_env_int(name: str, default: int) -> int:
    """Return an integer environment variable with validation."""

    raw_value = os.getenv(name)

    if raw_value is None or not raw_value.strip():
        return default

    try:
        return int(raw_value)
    except ValueError as exc:
        raise RuntimeError(
            f"{name}_INVALID: {name} must be a valid integer."
        ) from exc


def get_env_bool(name: str, default: bool) -> bool:
    """Return a boolean environment variable."""

    raw_value = os.getenv(name)

    if raw_value is None or not raw_value.strip():
        return default

    normalized = raw_value.strip().lower()

    if normalized in {"true", "1", "yes", "on"}:
        return True

    if normalized in {"false", "0", "no", "off"}:
        return False

    raise RuntimeError(
        f"{name}_INVALID: {name} must be true or false."
    )


# =========================================================
# OpenAI credential
# Read directly from `.env` / Docker environment.
# =========================================================

OPENAI_API_KEY = get_env_string("OPENAI_API_KEY")


# =========================================================
# OpenAI configuration
# =========================================================

DEFAULT_OPENAI_BASE_URL = get_env_string(
    "OPENAI_BASE_URL",
    "https://api.openai.com/v1",
)

DEFAULT_OPENAI_MODEL = get_env_string(
    "OPENAI_REPOSITORY_ANALYSIS_MODEL",
    "gpt-4.1-mini",
)

# Timeout for each individual OpenAI request.
DEFAULT_REQUEST_TIMEOUT_MS = get_env_int(
    "OPENAI_REPOSITORY_ANALYSIS_TIMEOUT_MS",
    180_000,
)

# Retry only temporary network, timeout, rate-limit and server failures.
DEFAULT_MAX_RETRIES = get_env_int(
    "REPOSITORY_ANALYSIS_AI_MAX_RETRIES",
    2,
)


# =========================================================
# Multi-pass analysis configuration
# =========================================================

DEFAULT_MAX_BATCHES = get_env_int(
    "REPOSITORY_ANALYSIS_AI_MAX_BATCHES",
    4,
)

DEFAULT_BATCH_CHARS = get_env_int(
    "REPOSITORY_ANALYSIS_AI_BATCH_CHARS",
    50_000,
)

DEFAULT_CRITIC_ENABLED = get_env_bool(
    "REPOSITORY_ANALYSIS_AI_CRITIC_ENABLED",
    True,
)


# =========================================================
# Report configuration
# =========================================================

DEFAULT_OUTPUT_LANGUAGE = get_env_string(
    "REPOSITORY_ANALYSIS_OUTPUT_LANGUAGE",
    "fa",
)

DEFAULT_REPORT_LOCALE = get_env_string(
    "REPOSITORY_ANALYSIS_REPORT_LOCALE",
    "fa-IR",
)

PIPELINE_VERSION = "3.0.1"


# =========================================================
# Settings validation
# =========================================================

def validate_settings() -> None:
    """Validate pipeline settings before contacting OpenAI."""

    if not OPENAI_API_KEY:
        raise RuntimeError(
            "OPENAI_API_KEY_NOT_CONFIGURED: "
            "OPENAI_API_KEY is missing from the process environment."
        )

    if not OPENAI_API_KEY.startswith("sk-"):
        raise RuntimeError(
            "OPENAI_API_KEY_INVALID_FORMAT: "
            "OPENAI_API_KEY does not start with 'sk-'."
        )

    if not DEFAULT_OPENAI_BASE_URL.startswith(("http://", "https://")):
        raise RuntimeError(
            "OPENAI_BASE_URL_INVALID: "
            "OPENAI_BASE_URL must start with http:// or https://."
        )

    if not DEFAULT_OPENAI_MODEL:
        raise RuntimeError(
            "OPENAI_MODEL_NOT_CONFIGURED: "
            "OPENAI_REPOSITORY_ANALYSIS_MODEL is empty."
        )

    if DEFAULT_REQUEST_TIMEOUT_MS <= 0:
        raise RuntimeError(
            "OPENAI_TIMEOUT_INVALID: "
            "OPENAI_REPOSITORY_ANALYSIS_TIMEOUT_MS must be greater than zero."
        )

    if DEFAULT_MAX_RETRIES < 0:
        raise RuntimeError(
            "OPENAI_RETRY_COUNT_INVALID: "
            "REPOSITORY_ANALYSIS_AI_MAX_RETRIES cannot be negative."
        )

    if DEFAULT_MAX_BATCHES <= 0:
        raise RuntimeError(
            "AI_MAX_BATCHES_INVALID: "
            "REPOSITORY_ANALYSIS_AI_MAX_BATCHES must be greater than zero."
        )

    if DEFAULT_BATCH_CHARS < 1_000:
        raise RuntimeError(
            "AI_BATCH_SIZE_INVALID: "
            "REPOSITORY_ANALYSIS_AI_BATCH_CHARS must be at least 1000."
        )
