from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Generic, Iterable, List, Mapping, Sequence, TypeVar

from .protocol import emit_progress

T = TypeVar("T")


@dataclass
class PipelineState:
    config: Dict[str, Any]
    context: Dict[str, Any]
    requirements: List[Dict[str, Any]] = field(default_factory=list)
    batches: List[List[Dict[str, Any]]] = field(default_factory=list)
    reviews: List[Dict[str, Any]] = field(default_factory=list)
    candidate: Dict[str, Any] = field(default_factory=dict)
    critique: Dict[str, Any] = field(default_factory=dict)
    final: Dict[str, Any] = field(default_factory=dict)
    passes: List[str] = field(default_factory=list)


class PipelineRunner:
    """Small deterministic stage/loop runner.

    Add future AI loops through ``run_loop`` instead of embedding control flow
    into the process entrypoint. The runner emits the same JSON-line progress
    protocol consumed by Node.js.
    """

    def run_stage(
        self,
        *,
        state: PipelineState,
        name: str,
        percent: int,
        message: str,
        handler: Callable[[PipelineState], T],
    ) -> T:
        emit_progress(name, percent, message)
        result = handler(state)
        state.passes.append(name)
        return result

    def run_loop(
        self,
        *,
        state: PipelineState,
        name: str,
        items: Sequence[T],
        percent_start: int,
        percent_end: int,
        handler: Callable[[PipelineState, T, int, int], Any],
        message: Callable[[int, int], str],
    ) -> List[Any]:
        results: List[Any] = []
        total = max(1, len(items))
        if not items:
            state.passes.append(name)
            return results
        for index, item in enumerate(items, start=1):
            ratio = index / total
            percent = percent_start + round((percent_end - percent_start) * ratio)
            emit_progress(name, percent, message(index, len(items)))
            results.append(handler(state, item, index, len(items)))
        state.passes.append(name)
        return results
