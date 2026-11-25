"""Settings, column detection and lookup tables for the ECP pipeline.

Default values follow the thesis (Chapter 3, "The seven stages").
"""
from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ECPConfig:
    # S2: fuzzy country matching. A rare value is mapped to a more common one
    # only if the names are at least this similar ...
    fuzzy_similarity: float = 0.85
    # ... and the target is at least this many times more frequent
    # ("20x dominance"). This keeps Austria and Australia apart.
    fuzzy_dominance: float = 20.0
    # S5: a dependency (e.g. invoice -> customer) is used only if at least
    # this share of rows follows it.
    dependency_threshold: float = 0.90
    # S6: log-scale modified z-score cut-off.
    z_threshold: float = 3.5
    # S6 safety check: a value seen this many times for a product is genuine.
    genuine_repeat_count: int = 8
    # S6: a decimal-slip repair target must have been charged at least this
    # many times for the same product.
    repair_min_charged: int = 2
    # S6: minimum observations before a product or customer is scored.
    # Not stated in the thesis; an implementation choice.
    min_group_size: int = 5
    # How many audit and review entries to keep in the JSON results.
    # The full logs are always written to CSV files.
    audit_sample_size: int = 2000
    review_sample_size: int = 500

    # Feature switches, used by the evaluation to switch off one feature at a
    # time (thesis Chapter 4, "Which parts matter"). Defaults = full ECP.
    standardise_before_dedupe: bool = True   # run S2 before S3
    fuzzy_countries: bool = True             # S2 fuzzy country matching
    dependency_repair: bool = True           # S5
    per_product_checks: bool = True          # S6 per product (False = one global rule)
    safety_checks: bool = True               # S6 "seen 8+ times" and "normal for customer"
    repair_quantities: bool = False          # S6 repairs quantities instead of only flagging them


# Column roles and the header names that identify them. Names are compared
# after lower-casing and removing everything except letters and digits, so
# "InvoiceNo", "invoice_no" and "Invoice No" all match "invoiceno".
ROLE_ALIASES: dict[str, tuple[str, ...]] = {
    "invoice": ("invoiceno", "invoice", "invoiceid", "invoicenumber", "orderid", "orderno", "ordernumber"),
    "stock_code": ("stockcode", "productcode", "sku", "productid", "itemcode", "itemid"),
    "description": ("description", "productname", "productdescription", "itemname", "itemdescription"),
    "quantity": ("quantity", "qty", "units"),
    "invoice_date": ("invoicedate", "orderdate", "transactiondate", "date", "datetime"),
    "unit_price": ("unitprice", "price", "itemprice", "priceperunit"),
    "customer_id": ("customerid", "customerno", "customernumber", "clientid", "customer"),
    "country": ("country", "countryname"),
}

# Without these four columns the order-specific stages (S4-S6) cannot run,
# and the dataset is cleaned in generic mode.
REQUIRED_ROLES: tuple[str, ...] = ("invoice", "stock_code", "quantity", "unit_price")

# S4: stock codes that are not products. Upper case, because S2 runs first.
FEE_CODES: frozenset[str] = frozenset(
    {"POST", "DOT", "C2", "BANK CHARGES", "AMAZONFEE", "CRUK", "PADS", "M", "D", "S"}
)
ADJUSTMENT_CODES: frozenset[str] = frozenset({"B", "ADJUST", "ADJUST2"})
# S4: the shape of a normal product code in the UCI data (5 digits plus up to
# two letters, e.g. 85123A). Codes of another shape, such as gift vouchers
# (GIFT_0001_20) and dotcom codes (DCGSSGIRL), are treated as non-product.
# Used only when most of the file follows this shape, so shops with other
# SKU formats are not affected.
PRODUCT_CODE_PATTERN = r"^\d{5}[A-Z]{0,2}$"
PRODUCT_CODE_MIN_SHARE = 0.90

# S2: real country names. Fuzzy matching only changes values that are NOT in
# this list, so a real but rare country (Iceland) is never merged into a
# similar, common one (Ireland). Compared in lower case.
KNOWN_COUNTRIES: frozenset[str] = frozenset(name.lower() for name in (
    "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Argentina", "Armenia", "Australia", "Austria",
    "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin",
    "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso",
    "Burundi", "Cambodia", "Cameroon", "Canada", "Cape Verde", "Chad", "Chile", "China", "Colombia", "Comoros",
    "Congo", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czech Republic", "Czechia", "Denmark", "Djibouti",
    "Dominica", "Dominican Republic", "Ecuador", "Egypt", "El Salvador", "Estonia", "Eswatini", "Ethiopia",
    "Fiji", "Finland", "France", "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada",
    "Guatemala", "Guinea", "Guyana", "Haiti", "Honduras", "Hong Kong", "Hungary", "Iceland", "India",
    "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan",
    "Kenya", "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya",
    "Liechtenstein", "Lithuania", "Luxembourg", "Macau", "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali",
    "Malta", "Mauritania", "Mauritius", "Mexico", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco",
    "Mozambique", "Myanmar", "Namibia", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria",
    "North Korea", "North Macedonia", "Norway", "Oman", "Pakistan", "Panama", "Papua New Guinea", "Paraguay",
    "Peru", "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia", "Rwanda", "Saudi Arabia",
    "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Somalia",
    "South Africa", "South Korea", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria",
    "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Togo", "Trinidad and Tobago", "Tunisia", "Turkey",
    "Turkmenistan", "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay",
    "Uzbekistan", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe",
    # Non-country values that appear in the UCI data and must be left alone.
    "Channel Islands", "European Community", "Unspecified",
))

# S2: country alias table (keys are lower case).
COUNTRY_ALIASES: dict[str, str] = {
    "eire": "Ireland",
    "rsa": "South Africa",
    "usa": "United States",
    "u.s.a.": "United States",
    "united states of america": "United States",
    "uk": "United Kingdom",
    "u.k.": "United Kingdom",
    "great britain": "United Kingdom",
    "holland": "Netherlands",
    "the netherlands": "Netherlands",
}


def normalise_name(name: object) -> str:
    return re.sub(r"[^a-z0-9]", "", str(name).lower())


def detect_columns(columns: Iterable[Any]) -> dict[str, Any]:
    """Map each column role to the dataset's own column label."""
    lookup: dict[str, Any] = {}
    for column in columns:
        lookup.setdefault(normalise_name(column), column)
    mapping: dict[str, Any] = {}
    for role, aliases in ROLE_ALIASES.items():
        for alias in aliases:
            column = lookup.get(alias)
            if column is not None and column not in mapping.values():
                mapping[role] = column
                break
    return mapping
