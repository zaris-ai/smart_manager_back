
"""Static configuration for the Python repository-analysis worker.

This configuration is intended for local development.

Do not commit a real OpenAI key to GitLab.
Do not publish a Docker image containing a real key.
"""

from __future__ import annotations


# =========================================================
# OpenAI credential
# مقدار همان OPENAI_API_KEY موجود در فایل .env را قرار دهید.
# =========================================================

OPENAI_API_KEY = "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"


# =========================================================
# OpenAI defaults
# =========================================================

DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
DEFAULT_OPENAI_MODEL = "gpt-4.1-mini"

# Timeout for each individual OpenAI request.
DEFAULT_REQUEST_TIMEOUT_MS = 180_000

# Retry only temporary network, timeout, rate-limit and server failures.
DEFAULT_MAX_RETRIES = 2


# =========================================================
# Multi-pass analysis defaults
# =========================================================

DEFAULT_MAX_BATCHES = 4
DEFAULT_BATCH_CHARS = 50_000
DEFAULT_CRITIC_ENABLED = True


# =========================================================
# Report configuration
# =========================================================

DEFAULT_OUTPUT_LANGUAGE = "fa"
DEFAULT_REPORT_LOCALE = "fa-IR"
PIPELINE_VERSION = "3.0.0"


def validate_settings() -> None:
    """Validate static pipeline settings before contacting OpenAI."""

    api_key = OPENAI_API_KEY.strip()

    if not api_key or api_key == "PUT_YOUR_EXISTING_OPENAI_KEY_HERE":
        raise RuntimeError(
            "OPENAI_API_KEY_NOT_CONFIGURED: "
            "Set OPENAI_API_KEY in "
            "python/repository_analysis/settings.py."
        )

    if not api_key.startswith("sk-"):
        raise RuntimeError(
            "OPENAI_API_KEY_INVALID_FORMAT: "
            "The configured key does not start with 'sk-'."
        )

    if DEFAULT_REQUEST_TIMEOUT_MS <= 0:
        raise RuntimeError(
            "OPENAI_TIMEOUT_INVALID: "
            "DEFAULT_REQUEST_TIMEOUT_MS must be greater than zero."
        )

    if DEFAULT_MAX_RETRIES < 0:
        raise RuntimeError(
            "OPENAI_RETRY_COUNT_INVALID: "
            "DEFAULT_MAX_RETRIES cannot be negative."
        )

    if DEFAULT_MAX_BATCHES <= 0:
        raise RuntimeError(
            "AI_MAX_BATCHES_INVALID: "
            "DEFAULT_MAX_BATCHES must be greater than zero."
        )

    if DEFAULT_BATCH_CHARS < 1_000:
        raise RuntimeError(
            "AI_BATCH_SIZE_INVALID: "
            "DEFAULT_BATCH_CHARS must be at least 1000."
        )

