from __future__ import annotations

from pathlib import Path


def write_pdf_report(path: Path, job_id: str, profile: dict, cleaning: dict, ml_results: dict) -> None:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    doc = canvas.Canvas(str(path), pagesize=A4)
    y = 800

    def line(text: str, size: int = 11, bold: bool = False, gap: int = 18) -> None:
        nonlocal y
        if y < 60:
            doc.showPage()
            y = 800
        doc.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        doc.drawString(40, y, text)
        y -= gap

    line("AutoData AI - Processing Report", size=16, bold=True, gap=30)
    rows = cleaning.get("rows", {})
    winner = ml_results.get("winner") or {}
    for text in (
        f"Job ID: {job_id}",
        f"Input: {profile.get('rows', 0)} rows, {profile.get('columns', 0)} columns",
        f"Data quality score: {profile.get('quality_score', 0)} -> "
        f"{cleaning.get('before_after_quality', {}).get('after', 0)} "
        f"(change {cleaning.get('before_after_quality', {}).get('change', 0)})",
    ):
        line(text)

    line("", gap=8)
    line(f"ECP cleaning ({cleaning.get('mode', 'n/a')} mode)", size=13, bold=True, gap=22)
    for text in (
        f"Sales rows kept: {rows.get('sales_output', 0)} of {rows.get('input', 0)}",
        "Rows moved to side tables: "
        + (", ".join(f"{name} {count}" for name, count in rows.get("moved", {}).items()) or "none"),
        f"Cells changed: {cleaning.get('cells_changed', 0)}",
        f"Rows flagged for review: {rows.get('flagged_for_review', 0)}",
    ):
        line(text)
    for stage in cleaning.get("stages", []):
        if stage.get("status") == "skipped":
            line(f"  {stage['stage']} {stage['name']}: skipped", size=10, gap=15)
        else:
            line(
                f"  {stage['stage']} {stage['name']}: {stage.get('cells_changed', 0)} changed, "
                f"{stage.get('rows_moved_or_removed', 0)} moved/removed, {stage.get('rows_flagged', 0)} flagged",
                size=10, gap=15,
            )
    totals = cleaning.get("invoice_totals")
    if totals:
        line(
            f"Invoices: {totals['invoices']}, changed by more than 1%: {totals['invoices_changed_over_1pct']}; "
            f"value added by price fills: {totals['value_added_by_price_fills']}",
            size=10, gap=15,
        )

    line("", gap=8)
    line("Machine learning", size=13, bold=True, gap=22)
    line(f"Mode: {ml_results.get('mode', 'n/a')}")
    if winner:
        line(f"Winning model: {winner.get('model', 'n/a')}")
    line(f"Feature importance entries: {len(ml_results.get('feature_importance', []))}")
    doc.save()
