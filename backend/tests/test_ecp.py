"""Tests for the ECP pipeline (S1-S7), one or more per stage.

``make_orders`` builds a small, clean UCI-style order table and then injects
one example of each error type at a known position, so each test can check
exactly what happened to that row.
"""
from __future__ import annotations

import pandas as pd
import pytest

from app.services.ecp import ECPConfig, detect_columns, run_ecp

P1 = ("85123A", "WHITE HANGING HEART T-LIGHT HOLDER", 2.55)
P2 = ("71053", "WHITE METAL LANTERN", 3.39)
P3 = ("84406B", "CREAM CUPID HEARTS COAT HANGER", 2.75)
GUEST_P1_PRICE = 5.0
COLUMNS = ["InvoiceNo", "StockCode", "Description", "Quantity", "InvoiceDate", "UnitPrice", "CustomerID", "Country"]


def make_orders() -> tuple[pd.DataFrame, dict[str, int]]:
    rows: list[list] = []
    marks: dict[str, int] = {}

    def add(invoice, product, quantity, day, customer, country, price=None, description=None, mark=None):
        code, name, base_price = product
        rows.append([
            invoice, code, description if description is not None else name, quantity,
            f"2011-01-{day:02d} 10:00", base_price if price is None else price, customer, country,
        ])
        if mark:
            marks[mark] = len(rows)  # 1-based row number, as used by ECP

    # Regular account customers: 40 invoices x 3 products.
    for i in range(40):
        invoice, day, customer = str(536000 + i), 1 + i % 28, 12000.0 + i % 8
        for product in (P1, P2, P3):
            add(invoice, product, 6 if i % 2 else 12, day, customer, "United Kingdom")
    # A bulk buyer who always orders 480 units: genuine, must not be flagged.
    for i in range(2):
        for product in (P1, P2, P3):
            add(str(537000 + i), product, 480, 3, 13000.0, "United Kingdom", mark="bulk" if product is P1 else None)
    # Guest checkouts (no customer ID) pay more for P1, scored separately.
    for i in range(6):
        add(str(538000 + i), P1, 6, 5, None, "United Kingdom", price=GUEST_P1_PRICE)
    # Irish customer written as EIRE, Austrian and Australian customers.
    for i in range(3):
        add(str(539000 + i), P2, 6, 7, 12500.0, "EIRE", mark="eire" if i == 0 else None)
    for i in range(5):
        add(str(539100 + i), P3, 6, 8, 12600.0, "Austria")
    for i in range(10):
        add(str(539200 + i), P3, 6, 9, 12700.0, "Australia")

    # ── Injected errors ──
    add("540000", P1, 6, 10, 12001.0, "Untied Kingdom", mark="fuzzy_country")
    add("540000", P2, 6, 10, 12001.0, "Untied Kingdom")
    add("540001", P2, 12, 11, 12002.0, "United Kingdom", description="  white metal   lantern ", mark="messy_text")
    add("540002", P3, 12, 12, 12003.0, "United Kingdom", mark="dup_source")
    add("540002", P3, 12, 12, 12003.0, "United Kingdom", mark="exact_dup")
    add("540002", P3, 12, 12, 12003.0, "United Kingdom", description=P3[1] + "  ", mark="near_dup")
    add("C540003", P1, -6, 13, 12004.0, "United Kingdom", mark="return")
    add("540004", ("POST", "POSTAGE", 18.0), 1, 14, 12005.0, "United Kingdom", mark="fee")
    add("540005", P2, -24, 15, None, "United Kingdom", price=0.0, description="damaged", mark="adjustment")
    add("540006", P2, -6, 16, 12006.0, "United Kingdom", mark="sign_error")
    add("540007", P1, 6, 17, 12007.0, "United Kingdom", price=0.0, mark="zero_price")
    add("540008", P1, 6, 18, 12000.0, "United Kingdom")
    add("540008", P2, 6, 18, None, "United Kingdom", mark="blank_customer")
    add("540008", P3, 6, 18, 12000.0, "United Kingdom")
    add("540009", P1, 6, 19, 12001.0, "United Kingdom", description="WHITE HANGING HEART HOLDER", mark="minority_desc")
    add("540010", P2, 6, 20, 12002.0, "United Kingdom", price=33.9, mark="decimal_slip")
    add("540011", P3, 1200, 21, 12003.0, "United Kingdom", mark="big_quantity")

    return pd.DataFrame(rows, columns=COLUMNS), marks


@pytest.fixture(scope="module")
def result():
    frame, marks = make_orders()
    return run_ecp(frame), marks, frame


def audit_for(result, row: int) -> pd.DataFrame:
    return result.audit[result.audit["row"] == row]


def cleaned_row(result, original: pd.DataFrame, row: int) -> pd.Series | None:
    """Find a source row in the cleaned output via the audit-free route:
    cleaned rows keep their order, so map by position of surviving rows."""
    moved = set()
    for table in result.side_tables.values():
        moved.update(table["row"].tolist())
    surviving = [r for r in range(1, len(original) + 1) if r not in moved]
    if row not in surviving:
        return None
    return result.cleaned.iloc[surviving.index(row)]


def test_detects_uci_columns():
    mapping = detect_columns(COLUMNS)
    assert mapping["invoice"] == "InvoiceNo"
    assert mapping["unit_price"] == "UnitPrice"
    assert mapping["customer_id"] == "CustomerID"


def test_runs_in_retail_mode_with_all_seven_stages(result):
    ecp, _, _ = result
    assert ecp.summary["mode"] == "retail"
    assert [s["stage"] for s in ecp.summary["stages"]] == ["S1", "S2", "S3", "S4", "S5", "S6", "S7"]
    assert all(s["status"] == "completed" for s in ecp.summary["stages"])


def test_s1_fixes_types(result):
    ecp, _, _ = result
    assert ecp.cleaned["CustomerID"].dropna().iloc[0] == "12000"  # not "12000.0"
    assert pd.api.types.is_datetime64_any_dtype(ecp.cleaned["InvoiceDate"])
    assert str(ecp.cleaned["Quantity"].dtype) == "Int64"


def test_s2_standardises_text_and_countries(result):
    ecp, marks, frame = result
    assert cleaned_row(ecp, frame, marks["messy_text"])["Description"] == "WHITE METAL LANTERN"
    assert cleaned_row(ecp, frame, marks["eire"])["Country"] == "Ireland"
    assert cleaned_row(ecp, frame, marks["fuzzy_country"])["Country"] == "United Kingdom"
    countries = set(ecp.cleaned["Country"])
    assert {"Austria", "Australia"} <= countries  # similar names, but not 20x dominance


def test_s3_removes_exact_and_near_duplicates_after_s2(result):
    ecp, marks, _ = result
    duplicates = set(ecp.side_tables["duplicates"]["row"])
    assert {marks["exact_dup"], marks["near_dup"]} <= duplicates
    assert marks["dup_source"] not in duplicates


def test_s4_moves_returns_fees_adjustments_and_fixes_signs(result):
    ecp, marks, frame = result
    assert marks["return"] in set(ecp.side_tables["returns"]["row"])
    assert marks["fee"] in set(ecp.side_tables["fees"]["row"])
    assert marks["adjustment"] in set(ecp.side_tables["adjustments"]["row"])
    assert cleaned_row(ecp, frame, marks["sign_error"])["Quantity"] == 6


def test_s4_zero_price_becomes_missing_and_s7_fills_it(result):
    ecp, marks, frame = result
    log = audit_for(ecp, marks["zero_price"])
    assert list(log["stage"]) == ["S4", "S7"]
    assert cleaned_row(ecp, frame, marks["zero_price"])["UnitPrice"] == pytest.approx(P1[2])
    assert "same product" in log.iloc[-1]["reason"]


def test_s5_fills_blank_customer_and_fixes_minority_description(result):
    ecp, marks, frame = result
    assert cleaned_row(ecp, frame, marks["blank_customer"])["CustomerID"] == "12000"
    assert cleaned_row(ecp, frame, marks["minority_desc"])["Description"] == P1[1]
    rules = {rule["rule"]: rule for rule in ecp.summary["dependency_rules"]}
    assert rules["InvoiceNo -> CustomerID"]["accepted"]
    assert rules["StockCode -> Description"]["fixed"] >= 1


def test_s5_keeps_guest_orders_blank(result):
    ecp, _, _ = result
    guests = ecp.cleaned[ecp.cleaned["InvoiceNo"].str.startswith("538")]
    assert len(guests) == 6
    assert guests["CustomerID"].isna().all()


def test_s6_repairs_decimal_slip_to_a_charged_price(result):
    ecp, marks, frame = result
    assert cleaned_row(ecp, frame, marks["decimal_slip"])["UnitPrice"] == pytest.approx(P2[2])
    log = audit_for(ecp, marks["decimal_slip"])
    assert log.iloc[0]["old_value"] == pytest.approx(33.9)
    assert log.iloc[0]["new_value"] == pytest.approx(3.39)


def test_s6_flags_quantity_but_never_changes_it(result):
    ecp, marks, frame = result
    assert cleaned_row(ecp, frame, marks["big_quantity"])["Quantity"] == 1200
    flagged = ecp.review[ecp.review["issue"] == "unusual_quantity"]
    assert marks["big_quantity"] in set(flagged["row"])


def test_s6_safety_checks_protect_bulk_buyer_and_guest_prices(result):
    ecp, marks, _ = result
    reviewed = set(ecp.review["row"])
    assert marks["bulk"] not in reviewed
    guest_rows = ecp.cleaned[ecp.cleaned["InvoiceNo"].str.startswith("538")]
    assert (guest_rows["UnitPrice"] == GUEST_P1_PRICE).all()


def test_s7_validation_passes(result):
    ecp, _, _ = result
    failed = [check for check in ecp.summary["validation"] if not check["passed"]]
    assert failed == []


def test_audit_log_records_old_and_new_values(result):
    ecp, _, _ = result
    assert list(ecp.audit.columns) == ["stage", "row", "column", "action", "old_value", "new_value", "reason"]
    assert (ecp.audit["reason"].str.len() > 0).all()
    assert ecp.summary["audit_log_total"] == len(ecp.audit)


def test_row_accounting_adds_up(result):
    ecp, _, frame = result
    moved = sum(ecp.summary["rows"]["moved"].values())
    assert ecp.summary["rows"]["sales_output"] + moved == len(frame)


def test_generic_mode_skips_order_stages():
    frame = pd.DataFrame({
        "city": [" Pune", "Pune ", "Delhi", None, "Delhi"],
        "value": [1.0, 1.0, 2.0, 3.0, None],
    })
    ecp = run_ecp(frame)
    assert ecp.summary["mode"] == "generic"
    statuses = {s["stage"]: s["status"] for s in ecp.summary["stages"]}
    assert statuses == {"S1": "completed", "S2": "completed", "S3": "completed",
                        "S4": "skipped", "S5": "skipped", "S6": "skipped", "S7": "completed"}
    assert len(ecp.cleaned) == 4  # " Pune" and "Pune " become duplicates after S2
    assert ecp.cleaned.isna().sum().sum() == 0


def test_config_thresholds_are_used():
    frame, _ = make_orders()
    strict = run_ecp(frame, ECPConfig(dependency_threshold=1.01))
    assert not any(rule["accepted"] for rule in strict.summary["dependency_rules"])


def _upload(api, headers, frame: pd.DataFrame, name: str = "orders.csv") -> str:
    response = api.post(
        "/api/v1/jobs/upload", headers=headers,
        files={"file": (name, frame.to_csv(index=False).encode(), "text/csv")},
    )
    assert response.status_code == 200, response.text
    return response.json()["job_id"]


def test_upload_runs_ecp_end_to_end(api):
    """Upload through the API: the job completes, results carry the ECP
    summary, and the audit log, review queue and side tables download."""
    headers = api.register()
    frame, _ = make_orders()
    job_id = _upload(api, headers, frame)

    status = api.get(f"/api/v1/jobs/{job_id}/status", headers=headers).json()
    assert status["status"] == "completed", status["error_message"]

    cleaning = api.get(f"/api/v1/jobs/{job_id}/results", headers=headers).json()["cleaning"]
    assert cleaning["engine"] == "ECP"
    assert cleaning["mode"] == "retail"
    assert len(cleaning["stages"]) == 7
    assert cleaning["rows"]["flagged_for_review"] == 1

    for artifact, expected in (("log", "audit-log.csv"), ("review", "review.csv"),
                               ("returns", "side-returns.csv"), ("cleaned", "cleaned.csv")):
        download = api.get(f"/api/v1/jobs/{job_id}/download/{artifact}", headers=headers)
        assert download.status_code == 200, artifact
        assert expected in download.headers["content-disposition"]
    assert api.get(f"/api/v1/jobs/{job_id}/download/nonsense", headers=headers).status_code == 400


def test_history_has_real_fields_and_zip_download(api):
    import io
    import zipfile

    headers = api.register()
    frame, _ = make_orders()
    job_id = _upload(api, headers, frame)

    item = next(row for row in api.get("/api/v1/jobs/history", headers=headers).json() if row["job_id"] == job_id)
    assert item["rows"] == len(frame)
    assert item["quality_before"] is not None and item["quality_after"] is not None
    assert item["duration_ms"] > 0

    visuals = api.get(f"/api/v1/jobs/{job_id}/results", headers=headers).json()["visualizations"]
    assert visuals["correlation"]["columns"]
    assert "Quantity" in visuals["distributions"]

    bundle = api.get(f"/api/v1/jobs/{job_id}/download/all", headers=headers)
    assert bundle.status_code == 200
    names = zipfile.ZipFile(io.BytesIO(bundle.content)).namelist()
    assert {"cleaned.csv", "audit-log.csv", "review.csv", "report.pdf"} <= set(names)


def _orders(rows: list[tuple]) -> pd.DataFrame:
    """Build an order table from (invoice, stock, description, qty, price, customer, country) tuples."""
    return pd.DataFrame(
        [(inv, stock, desc, qty, "2011-01-05 10:00", price, cust, country)
         for inv, stock, desc, qty, price, cust, country in rows],
        columns=COLUMNS,
    )


def test_s2_fuzzy_matching_never_merges_two_real_countries():
    rows = [(str(600000 + i), "85123A", P1[1], 6, 2.55, 12000.0 + i, "Ireland") for i in range(60)]
    rows += [("601000", "85123A", P1[1], 6, 2.55, 13000.0, "Iceland"),
             ("601001", "85123A", P1[1], 6, 2.55, 13001.0, "Iceland"),
             ("601002", "85123A", P1[1], 6, 2.55, 13002.0, "Irelnad")]  # a typo
    ecp = run_ecp(_orders(rows))
    assert (ecp.cleaned["Country"] == "Iceland").sum() == 2
    assert ecp.summary["stage_details"]["S2"]["country_fuzzy_matches"] == {"Irelnad": "Ireland"}


def test_s4_moves_gift_vouchers_and_dotcom_codes_when_codes_follow_the_uci_format():
    rows = [(str(600000 + i), "85123A", P1[1], 6, 2.55, 12000.0, "United Kingdom") for i in range(30)]
    rows += [("601000", "GIFT_0001_20", "GIFT VOUCHER 20.00", 1, 20.0, None, "United Kingdom"),
             ("601001", "DCGSSGIRL", "GIRLS PARTY BAG", 1, 3.0, None, "United Kingdom")]
    ecp = run_ecp(_orders(rows))
    assert set(ecp.side_tables["fees"]["StockCode"]) == {"GIFT_0001_20", "DCGSSGIRL"}
    assert ecp.summary["stage_details"]["S4"]["non_product_codes"] == 2


def test_s4_leaves_other_sku_formats_alone():
    rows = [(str(600000 + i), f"SKU-{i % 4}", "MUG", 2, 4.0, 12000.0, "India") for i in range(30)]
    ecp = run_ecp(_orders(rows))
    assert ecp.summary["stage_details"]["S4"]["product_code_format_used"] is False
    assert len(ecp.cleaned) == 30


def test_s7_flags_rows_that_become_duplicates_after_s5_repair():
    rows = [(str(600000 + i), "85123A", P1[1], 6, 2.55, 12000.0, "United Kingdom") for i in range(10)]
    rows += [("601000", "85123A", P1[1], 6, 2.55, 12001.0, "United Kingdom"),
             ("601000", "85123A", "HEART HOLDER", 6, 2.55, 12001.0, "United Kingdom")]
    ecp = run_ecp(_orders(rows))
    flagged = ecp.review[ecp.review["issue"] == "duplicate_after_repair"]
    assert set(flagged["row"]) == {11, 12}
    assert len(ecp.cleaned) == 12  # flagged, not removed
