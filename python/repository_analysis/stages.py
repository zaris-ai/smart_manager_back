from __future__ import annotations

from typing import Any, Dict, List, Mapping, Sequence

from .openai_client import OpenAIJsonClient
from .utils import as_dict, as_list, unique_strings


def extract_requirements(client: OpenAIJsonClient, context: Mapping[str, Any]) -> List[Dict[str, Any]]:
    expectations = as_dict(context.get("expectations"))
    content = str(expectations.get("content") or "").strip()
    metadata = as_dict(expectations.get("metadata"))
    if not content and not metadata.get("provided"):
        return []

    result = client.call_json(
        stage="requirements_extraction",
        role="Requirements and KPI Analyst",
        task=(
            "Extract every material expectation into atomic, testable requirements. Preserve explicit KPI IDs when present. "
            "Do not merge unrelated requirements. Return {requirements:[...]}. Each item must contain id, category, priority, "
            "hardGate, expectation, acceptanceCriteria, and evidenceNeeded. priority is critical/high/medium/low. hardGate is boolean. "
            "Use concise Persian for expectation and acceptanceCriteria. Do not decide implementation status in this pass."
        ),
        context={"expectations": expectations},
        max_output_tokens=7000,
    )
    requirements = []
    for index, item in enumerate(as_list(result.get("requirements"))[:160], start=1):
        record = as_dict(item)
        expectation = str(record.get("expectation") or "").strip()
        if not expectation:
            continue
        priority = str(record.get("priority") or "medium")
        if priority not in {"critical", "high", "medium", "low"}:
            priority = "medium"
        requirements.append(
            {
                "id": str(record.get("id") or f"REQ-{index:03d}").strip(),
                "category": str(record.get("category") or "general").strip(),
                "priority": priority,
                "hardGate": bool(record.get("hardGate", priority == "critical")),
                "expectation": expectation,
                "acceptanceCriteria": str(record.get("acceptanceCriteria") or "").strip(),
                "evidenceNeeded": unique_strings(as_list(record.get("evidenceNeeded")), 12),
            }
        )
    return requirements


def review_batch(
    client: OpenAIJsonClient,
    *,
    batch_index: int,
    batch_count: int,
    files: Sequence[Mapping[str, Any]],
    inventory: Mapping[str, Any],
    packages: Sequence[Mapping[str, Any]],
    frameworks: Sequence[Any],
    requirements: Sequence[Mapping[str, Any]],
    repository_paths: Sequence[str],
) -> Dict[str, Any]:
    batch_paths = [str(item.get("path") or "") for item in files]
    return client.call_json(
        stage=f"evidence_review_batch_{batch_index}",
        role=f"Repository Evidence Reviewer {batch_index}/{batch_count}",
        task=(
            "Inspect this file batch and extract evidence, not final conclusions. Return fields: batchSummary, architectureSignals, "
            "requirementEvidence, codeFindings, scalabilitySignals, securitySignals, reliabilitySignals, missingEvidence. "
            "Each requirementEvidence item must contain requirementId, statusCandidate (met/partial/not_met/unknown), evidencePaths, explanation. "
            "Each codeFinding must contain severity, category, title, description, evidencePaths, recommendation. "
            "Only cite exact paths from batchPaths. A missing implementation is not proven merely because it is absent from this batch; mark unknown "
            "unless repository-wide inventory or manifests make absence reliable. Critical/high findings require exact file evidence."
        ),
        context={
            "batchIndex": batch_index,
            "batchCount": batch_count,
            "batchPaths": batch_paths,
            "files": files,
            "inventory": inventory,
            "packages": list(packages)[:500],
            "frameworks": list(frameworks),
            "requirements": list(requirements),
            "repositoryPaths": list(repository_paths),
        },
        max_output_tokens=8500,
    )


def synthesize_candidate(
    client: OpenAIJsonClient,
    *,
    context: Mapping[str, Any],
    requirements: Sequence[Mapping[str, Any]],
    reviews: Sequence[Mapping[str, Any]],
) -> Dict[str, Any]:
    return client.call_json(
        stage="candidate_synthesis",
        role="Principal Software Architect and Audit Synthesizer",
        task=(
            "Build a candidate audit from the requirements, deterministic scanner output, and batch evidence. Return exactly these top-level fields: "
            "classification, confidence, summary, layers, modules, strengths, concerns, evidence, readinessAssessment, scalabilityAssessment, "
            "codeReviewAssessment, executiveReport, technicalReport. readinessAssessment fields: verdict, score, confidence, summary, "
            "matchedExpectations, blockers, gaps, recommendations. Every matchedExpectations item must contain id, category, priority, hardGate, "
            "expectation, status, evidence, explanation. status is met/partial/not_met/unknown. Every recommendation contains priority, title, "
            "description, suggestedSolution, evidence. scalabilityAssessment fields: verdict, confidence, summary, workloadAssumptions, strengths, "
            "bottlenecks, capacityRisks, recommendedArchitecture, validationPlan. codeReviewAssessment fields: overallScore, summary, "
            "maintainabilityScore, reliabilityScore, securityScore, performanceScore, strengths, findings. Each finding contains severity, category, "
            "title, description, evidencePaths, recommendation. Do not claim exact capacity. Because no runtime tests were executed, readiness cannot be "
            "more certain than conditionally_ready and scalability cannot be more certain than conditionally_sufficient. Use unknown whenever evidence "
            "does not establish a requirement. Cite only repository paths supplied in repositoryPaths."
        ),
        context={
            "expectations": context.get("expectations"),
            "workloadTargets": as_dict(as_dict(context.get("expectations")).get("metadata")).get("workloadTargets", {}),
            "requirements": list(requirements),
            "inventory": context.get("inventory"),
            "packages": context.get("packages"),
            "frameworks": context.get("frameworks"),
            "deterministicArchitecture": context.get("deterministicArchitecture"),
            "deterministicReadinessAssessment": context.get("deterministicReadinessAssessment"),
            "deterministicScalabilityAssessment": context.get("deterministicScalabilityAssessment"),
            "deterministicCodeReviewAssessment": context.get("deterministicCodeReviewAssessment"),
            "repositoryPaths": context.get("repositoryPaths"),
            "batchReviews": list(reviews),
        },
        max_output_tokens=12000,
    )


def criticize_candidate(
    client: OpenAIJsonClient,
    *,
    context: Mapping[str, Any],
    requirements: Sequence[Mapping[str, Any]],
    candidate: Mapping[str, Any],
) -> Dict[str, Any]:
    return client.call_json(
        stage="critic_review",
        role="Adversarial Audit Reviewer",
        task=(
            "Challenge the candidate audit. Do not rewrite the final report. Return verdict (approved/approved_with_caveats/rejected), "
            "unsupportedClaims, invalidEvidence, missedRequirements, contradictions, scoreProblems, mandatoryCorrections, missingEvidenceItems. "
            "A claim is unsupported if its cited path does not exist, if the cited file does not support it, if absence from selected files is treated "
            "as proof of absence, or if a runtime/capacity conclusion is stated without measurements. Confirm that all requirements are represented "
            "exactly once and that hard-gate failures affect the readiness verdict. Confirm that critical/high code findings have exact evidence paths."
        ),
        context={
            "requirements": list(requirements),
            "candidate": candidate,
            "repositoryPaths": context.get("repositoryPaths"),
            "selectedFiles": [
                {"path": item.get("path"), "content": item.get("content")}
                for item in as_list(context.get("inspectedFiles"))
            ],
            "scopeLimitations": [
                "No build or execution",
                "No automated tests run",
                "No load test",
                "No penetration test",
                "Only selected source files were read",
            ],
        },
        max_output_tokens=8000,
    )


def finalize_report(
    client: OpenAIJsonClient,
    *,
    context: Mapping[str, Any],
    requirements: Sequence[Mapping[str, Any]],
    candidate: Mapping[str, Any],
    critique: Mapping[str, Any],
) -> Dict[str, Any]:
    return client.call_json(
        stage="final_synthesis",
        role="Final Evidence Gate and Persian Technical Editor",
        task=(
            "Produce the final corrected audit JSON. Apply every valid mandatory correction and remove unsupported claims. Return exactly these top-level "
            "fields: classification, confidence, summary, layers, modules, strengths, concerns, evidence, readinessAssessment, scalabilityAssessment, "
            "codeReviewAssessment, executiveReport, technicalReport. Preserve modules from deterministicArchitecture exactly. Represent every extracted "
            "requirement once. Critical/high findings without exact path evidence must be removed or downgraded to info and explicitly marked as a review "
            "question. Do not claim exact user capacity or production readiness. The executive report must be concise and decision-oriented. The technical "
            "report must contain: scope, evidence reviewed, requirement gaps, architecture findings, scalability risks, code-review findings, ordered "
            "remediation plan, and validation plan. All prose in Persian."
        ),
        context={
            "requirements": list(requirements),
            "candidate": candidate,
            "critique": critique,
            "deterministicArchitecture": context.get("deterministicArchitecture"),
            "deterministicReadinessAssessment": context.get("deterministicReadinessAssessment"),
            "deterministicScalabilityAssessment": context.get("deterministicScalabilityAssessment"),
            "deterministicCodeReviewAssessment": context.get("deterministicCodeReviewAssessment"),
            "repositoryPaths": context.get("repositoryPaths"),
        },
        max_output_tokens=14000,
    )


def repair_final_result(
    client: OpenAIJsonClient,
    *,
    context: Mapping[str, Any],
    requirements: Sequence[Mapping[str, Any]],
    candidate: Mapping[str, Any],
    critique: Mapping[str, Any],
    invalid_result: Mapping[str, Any],
    validation_errors: Sequence[str],
) -> Dict[str, Any]:
    return client.call_json(
        stage="structured_output_repair",
        role="Strict JSON Audit Output Repairer",
        task=(
            "Repair the invalid final audit. Return the complete final JSON object, not a patch. Preserve supported conclusions, apply all reviewer "
            "corrections, and resolve every validation error. Represent every requirement ID exactly once in readinessAssessment.matchedExpectations. "
            "Use unknown when evidence is missing. Keep all prose Persian and all technical paths unchanged. Required top-level fields are: "
            "classification, confidence, summary, layers, modules, strengths, concerns, evidence, readinessAssessment, scalabilityAssessment, "
            "codeReviewAssessment, executiveReport, technicalReport."
        ),
        context={
            "validationErrors": list(validation_errors),
            "requirements": list(requirements),
            "candidate": candidate,
            "critique": critique,
            "invalidFinalResult": invalid_result,
            "deterministicArchitecture": context.get("deterministicArchitecture"),
            "repositoryPaths": context.get("repositoryPaths"),
        },
        max_output_tokens=14000,
    )
