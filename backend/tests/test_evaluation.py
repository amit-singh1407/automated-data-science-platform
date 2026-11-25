import numpy as np
import pandas as pd
import pytest

from app.services.evaluation import (
    CELL_ERRORS, ERROR_TYPES, METHODS, MethodOutput, build_reference, inject_errors, run_evaluation, score,
)


def synthetic_orders(invoices: int = 400, seed: int = 7) -> pd.DataFrame:
    """Realistic-looking order lines: products with stable names and prices,
    customers with a home country, 2-8 lines per invoice."""
    rng = np.random.default_rng(seed)
    products = [(f"{20000 + p}", f"PRODUCT NUMBER {p} GIFT", float(rng.choice([0.85, 1.25, 2.55, 4.95, 7.95])))
                for p in range(60)]
    countries = ["United Kingdom"] * 6 + ["France", "Germany", "Spain"]
    customers = {c: countries[c % len(countries)] for c in range(12000, 12150)}
    rows = []
    for i in range(invoices):
        customer = int(rng.choice(list(customers)))
        for p in rng.choice(len(products), size=int(rng.integers(2, 9)), replace=False):
            code, name, price = products[p]
            rows.append([str(540000 + i), code, name, int(rng.choice([1, 2, 3, 4, 6, 12])),
                         f"2011-03-{1 + i % 28:02d} 10:00", price, float(customer), customers[customer]])
    return pd.DataFrame(rows, columns=["InvoiceNo", "StockCode", "Description", "Quantity",
                                       "InvoiceDate", "UnitPrice", "CustomerID", "Country"])


@pytest.fixture(scope="module")
def reference():
    ref, info = build_reference(synthetic_orders())
    assert info["rows"] == len(ref) > 1500
    return ref


def test_injection_adds_each_type_once_per_row(reference):
    corrupted = inject_errors(reference, rate=0.18, seed=1)
    errors = corrupted.cell_errors
    assert set(errors["type"]) == set(CELL_ERRORS)
    assert errors["input_row"].is_unique  # one error per row
    assert len(corrupted.duplicate_types) + len(errors) == pytest.approx(0.18 * len(reference), abs=9)
    # Duplicates sit right after their source row.
    for row in corrupted.duplicate_types:
        assert corrupted.source[row] == corrupted.source[row - 1]
    # The bad value really is in the corrupted frame, and differs from the truth.
    for _, e in errors.iterrows():
        bad = corrupted.frame.at[e.input_row, e.column]
        assert (pd.isna(bad) and pd.isna(e.bad_value)) or bad == e.bad_value
        assert not (pd.isna(bad) and pd.isna(e.true_value)) and bad != e.true_value


def test_scorer_gives_a_perfect_cleaner_full_marks(reference):
    corrupted = inject_errors(reference, rate=0.1, seed=2)
    genuine = np.flatnonzero(~corrupted.injected_duplicate)
    oracle = MethodOutput(reference.iloc[corrupted.source[genuine]].reset_index(drop=True), genuine)
    result = score(reference, corrupted, oracle)
    assert result["repair_precision"] == 1.0
    assert result["repair_recall"] == 1.0
    assert result["rows_kept"] == 1.0
    assert result["clean_cells_damaged"] == 0
    assert result["invoices_within_1pct"] == 1.0


def test_scorer_gives_no_cleaning_nothing(reference):
    corrupted = inject_errors(reference, rate=0.1, seed=3)
    result = score(reference, corrupted, METHODS["No cleaning"](corrupted.frame, 3))
    assert result["repair_recall"] == 0.0
    assert result["repair_precision"] is None  # no actions taken
    assert result["invoices_within_1pct"] < 1.0


def test_ecp_beats_the_baselines_and_keeps_every_genuine_row(reference):
    results = run_evaluation(
        pd.DataFrame(), reference=reference, rates=[0.1], seeds=[4], progress=lambda _: None,
        methods=["ECP", "Naive deletion", "IQR statistics", "Isolation Forest", "ECP without dependency repair (S5)"],
    )
    by_method = {s["method"]: s for s in results["summary"]}
    ecp = by_method["ECP"]
    assert ecp["rows_kept"] == 1.0
    assert ecp["repair_precision"] > 0.95
    assert ecp["repair_f1"] > 0.8
    for baseline in ("Naive deletion", "IQR statistics", "Isolation Forest"):
        assert ecp["repair_f1"] > by_method[baseline]["repair_f1"], baseline
    assert ecp["repair_f1"] > by_method["ECP without dependency repair (S5)"]["repair_f1"]
    assert by_method["Naive deletion"]["rows_kept"] < 1.0


def test_every_error_type_is_documented():
    assert len(ERROR_TYPES) == 9
    assert all(text.endswith(".") for text in ERROR_TYPES.values())
