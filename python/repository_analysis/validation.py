from __future__ import annotations

from typing import Any, List, Mapping, Sequence

from .utils import as_dict, as_list, unique_strings


def validate_final_result(
    result: Mapping[str, Any],
    requirements: Sequence[Mapping[str, Any]],
) -> List[str]:
    errors: List[str] = []
    required_top_level = [
        "classification",
        "confidence",
        "summary",
        "layers",
        "modules",
        "strengths",
        "concerns",
        "evidence",
        "readinessAssessment",
        "scalabilityAssessment",
        "codeReviewAssessment",
        "executiveReport",
        "technicalReport",
    ]
    for key in required_top_level:
        if key not in result:
            errors.append(f"missing top-level field: {key}")

    readiness = as_dict(result.get("readinessAssessment"))
    matches = [as_dict(item) for item in as_list(readiness.get("matchedExpectations"))]
    expected_ids = unique_strings([item.get("id") for item in requirements], 1000)
    actual_ids = unique_strings([item.get("id") for item in matches], 1000)
    if expected_ids and set(expected_ids) != set(actual_ids):
        missing = sorted(set(expected_ids) - set(actual_ids))
        duplicate_or_extra = sorted(set(actual_ids) - set(expected_ids))
        if missing:
            errors.append(f"missing requirement IDs: {missing}")
        if duplicate_or_extra:
            errors.append(f"unexpected requirement IDs: {duplicate_or_extra}")
        if len(matches) != len(expected_ids):
            errors.append(
                f"matchedExpectations count {len(matches)} does not equal requirement count {len(expected_ids)}"
            )

    for field in ("executiveReport", "technicalReport"):
        if not isinstance(result.get(field), str) or not str(result.get(field)).strip():
            errors.append(f"{field} is empty")

    if not isinstance(result.get("layers"), list):
        errors.append("layers must be an array")
    if not isinstance(result.get("evidence"), list):
        errors.append("evidence must be an array")
    if not isinstance(result.get("scalabilityAssessment"), dict):
        errors.append("scalabilityAssessment must be an object")
    if not isinstance(result.get("codeReviewAssessment"), dict):
        errors.append("codeReviewAssessment must be an object")

    return errors


def collect_referenced_paths(result: Mapping[str, Any]) -> List[str]:
    paths: List[Any] = []
    paths.extend(as_list(result.get("evidence")))
    readiness = as_dict(result.get("readinessAssessment"))
    for item in as_list(readiness.get("matchedExpectations")):
        paths.extend(as_list(as_dict(item).get("evidence")))
    for item in as_list(readiness.get("recommendations")):
        paths.extend(as_list(as_dict(item).get("evidence")))
    review = as_dict(result.get("codeReviewAssessment"))
    for item in as_list(review.get("findings")):
        paths.extend(as_list(as_dict(item).get("evidencePaths")))
    return unique_strings(paths, 500)


def calculate_evidence_coverage(result: Mapping[str, Any]) -> int:
    matches = as_list(as_dict(result.get("readinessAssessment")).get("matchedExpectations"))
    if not matches:
        return 0
    supported = 0
    for item in matches:
        record = as_dict(item)
        if str(record.get("status") or "unknown") != "unknown" and unique_strings(as_list(record.get("evidence")), 20):
            supported += 1
    return round((supported / len(matches)) * 100)
