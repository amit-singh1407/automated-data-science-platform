"""Command line: reproduce the thesis evaluation (Chapter 4).

Example (from the backend folder):

    python -m app.services.evaluation "Online Retail.xlsx" --rates 0.02,0.05,0.1,0.2,0.3 --seeds 0,1,2,3,4 --out evaluation.json

Run with --list to see the method names for --methods.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from app.services.file_storage import load_dataframe

from .inject import ERROR_TYPES
from .methods import METHODS
from .runner import markdown_by_type, markdown_table, run_evaluation


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate ECP against baselines on injected errors.")
    parser.add_argument("data", nargs="?", type=Path, help="Order data (CSV, XLSX, Parquet or a pandas .pkl).")
    parser.add_argument("--rates", default="0.10", help="Comma-separated error rates, e.g. 0.02,0.1,0.3")
    parser.add_argument("--seeds", default="0", help="Comma-separated random seeds, e.g. 0,1,2,3,4")
    parser.add_argument("--methods", default="", help="Comma-separated method names (default: all).")
    parser.add_argument("--out", type=Path, help="Write all results as JSON to this file.")
    parser.add_argument("--list", action="store_true", help="List methods and error types, then exit.")
    args = parser.parse_args()

    if args.list or args.data is None:
        print("Methods:\n" + "\n".join(f"  {name}" for name in METHODS))
        print("\nError types:\n" + "\n".join(f"  {name}: {text}" for name, text in ERROR_TYPES.items()))
        return

    raw = pd.read_pickle(args.data) if args.data.suffix == ".pkl" else load_dataframe(args.data)
    results = run_evaluation(
        raw,
        rates=[float(r) for r in args.rates.split(",") if r.strip()],
        seeds=[int(s) for s in args.seeds.split(",") if s.strip()],
        methods=[m.strip() for m in args.methods.split(",") if m.strip()] or None,
    )
    print("\n" + markdown_table(results["summary"]))
    print("\nECP repair recall by error type:\n" + markdown_by_type(results["summary"]))
    if args.out:
        args.out.write_text(json.dumps(results, indent=2, default=str), encoding="utf-8")
        print(f"\nWrote {args.out}")


if __name__ == "__main__":
    main()
