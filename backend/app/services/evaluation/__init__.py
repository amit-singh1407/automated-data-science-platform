"""Evaluation of ECP against injected errors (thesis Chapter 4)."""
from .inject import CELL_ERRORS, ERROR_TYPES, ROW_ERRORS, Corrupted, build_reference, inject_errors
from .methods import METHODS, MethodOutput
from .metrics import score
from .runner import markdown_by_type, markdown_table, run_evaluation

__all__ = [
    "CELL_ERRORS", "Corrupted", "ERROR_TYPES", "METHODS", "MethodOutput", "ROW_ERRORS",
    "build_reference", "inject_errors", "markdown_by_type", "markdown_table", "run_evaluation", "score",
]
