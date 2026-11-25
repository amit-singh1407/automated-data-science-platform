"""Clean reference and error injection (thesis Chapter 3, "How it was tested").

The thesis describes nine error types added at 2-30% "following the BART
method", one error per row, two of which add rows (duplicates) while seven
change a cell. The exact definitions below are this implementation's
reading of that description; they are listed in ERROR_TYPES so they can be
compared with (and corrected against) the thesis text.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from app.services.ecp import ECPConfig, detect_columns, run_ecp

ERROR_TYPES: dict[str, str] = {
    "exact_duplicate": "A copy of a sales line is added right after it (e.g. a refreshed payment page).",
    "near_duplicate": "A copy is added with the description in lower case and with extra spaces.",
    "text_noise": "Description written in lower case with extra spaces.",
    "description_variant": "Description changed to a different spelling (one letter dropped).",
    "missing_customer": "Customer ID blanked on one line of an invoice that has other lines.",
    "wrong_country": "Country replaced by a different country on one line of an invoice that has other lines.",
    "price_decimal_slip": "Unit price multiplied or divided by 10 (e.g. 4.50 written as 45.00).",
    "zero_price": "Unit price set to 0.",
    "quantity_extra_zeros": "Quantity multiplied by 10 or 100.",
}
ROW_ERRORS = ("exact_duplicate", "near_duplicate")
CELL_ERRORS = tuple(t for t in ERROR_TYPES if t not in ROW_ERRORS)
ERROR_COLUMN_ROLE = {
    "text_noise": "description",
    "description_variant": "description",
    "missing_customer": "customer_id",
    "wrong_country": "country",
    "price_decimal_slip": "unit_price",
    "zero_price": "unit_price",
    "quantity_extra_zeros": "quantity",
}


def build_reference(raw: pd.DataFrame, config: ECPConfig | None = None) -> tuple[pd.DataFrame, dict]:
    """A clean reference made from real data: the ECP sales output, keeping
    only account-holder lines (guest lines have no customer ID to restore)
    that ECP did not flag for review and that have a price.

    The thesis notes that its reference was also built with rules similar to
    ECP's, which favours ECP; the same caveat applies here.
    """
    result = run_ecp(raw, config)
    cols = detect_columns(result.cleaned.columns)
    clean = result.cleaned
    flagged = set(result.review["row"]) if len(result.review) else set()
    keep = ~pd.Index(result.cleaned_rows).isin(flagged)
    keep &= clean[cols["customer_id"]].notna().to_numpy()
    keep &= clean[cols["unit_price"]].notna().to_numpy()
    if "description" in cols:
        keep &= clean[cols["description"]].notna().to_numpy()
    reference = clean[keep].reset_index(drop=True)
    return reference, {
        "rows": int(len(reference)),
        "source_rows": int(len(raw)),
        "ecp_sales_rows": int(len(clean)),
        "rule": "ECP sales output, account holders only, not flagged for review, with a price and description",
    }


@dataclass
class Corrupted:
    """A reference copy with injected errors.

    ``frame`` is what a cleaning method receives. For every row of ``frame``,
    ``source`` is the reference row it came from and ``injected_duplicate``
    says whether the row is an added duplicate. ``cell_errors`` has one row
    per changed cell: input_row, ref_row, type, column, true_value, bad_value.
    """
    frame: pd.DataFrame
    source: np.ndarray
    injected_duplicate: np.ndarray
    duplicate_types: dict[int, str]
    cell_errors: pd.DataFrame
    rate: float
    seed: int


def _noise(text: str, rng: np.random.Generator) -> str:
    words = text.lower().split(" ")
    if len(words) > 1:
        at = int(rng.integers(1, len(words)))
        words[at] = " " + words[at]
    return " " + " ".join(words) + "  "


def _variant(text: str, rng: np.random.Generator) -> str | None:
    letters = [i for i, ch in enumerate(text) if ch.isalpha()]
    if len(letters) < 4:
        return None
    drop = letters[int(rng.integers(1, len(letters)))]
    return text[:drop] + text[drop + 1:]


def inject_errors(reference: pd.DataFrame, rate: float, seed: int) -> Corrupted:
    """Add errors to ``rate`` of the reference rows, split evenly over the nine
    types, at most one error per row."""
    rng = np.random.default_rng(seed)
    cols = detect_columns(reference.columns)
    ref = reference.reset_index(drop=True)
    n = len(ref)
    total = int(round(rate * n))
    counts = {t: total // len(ERROR_TYPES) for t in ERROR_TYPES}
    for t in list(ERROR_TYPES)[: total % len(ERROR_TYPES)]:
        counts[t] += 1

    invoice_lines = ref.groupby(cols["invoice"])[cols["invoice"]].transform("size").to_numpy()
    product_rows = ref.groupby(cols["stock_code"])[cols["stock_code"]].transform("size").to_numpy()
    eligible = {
        "missing_customer": invoice_lines >= 2,        # the other lines still name the customer
        "wrong_country": invoice_lines >= 2,           # the other lines still name the country
        "description_variant": product_rows >= 3,      # other rows still carry the real name
        "price_decimal_slip": product_rows >= 5,       # enough rows to tell what is normal
        "quantity_extra_zeros": product_rows >= 5,
    }
    available = np.ones(n, dtype=bool)
    chosen: dict[str, np.ndarray] = {}
    for error_type in rng.permutation(list(ERROR_TYPES)):
        pool = np.flatnonzero(available & eligible.get(error_type, np.ones(n, dtype=bool)))
        take = rng.choice(pool, size=min(counts[error_type], len(pool)), replace=False)
        available[take] = False
        chosen[str(error_type)] = np.sort(take)

    corrupted = ref.copy()
    errors: list[dict] = []
    countries = ref[cols["country"]].dropna().unique()

    def set_cell(row: int, error_type: str, value) -> None:
        column = cols[ERROR_COLUMN_ROLE[error_type]]
        errors.append({"ref_row": row, "type": error_type, "column": column,
                       "true_value": ref.at[row, column], "bad_value": value})
        corrupted.at[row, column] = value

    description = cols["description"]
    for row in chosen["text_noise"]:
        set_cell(row, "text_noise", _noise(ref.at[row, description], rng))
    for row in chosen["description_variant"]:
        variant = _variant(ref.at[row, description], rng)
        if variant is not None:
            set_cell(row, "description_variant", variant)
    for row in chosen["missing_customer"]:
        set_cell(row, "missing_customer", np.nan)
    for row in chosen["wrong_country"]:
        others = countries[countries != ref.at[row, cols["country"]]]
        set_cell(row, "wrong_country", str(rng.choice(others)))
    for row in chosen["price_decimal_slip"]:
        price = float(ref.at[row, cols["unit_price"]])
        set_cell(row, "price_decimal_slip", round(price * 10 if rng.random() < 0.5 else price / 10, 4))
    for row in chosen["zero_price"]:
        set_cell(row, "zero_price", 0.0)
    for row in chosen["quantity_extra_zeros"]:
        set_cell(row, "quantity_extra_zeros", ref.at[row, cols["quantity"]] * int(rng.choice([10, 100])))

    # Insert duplicates right after their source row.
    duplicate_of = {int(r): "exact_duplicate" for r in chosen["exact_duplicate"]}
    duplicate_of.update({int(r): "near_duplicate" for r in chosen["near_duplicate"]})
    order: list[int] = []
    is_duplicate: list[bool] = []
    for row in range(n):
        order.append(row)
        is_duplicate.append(False)
        if row in duplicate_of:
            order.append(row)
            is_duplicate.append(True)
    frame = corrupted.iloc[order].reset_index(drop=True)
    source = np.asarray(order)
    injected = np.asarray(is_duplicate)
    duplicate_types: dict[int, str] = {}
    for input_row in np.flatnonzero(injected):
        error_type = duplicate_of[int(source[input_row])]
        duplicate_types[int(input_row)] = error_type
        if error_type == "near_duplicate":
            frame.at[input_row, description] = _noise(ref.at[source[input_row], description], rng)

    first_input_row = {int(src): i for i, src in reversed(list(enumerate(source)))}
    cell_errors = pd.DataFrame(errors, columns=["ref_row", "type", "column", "true_value", "bad_value"])
    cell_errors.insert(0, "input_row", cell_errors["ref_row"].map(first_input_row).astype("int64"))
    return Corrupted(frame, source, injected, duplicate_types, cell_errors, rate, seed)
