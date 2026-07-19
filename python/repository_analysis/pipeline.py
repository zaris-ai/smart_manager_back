from __future__ import annotations

import time
from typing import Any, Dict, Mapping

from . import PIPELINE_VERSION
from .batching import build_file_batches
from .engine import PipelineRunner, PipelineState
from .errors import fail
from .openai_client import OpenAIJsonClient
from .settings import DEFAULT_BATCH_CHARS, DEFAULT_CRITIC_ENABLED, DEFAULT_MAX_BATCHES
from .stages import (
    criticize_candidate,
    extract_requirements,
    finalize_report,
    repair_final_result,
    review_batch,
    synthesize_candidate,
)
from .utils import as_dict, as_list, unique_strings
from .validation import calculate_evidence_coverage, collect_referenced_paths, validate_final_result


def run_pipeline(payload: Mapping[str, Any]) -> Dict[str, Any]:
    started = time.monotonic()
    config = as_dict(payload.get("config"))
    context = as_dict(payload.get("context"))
    files = [as_dict(item) for item in as_list(context.get("inspectedFiles"))]
    repository_paths = unique_strings(as_list(context.get("repositoryPaths")), 100_000)
    max_batches = max(1, min(12, int(config.get("maxBatches") or DEFAULT_MAX_BATCHES)))
    batch_chars = max(20_000, min(250_000, int(config.get("batchChars") or DEFAULT_BATCH_CHARS)))
    critic_enabled = bool(config.get("criticEnabled", DEFAULT_CRITIC_ENABLED))

    client = OpenAIJsonClient(config)
    state = PipelineState(config=dict(config), context=dict(context))
    runner = PipelineRunner()

    state.requirements = runner.run_stage(
        state=state,
        name="ai_requirements_extraction",
        percent=74,
        message="Extracting atomic requirements and KPIs",
        handler=lambda current: extract_requirements(client, current.context),
    )

    state.batches = build_file_batches(files, max_batches=max_batches, batch_chars=batch_chars)
    state.reviews = runner.run_loop(
        state=state,
        name="ai_evidence_review",
        items=state.batches,
        percent_start=76,
        percent_end=86,
        message=lambda index, total: f"Reviewing evidence batch {index}/{total}",
        handler=lambda current, batch, index, total: review_batch(
            client,
            batch_index=index,
            batch_count=total,
            files=batch,
            inventory=as_dict(current.context.get("inventory")),
            packages=[as_dict(item) for item in as_list(current.context.get("packages"))],
            frameworks=as_list(current.context.get("frameworks")),
            requirements=current.requirements,
            repository_paths=repository_paths,
        ),
    )

    state.candidate = runner.run_stage(
        state=state,
        name="ai_candidate_synthesis",
        percent=88,
        message="Synthesizing candidate assessment",
        handler=lambda current: synthesize_candidate(
            client, context=current.context, requirements=current.requirements, reviews=current.reviews
        ),
    )

    if critic_enabled:
        state.critique = runner.run_stage(
            state=state,
            name="ai_critic_review",
            percent=93,
            message="Challenging unsupported conclusions",
            handler=lambda current: criticize_candidate(
                client, context=current.context, requirements=current.requirements, candidate=current.candidate
            ),
        )
    else:
        state.critique = {
            "verdict": "not_run",
            "unsupportedClaims": [],
            "invalidEvidence": [],
            "missedRequirements": [],
            "contradictions": [],
            "scoreProblems": [],
            "mandatoryCorrections": [],
            "missingEvidenceItems": [],
        }

    state.final = runner.run_stage(
        state=state,
        name="ai_final_synthesis",
        percent=97,
        message="Producing final Persian report",
        handler=lambda current: finalize_report(
            client,
            context=current.context,
            requirements=current.requirements,
            candidate=current.candidate,
            critique=current.critique,
        ),
    )

    validation_errors = validate_final_result(state.final, state.requirements)
    if validation_errors:
        state.final = runner.run_stage(
            state=state,
            name="ai_schema_repair",
            percent=98,
            message="Repairing incomplete structured output",
            handler=lambda current: repair_final_result(
                client,
                context=current.context,
                requirements=current.requirements,
                candidate=current.candidate,
                critique=current.critique,
                invalid_result=current.final,
                validation_errors=validation_errors,
            ),
        )
        remaining_errors = validate_final_result(state.final, state.requirements)
        if remaining_errors:
            fail(
                "OPENAI_INVALID_MULTI_PASS_RESULT",
                "Final multi-pass audit did not satisfy the required structure.",
                remaining_errors,
            )

    critic_verdict = str(state.critique.get("verdict") or ("not_run" if not critic_enabled else "approved_with_caveats"))
    if critic_verdict not in {"approved", "approved_with_caveats", "rejected", "not_run"}:
        critic_verdict = "approved_with_caveats"

    unsupported_count = len(as_list(state.critique.get("unsupportedClaims"))) + len(
        as_list(state.critique.get("invalidEvidence"))
    )
    missing_evidence = unique_strings(
        as_list(state.critique.get("missingEvidenceItems")) + as_list(state.critique.get("missedRequirements")),
        100,
    )

    metadata = {
        "engine": "python_multi_pass",
        "pipelineVersion": PIPELINE_VERSION,
        "passes": state.passes,
        "moduleBatches": len(state.batches),
        "requirementCount": len(state.requirements),
        "evidenceCoveragePercent": calculate_evidence_coverage(state.final),
        "referencedFiles": collect_referenced_paths(state.final),
        "criticVerdict": critic_verdict,
        "unsupportedClaimsRemoved": unsupported_count,
        "missingEvidenceItems": missing_evidence,
        "durationMs": round((time.monotonic() - started) * 1000),
        "modelCalls": client.total_calls,
    }

    return {"result": state.final, "metadata": metadata, "model": client.model}
