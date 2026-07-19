from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, List, Mapping, MutableMapping, Sequence


def compact_file(file_record: Mapping[str, Any], max_chars: int) -> Dict[str, Any]:
    content = str(file_record.get("content") or "")
    if len(content) > max_chars:
        content = content[:max_chars] + "\n/* [TRUNCATED BY AUDIT PIPELINE] */"
    return {
        "path": str(file_record.get("path") or ""),
        "purpose": str(file_record.get("purpose") or "source"),
        "content": content,
    }


def build_file_batches(files: Sequence[Mapping[str, Any]], max_batches: int, batch_chars: int) -> List[List[Dict[str, Any]]]:
    manifests = [compact_file(item, min(batch_chars, 120_000)) for item in files if item.get("purpose") == "manifest"]
    sources = [compact_file(item, min(batch_chars // 2, 70_000)) for item in files if item.get("purpose") != "manifest"]

    grouped: MutableMapping[str, List[Dict[str, Any]]] = defaultdict(list)
    for item in sources:
        path = item["path"]
        parts = path.split("/")
        group = "/".join(parts[:2]) if len(parts) > 2 else (parts[0] if parts else "root")
        grouped[group].append(item)

    batches: List[List[Dict[str, Any]]] = []
    current: List[Dict[str, Any]] = []
    current_chars = 0

    def flush() -> None:
        nonlocal current, current_chars
        if current:
            batches.append(current)
            current = []
            current_chars = 0

    for _, group_files in sorted(grouped.items(), key=lambda pair: pair[0]):
        group_chars = sum(len(str(item.get("content") or "")) for item in group_files)
        if current and current_chars + group_chars > batch_chars:
            flush()
        for item in group_files:
            item_chars = len(str(item.get("content") or ""))
            if current and current_chars + item_chars > batch_chars:
                flush()
            current.append(item)
            current_chars += item_chars
        if len(batches) >= max_batches:
            break
    flush()

    if not batches:
        batches = [[]]

    # Include compact manifests in every batch so module reviewers know the stack,
    # while limiting total manifest context.
    manifest_chars = 0
    shared_manifests: List[Dict[str, Any]] = []
    for manifest in manifests:
        chars = len(str(manifest.get("content") or ""))
        if manifest_chars + chars > min(batch_chars // 2, 120_000):
            break
        shared_manifests.append(manifest)
        manifest_chars += chars

    return [(shared_manifests + batch) for batch in batches[:max_batches]]
