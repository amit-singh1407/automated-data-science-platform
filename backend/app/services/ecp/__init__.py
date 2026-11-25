"""ECP: the E-commerce Cleaning Pipeline (S1-S7), implemented from the thesis."""
from .config import ECPConfig, detect_columns
from .runner import SIDE_TABLES, STAGE_NAMES, ECPResult, run_ecp

__all__ = ["ECPConfig", "ECPResult", "SIDE_TABLES", "STAGE_NAMES", "detect_columns", "run_ecp"]
