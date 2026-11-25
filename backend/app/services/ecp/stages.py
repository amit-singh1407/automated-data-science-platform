"""The seven ECP stages (thesis, Chapter 3).

Each stage receives the shared ECPContext, changes ``ctx.work`` only through
``ctx.change`` / ``ctx.move`` (so every change is audited) and returns a dict
of stage details for the summary.

The index of ``ctx.work`` is the 1-based row number in the uploaded file, so
audit, review and side-table entries can always be traced to the source row.
"""
from __future__ import annotations

import warnings
from difflib import SequenceMatcher
from typing import Any

import numpy as np
import pandas as pd

from .audit import AuditLog, ReviewQueue
from .config import (
    ADJUSTMENT_CODES,
    COUNTRY_ALIASES,
    FEE_CODES,
    KNOWN_COUNTRIES,
    PRODUCT_CODE_MIN_SHARE,
    PRODUCT_CODE_PATTERN,
    ECPConfig,
)

MAD_SCALE = 0.6745        # modified z-score: 0.6745 * (x - median) / MAD
MEAN_AD_SCALE = 1.253314  # fallback when MAD is 0: (x - median) / (1.253314 * MeanAD)


# ─── Shared state ─────────────────────────────────────────────────────────────
class ECPContext:
    def __init__(self, frame: pd.DataFrame, columns: dict[str, Any], config: ECPConfig) -> None:
        self.work = frame.copy()
        self.work.index = pd.RangeIndex(1, len(frame) + 1, name="row")
        self.cols = columns
        self.config = config
        self.audit = AuditLog()
        self.review = ReviewQueue()
        self.side_tables: dict[str, list[pd.DataFrame]] = {}
        self.dependency_rules: list[dict[str, Any]] = []
        self.uncertain_columns: list[dict[str, Any]] = []
        self.baseline: pd.DataFrame | None = None
        self.filled_price_revenue = 0.0

    def has(self, *roles: str) -> bool:
        return all(role in self.cols for role in roles)

    def col(self, role: str) -> Any:
        return self.cols[role]

    def change(
        self, stage: str, rows: pd.Index, column: Any, new_values: Any, reason: str, action: str
    ) -> int:
        """Set new values for ``rows`` in ``column`` and audit every cell."""
        if len(rows) == 0:
            return 0
        if isinstance(new_values, pd.Series):
            new_values = new_values.reindex(rows)
        old = self.work.loc[rows, column]
        self.audit.record(stage, rows, column, action, old, new_values, reason)
        self.work.loc[rows, column] = new_values
        return len(rows)

    def move(self, stage: str, mask: pd.Series, table: str, reason: str, action: str | None = None) -> int:
        """Move rows out of the sales data into a named side table."""
        rows = self.work.index[_mask(mask)]
        if len(rows) == 0:
            return 0
        moved = self.work.loc[rows].copy()
        moved["ecp_reason"] = reason
        self.side_tables.setdefault(table, []).append(moved)
        self.audit.record(stage, rows, None, action or f"move_to_{table}", None, None, reason)
        self.work = self.work.drop(index=rows)
        return len(rows)


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _mask(series: pd.Series) -> pd.Series:
    """Turn a nullable boolean series into a plain one (NA counts as False)."""
    return series.fillna(False).astype(bool)


def _is_text(series: pd.Series) -> bool:
    return pd.api.types.is_object_dtype(series) or pd.api.types.is_string_dtype(series)


def _as_float(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce").astype("float64")


def _identifier(value: Any) -> Any:
    if pd.isna(value):
        return np.nan
    if isinstance(value, (bool, np.bool_)):
        return str(value)
    if isinstance(value, (int, np.integer)):
        return str(int(value))
    if isinstance(value, (float, np.floating)):
        return str(int(value)) if float(value).is_integer() else str(value)
    return str(value)


def _as_identifier(series: pd.Series) -> pd.Series:
    """IDs are text: 17850.0 -> "17850", 536365 -> "536365"."""
    if pd.api.types.is_string_dtype(series) and not pd.api.types.is_object_dtype(series):
        return series
    return series.map(_identifier).astype(object)


def _standardise_text(series: pd.Series, upper: bool) -> pd.Series:
    """Return new values for the cells that change (trim, collapse spaces, upper case).

    Cells that become empty are returned as missing.
    """
    is_str = series.map(lambda value: isinstance(value, str)).astype(bool)
    original = series[is_str].astype(object)
    if original.empty:
        return original
    cleaned = original.str.replace(r"\s+", " ", regex=True).str.strip()
    if upper:
        cleaned = cleaned.str.upper()
    cleaned = cleaned.where(cleaned != "", np.nan)
    changed = (cleaned != original) | cleaned.isna()
    return cleaned[changed]


def _profile_columns(frame: pd.DataFrame) -> dict[str, dict[str, Any]]:
    return {
        str(column): {
            "dtype": str(frame[column].dtype),
            "blanks": int(frame[column].isna().sum()),
            "distinct": int(frame[column].nunique(dropna=True)),
        }
        for column in frame.columns
    }


def _modified_z(values: pd.Series, keys: list[pd.Series]) -> pd.DataFrame:
    """Per-group modified z-score of ``values`` (already on log scale).

    Returns z, the group median, the scale used and the group size for every
    row. Rows whose value or keys are missing get NaN.
    """
    grouped = values.groupby(keys, sort=False)
    median = grouped.transform("median")
    deviation = (values - median).abs()
    by_dev = deviation.groupby(keys, sort=False)
    mad = by_dev.transform("median")
    mean_ad = by_dev.transform("mean")
    size = grouped.transform("count")
    scale = pd.Series(
        np.where(mad > 0, mad / MAD_SCALE, np.where(mean_ad > 0, mean_ad * MEAN_AD_SCALE, np.nan)),
        index=values.index,
    )
    z = (values - median) / scale
    z = z.where(scale.notna(), 0.0)
    return pd.DataFrame({"z": z, "median": median, "scale": scale, "size": size.fillna(0)})


def _majority(frame: pd.DataFrame, determinant: Any, dependent: Any) -> pd.DataFrame:
    """For each determinant value: its most common dependent value (``value``),
    how many rows have it (``n``) and how many non-blank rows there are (``total``)."""
    known = frame.loc[frame[determinant].notna() & frame[dependent].notna(), [determinant, dependent]]
    if known.empty:
        return pd.DataFrame(columns=["value", "n", "total"])
    counts = known.groupby([determinant, dependent], sort=False).size().rename("n").reset_index()
    counts["total"] = counts.groupby(determinant)["n"].transform("sum")
    counts = counts.sort_values("n", ascending=False, kind="stable").drop_duplicates(determinant)
    return counts.rename(columns={dependent: "value"}).set_index(determinant)[["value", "n", "total"]]


# ─── S1 Profile ───────────────────────────────────────────────────────────────
def s1_profile(ctx: ECPContext, retail: bool = True) -> dict[str, Any]:
    """Count types, blanks and distinct values; fix data types.

    In generic mode only the profile is taken: without the order columns we
    cannot be sure which columns are IDs, so no types are changed.
    """
    before = _profile_columns(ctx.work)
    type_fixes: list[dict[str, Any]] = []
    if not retail:
        return {"columns": before, "type_fixes": type_fixes}

    for role in ("invoice", "stock_code", "customer_id"):
        if ctx.has(role):
            column = ctx.col(role)
            ctx.work[column] = _as_identifier(ctx.work[column])
            type_fixes.append({"column": str(column), "type": "text identifier"})

    for role in ("quantity", "unit_price"):
        if not ctx.has(role):
            continue
        column = ctx.col(role)
        raw = ctx.work[column]
        numeric = pd.to_numeric(raw, errors="coerce")
        failed = raw.notna() & numeric.isna()
        ctx.audit.record(
            "S1", ctx.work.index[failed], column, "blank_unparseable", raw[failed], None,
            "Value could not be read as a number, so it is treated as missing.",
        )
        valid = numeric.dropna()
        if role == "quantity" and (valid % 1 == 0).all():
            numeric = numeric.astype("Int64")
            target_type = "whole number"
        else:
            numeric = numeric.astype("float64")
            target_type = "decimal number"
        ctx.work[column] = numeric
        type_fixes.append({"column": str(column), "type": target_type, "unparseable": int(failed.sum())})

    if ctx.has("invoice_date"):
        column = ctx.col("invoice_date")
        raw = ctx.work[column]
        if _is_text(raw):
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                parsed = pd.to_datetime(raw, errors="coerce")
                if (raw.notna() & parsed.isna()).mean() > 0.05:
                    parsed = pd.to_datetime(raw, errors="coerce", format="mixed")
            failed = raw.notna() & parsed.isna()
            ctx.audit.record(
                "S1", ctx.work.index[failed], column, "blank_unparseable", raw[failed], None,
                "Value could not be read as a date, so it is treated as missing.",
            )
            ctx.work[column] = parsed
            type_fixes.append({"column": str(column), "type": "date and time", "unparseable": int(failed.sum())})

    if ctx.has("invoice", "quantity", "unit_price"):
        ctx.baseline = ctx.work[[ctx.col("quantity"), ctx.col("unit_price")]].copy()

    return {"columns": before, "type_fixes": type_fixes}


# ─── S2 Standardise ───────────────────────────────────────────────────────────
def _country_maps(values: pd.Series, config: ECPConfig) -> tuple[dict[str, str], dict[str, str]]:
    present = [value for value in values.dropna().unique() if isinstance(value, str)]
    alias_map = {
        value: COUNTRY_ALIASES[value.lower()]
        for value in present
        if value.lower() in COUNTRY_ALIASES and COUNTRY_ALIASES[value.lower()] != value
    }
    counts = values.replace(alias_map).value_counts()
    fuzzy_map: dict[str, str] = {}
    for value, count in counts.items():
        if str(value).lower() in KNOWN_COUNTRIES:
            continue  # a real country is never "corrected" into another one
        best: tuple[str, float] | None = None
        for candidate, candidate_count in counts.items():
            if candidate == value or candidate_count < config.fuzzy_dominance * count:
                continue
            similarity = SequenceMatcher(None, str(value).lower(), str(candidate).lower()).ratio()
            if similarity >= config.fuzzy_similarity and (best is None or similarity > best[1]):
                best = (str(candidate), similarity)
        if best is not None:
            fuzzy_map[str(value)] = best[0]
    return alias_map, fuzzy_map


def s2_standardise(ctx: ECPContext, retail: bool = True) -> dict[str, Any]:
    """Trim spaces, convert to upper case, map country names."""
    role_of = {column: role for role, column in ctx.cols.items()}
    upper_roles = {"invoice", "stock_code", "description"} if retail else set()
    per_column: dict[str, int] = {}

    for column in ctx.work.columns:
        if not _is_text(ctx.work[column]):
            continue
        upper = role_of.get(column) in upper_roles
        new_values = _standardise_text(ctx.work[column], upper=upper)
        reason = (
            "Trimmed spaces, collapsed repeated spaces and converted to upper case."
            if upper else "Trimmed spaces and collapsed repeated spaces."
        )
        changed = ctx.change("S2", new_values.index, column, new_values, reason, action="standardise")
        if changed:
            per_column[str(column)] = changed

    details: dict[str, Any] = {"cells_standardised": per_column}
    if retail and ctx.has("country"):
        column = ctx.col("country")
        alias_map, fuzzy_map = _country_maps(ctx.work[column], ctx.config)
        if not ctx.config.fuzzy_countries:
            fuzzy_map = {}
        for mapping, reason in (
            (alias_map, "Country name mapped with the alias table."),
            (fuzzy_map, "Rare country spelling mapped to a much more common, very similar name."),
        ):
            if not mapping:
                continue
            current = ctx.work[column]
            hit = current.isin(list(mapping))
            ctx.change("S2", ctx.work.index[hit], column, current[hit].map(mapping), reason, action="standardise")
        details["country_aliases_applied"] = alias_map
        details["country_fuzzy_matches"] = fuzzy_map
    return details


# ─── S3 Deduplicate ───────────────────────────────────────────────────────────
def s3_deduplicate(ctx: ECPContext) -> dict[str, Any]:
    """Remove exact duplicates. S2 ran first, so near-duplicates are caught too."""
    duplicated = ctx.work.duplicated(keep="first")
    removed = ctx.move(
        "S3", duplicated, "duplicates",
        "Exact duplicate of an earlier row after standardisation.",
        action="remove_duplicate",
    )
    return {"duplicates_removed": removed}


# ─── S4 Shop rules ────────────────────────────────────────────────────────────
def s4_shop_rules(ctx: ECPContext) -> dict[str, Any]:
    """Move returns, fees and stock adjustments to side tables; fix negative
    quantities; treat zero prices as missing."""
    invoice, stock = ctx.col("invoice"), ctx.col("stock_code")
    quantity, price = ctx.col("quantity"), ctx.col("unit_price")
    details: dict[str, Any] = {}

    w = ctx.work
    details["returns"] = ctx.move(
        "S4", w[invoice].str.startswith("C", na=False), "returns",
        "Cancelled invoice (number starts with C): a return, not a sale.",
    )
    w = ctx.work
    details["adjustments"] = ctx.move(
        "S4", w[invoice].str.startswith("A", na=False) | w[stock].isin(ADJUSTMENT_CODES), "adjustments",
        "Accounting adjustment (bad-debt invoice or adjustment code), not a sale.",
    )
    w = ctx.work
    details["fees"] = ctx.move(
        "S4", w[stock].isin(FEE_CODES), "fees",
        "Postage, fee, discount, sample or manual line, not a product sale.",
    )
    w = ctx.work
    product_shape = w[stock].str.match(PRODUCT_CODE_PATTERN, na=False)
    details["product_code_format_used"] = bool(len(w) and product_shape.mean() >= PRODUCT_CODE_MIN_SHARE)
    details["non_product_codes"] = 0
    if details["product_code_format_used"]:
        details["non_product_codes"] = ctx.move(
            "S4", ~product_shape & w[stock].notna(), "fees",
            "Stock code is not a product code (e.g. gift voucher or dotcom code), so the line is not a product sale.",
        )
        details["fees"] += details["non_product_codes"]
    w = ctx.work
    qty, unit = w[quantity], _as_float(w[price])
    no_price = unit.isna() | (unit <= 0)
    details["adjustments"] += ctx.move(
        "S4", _mask(qty < 0) & no_price, "adjustments",
        "Negative quantity with no price: a stock write-off or adjustment, not a sale.",
    )

    w = ctx.work
    qty, unit = w[quantity], _as_float(w[price])
    negative = _mask(qty < 0) & (unit > 0)
    rows = w.index[negative]
    details["negative_quantities_fixed"] = ctx.change(
        "S4", rows, quantity, w.loc[rows, quantity].abs(),
        "Negative quantity on a priced sale is a sign error; made positive.", action="repair",
    )

    w = ctx.work
    unit = _as_float(w[price])
    rows = w.index[unit <= 0]
    details["zero_prices_to_missing"] = ctx.change(
        "S4", rows, price, np.nan, "Zero or negative price on a sale is treated as missing (filled in S7).",
        action="blank",
    )
    return details


# ─── S5 Dependencies ──────────────────────────────────────────────────────────
DEPENDENCIES: tuple[tuple[str, str], ...] = (
    ("invoice", "customer_id"),
    ("invoice", "country"),
    ("stock_code", "description"),
    ("customer_id", "country"),
)


def s5_dependencies(ctx: ECPContext) -> dict[str, Any]:
    """Test each dependency; use it only if >= 90% of rows follow it, then fill
    blanks and fix values that disagree with the majority."""
    threshold = ctx.config.dependency_threshold
    if not ctx.config.dependency_repair:
        return {"rules": [], "switched_off": True}
    for determinant_role, dependent_role in DEPENDENCIES:
        if not ctx.has(determinant_role, dependent_role):
            continue
        determinant, dependent = ctx.col(determinant_role), ctx.col(dependent_role)
        table = _majority(ctx.work, determinant, dependent)
        tested = table[table["total"] >= 2]
        support = float(tested["n"].sum() / tested["total"].sum()) if len(tested) else None
        rule: dict[str, Any] = {
            "rule": f"{determinant} -> {dependent}",
            "support": None if support is None else round(support, 4),
            "groups_tested": int(len(tested)),
            "accepted": support is not None and support >= threshold,
            "filled": 0,
            "fixed": 0,
        }
        if rule["accepted"]:
            strict = table[table["n"] / table["total"] > 0.5]
            keys = ctx.work[determinant]
            majority = keys.map(strict["value"])
            fill = ctx.work[dependent].isna() & majority.notna()
            rule["filled"] = ctx.change(
                "S5", ctx.work.index[fill], dependent, majority[fill],
                f"Blank filled with the value most rows of the same {determinant} have "
                f"(rule {determinant} -> {dependent} holds for {support:.1%} of rows).",
                action="fill",
            )
            strong = strict[strict["n"] >= 2]["value"]
            majority = ctx.work[determinant].map(strong)
            current = ctx.work[dependent]
            fix = current.notna() & majority.notna() & (current != majority)
            rule["fixed"] = ctx.change(
                "S5", ctx.work.index[fix], dependent, majority[fix],
                f"Value disagreed with the majority for the same {determinant} "
                f"(rule {determinant} -> {dependent} holds for {support:.1%} of rows).",
                action="repair",
            )
        ctx.dependency_rules.append(rule)
    return {"rules": ctx.dependency_rules}


# ─── S6 Unusual values ────────────────────────────────────────────────────────
def _decimal_slip_repairs(
    rows: pd.Index,
    values: pd.Series,
    codes: pd.Series,
    stats: pd.DataFrame,
    seen: dict,
    config: ECPConfig,
    factors: tuple[int, ...],
    whole_numbers: bool,
) -> tuple[dict[int, float], list[int]]:
    """For each flagged row, try moving the decimal point. Repair only when
    exactly one candidate has been seen at least ``repair_min_charged`` times
    for the same product and is itself not unusual; otherwise send to review."""
    repairs: dict[int, float] = {}
    to_review: list[int] = []
    for row in rows:
        value, code = float(values.at[row]), codes.at[row]
        median, scale = stats.at[row, "median"], stats.at[row, "scale"]
        options = set()
        for factor in factors:
            for raw in (value / factor, value * factor):
                if whole_numbers:
                    if not float(raw).is_integer():
                        continue  # a quantity must stay a whole number
                    candidate: float = int(raw)
                else:
                    candidate = round(raw, 4)
                if candidate <= 0 or seen.get((code, candidate), 0) < config.repair_min_charged:
                    continue
                if pd.isna(scale) or abs((np.log(candidate) - median) / scale) <= config.z_threshold:
                    options.add(candidate)
        if len(options) == 1:
            repairs[row] = options.pop()
        else:
            to_review.append(row)
    return repairs, to_review


def s6_unusual_values(ctx: ECPContext) -> dict[str, Any]:
    """Per-product log-scale modified z-score with safety checks.

    Prices: scored per product and customer type (guest or account), because
    guests pay more. A flagged price is repaired only if moving the decimal
    point gives a price the product has actually been charged at least twice;
    otherwise it is sent for review. Quantities are flagged, never changed
    (unless ``repair_quantities`` is switched on for the evaluation).
    """
    config = ctx.config
    w = ctx.work
    stock, price, quantity = ctx.col("stock_code"), ctx.col("unit_price"), ctx.col("quantity")
    customer = ctx.col("customer_id") if ctx.has("customer_id") else None
    details: dict[str, Any] = {}
    # With per-product checks switched off, every row is in one group.
    product = w[stock] if config.per_product_checks else pd.Series("all products", index=w.index)

    # Prices
    unit = _as_float(w[price])
    priced = unit > 0
    guest = w[customer].isna() if customer is not None else pd.Series(False, index=w.index)
    stats = _modified_z(np.log(unit.where(priced)), [product, guest])
    price_key = unit.round(4)
    repeats = price_key.groupby([product, price_key]).transform("size")
    unusual = priced & (stats["size"] >= config.min_group_size) & (stats["z"].abs() > config.z_threshold)
    genuine = unusual & (repeats >= config.genuine_repeat_count) if config.safety_checks else unusual & False
    flagged = unusual & ~genuine
    charged = price_key[priced].groupby([product[priced], price_key[priced]]).size().to_dict()
    repairs, to_review = _decimal_slip_repairs(
        w.index[flagged], unit, product, stats, charged, config, (10, 100, 1000), whole_numbers=False
    )

    details["price_outliers"] = int(unusual.sum())
    details["price_kept_as_genuine"] = int(genuine.sum())
    details["price_decimal_slips_repaired"] = ctx.change(
        "S6", pd.Index(list(repairs), dtype="int64"), price, pd.Series(repairs, dtype="float64"),
        f"Decimal-point slip: replaced with a price this product has been charged at least "
        f"{config.repair_min_charged} times.",
        action="repair",
    )
    review_rows = pd.Index(to_review, dtype="int64")
    details["price_sent_to_review"] = ctx.review.record(
        "S6", review_rows, price, "unusual_price", unit.reindex(review_rows),
        "Price is unusual for this product (modified z-score above "
        f"{config.z_threshold}) and no safe decimal-slip repair exists.",
    )

    # Quantities (flag only, by default)
    w = ctx.work
    qty = _as_float(w[quantity])
    positive = qty > 0
    log_qty = np.log(qty.where(positive))
    q_stats = _modified_z(log_qty, [product])
    q_repeats = qty.groupby([product, qty]).transform("size")
    q_unusual = positive & (q_stats["size"] >= config.min_group_size) & (q_stats["z"].abs() > config.z_threshold)
    no_rows = pd.Series(False, index=w.index)
    q_genuine_repeat = q_unusual & (q_repeats >= config.genuine_repeat_count) if config.safety_checks else no_rows
    if customer is not None and config.safety_checks:
        c_stats = _modified_z(log_qty, [w[customer]])
        customer_normal = (c_stats["size"] >= config.min_group_size) & (c_stats["z"].abs() <= config.z_threshold)
    else:
        customer_normal = no_rows
    q_genuine_customer = q_unusual & ~q_genuine_repeat & customer_normal
    q_flagged = q_unusual & ~q_genuine_repeat & ~customer_normal

    details["quantity_outliers"] = int(q_unusual.sum())
    details["quantity_kept_as_genuine_repeat"] = int(q_genuine_repeat.sum())
    details["quantity_kept_as_normal_for_customer"] = int(q_genuine_customer.sum())
    flagged_rows = w.index[q_flagged]
    if config.repair_quantities:
        seen = qty[positive].groupby([product[positive], qty[positive]]).size().to_dict()
        q_repairs, flagged_list = _decimal_slip_repairs(
            flagged_rows, qty, product, q_stats, seen, config, (10, 100, 1000), whole_numbers=True
        )
        details["quantities_repaired"] = ctx.change(
            "S6", pd.Index(list(q_repairs), dtype="int64"), quantity, pd.Series(q_repairs).astype(w[quantity].dtype),
            "Quantity had extra zeros: replaced with a quantity this product is often sold in "
            "(evaluation setting; full ECP never changes quantities).",
            action="repair",
        )
        flagged_rows = pd.Index(flagged_list, dtype="int64")
    details["quantity_sent_to_review"] = ctx.review.record(
        "S6", flagged_rows, quantity, "unusual_quantity", w.loc[flagged_rows, quantity],
        "Quantity is unusual for this product and not normal for this customer. "
        "Flagged only: quantities are never changed.",
    )
    return details


# ─── S7 Fill and validate ─────────────────────────────────────────────────────
def s7_fill_and_validate(ctx: ECPContext) -> dict[str, Any]:
    """Fill missing prices from the same product on the same day, then for the
    same customer, then overall; run quality checks."""
    w = ctx.work
    stock, price, quantity = ctx.col("stock_code"), ctx.col("unit_price"), ctx.col("quantity")
    helper = pd.DataFrame({"stock": w[stock], "price": _as_float(w[price])}, index=w.index)
    tiers: list[tuple[str, list[str]]] = []
    if ctx.has("invoice_date"):
        helper["day"] = pd.to_datetime(w[ctx.col("invoice_date")], errors="coerce").dt.normalize()
        tiers.append(("the same product on the same day", ["stock", "day"]))
    if ctx.has("customer_id"):
        helper["customer"] = w[ctx.col("customer_id")]
        tiers.append(("the same product for the same customer", ["stock", "customer"]))
    tiers.append(("the same product overall", ["stock"]))

    known = helper[helper["price"].notna()]
    filled_by_tier: dict[str, int] = {}
    for label, keys in tiers:
        missing_rows = ctx.work.index[_as_float(ctx.work[price]).isna()]
        if len(missing_rows) == 0:
            break
        modes = (
            known.groupby(keys + ["price"], dropna=True).size().rename("n").reset_index()
            .sort_values(["n", "price"], ascending=[False, True], kind="stable")
            .drop_duplicates(keys)
        )
        lookup = (
            helper.loc[missing_rows, keys].reset_index()
            .merge(modes[keys + ["price"]], on=keys, how="left")
            .set_index("row")["price"].dropna()
        )
        filled_by_tier[label] = ctx.change(
            "S7", lookup.index, price, lookup,
            f"Missing price filled with the most common price for {label}.", action="fill",
        )
        if len(lookup):
            ctx.filled_price_revenue += float((_as_float(ctx.work.loc[lookup.index, quantity]) * lookup).sum())

    still_missing = ctx.work.index[_as_float(ctx.work[price]).isna()]
    ctx.review.record(
        "S7", still_missing, price, "missing_price", None,
        "No price could be found for this product, so the price is left blank.",
    )
    # S3 ran before S5, so a row can become identical to another one only
    # because S5 corrected its description. That could be a real duplicate or
    # a genuine repeated line, so it is flagged rather than removed.
    repeated = ctx.work.duplicated(keep=False)
    ctx.review.record(
        "S7", ctx.work.index[repeated], None, "duplicate_after_repair", None,
        "Row became identical to another row after S5 corrected a value; check whether it is a duplicate.",
    )
    return {
        "prices_filled": filled_by_tier,
        "prices_still_missing": int(len(still_missing)),
        "validation": validate(ctx),
    }


def validate(ctx: ECPContext) -> list[dict[str, Any]]:
    w = ctx.work
    checks: list[dict[str, Any]] = []

    def check(name: str, failures: int, detail: str) -> None:
        checks.append({"check": name, "passed": failures == 0, "failures": int(failures), "detail": detail})

    check("No duplicate rows", int(w.duplicated().sum()),
          "Exact duplicate rows remaining. Any that appear after S5 corrections are in the review queue.")
    if ctx.has("invoice", "stock_code", "quantity", "unit_price"):
        invoice, stock = ctx.col("invoice"), ctx.col("stock_code")
        check(
            "Only sales remain",
            int((w[invoice].str.match(r"^[CA]", na=False) | w[stock].isin(FEE_CODES | ADJUSTMENT_CODES)).sum()),
            "Return, adjustment or fee rows left in the sales data.",
        )
        check("Quantities are positive", int(_mask(w[ctx.col("quantity")] <= 0).sum()),
              "Rows with a zero or negative quantity.")
        unit = _as_float(w[ctx.col("unit_price")])
        check("Prices are positive", int((unit <= 0).sum()), "Rows with a zero or negative price.")
        check("Every sale has a price", int(unit.isna().sum()), "Rows still missing a price (sent for review).")
    for rule in ctx.dependency_rules:
        if not rule["accepted"]:
            continue
        determinant, dependent = rule["rule"].split(" -> ")
        determinant = next(c for c in w.columns if str(c) == determinant)
        dependent = next(c for c in w.columns if str(c) == dependent)
        table = _majority(w, determinant, dependent)
        clear = table[(table["n"] / table["total"] > 0.5) & (table["n"] >= 2)]
        unclear = table[(table["total"] >= 2) & ~table.index.isin(clear.index) & (table["n"] < table["total"])]
        check(
            f"Rule {rule['rule']}", int((clear["total"] - clear["n"]).sum()),
            "Rows that still disagree with a clear majority. "
            f"{len(unclear)} groups have no clear majority and were left as they are.",
        )
    return checks


# ─── Generic mode (datasets without order columns) ───────────────────────────
def generic_fill(ctx: ECPContext) -> dict[str, Any]:
    """General fill for non-order data: median for numbers, most common value
    for text. Not part of ECP. Columns more than 30% blank are left alone and
    reported instead, because filling them would mostly invent data."""
    filled: dict[str, int] = {}
    for column in ctx.work.columns:
        series = ctx.work[column]
        missing = series.isna()
        ratio = float(missing.mean()) if len(series) else 0.0
        if ratio == 0:
            continue
        if ratio > 0.3:
            ctx.uncertain_columns.append({
                "stage": "S7", "column": str(column), "issue": "high_missingness",
                "missing_ratio": round(ratio, 4),
                "reason": "More than 30% blank: not filled automatically.",
            })
            continue
        if pd.api.types.is_numeric_dtype(series):
            value, how = series.median(), "median"
            if pd.api.types.is_integer_dtype(series):
                value, how = round(value), "median (rounded)"
        else:
            modes = series.mode(dropna=True)
            if modes.empty:
                continue
            value, how = modes.iloc[0], "most common value"
        filled[str(column)] = ctx.change(
            "S7", ctx.work.index[missing], column, value,
            f"General fill (not ECP): blank filled with the column {how}.", action="fill",
        )
    return {"filled": filled, "validation": validate(ctx)}
