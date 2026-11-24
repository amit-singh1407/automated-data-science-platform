from __future__ import annotations

from pathlib import Path


def write_pdf_report(path: Path, job_id: str, profile: dict, cleaning: dict, ml_results: dict) -> None:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    doc = canvas.Canvas(str(path), pagesize=A4)
    y = 800
    doc.setFont("Helvetica-Bold", 16)
    doc.drawString(40, y, "AutoData AI - Processing Report")
    y -= 30
    doc.setFont("Helvetica", 11)
    lines = [
        f"Job ID: {job_id}",
        f"Rows: {profile.get('rows', 0)} | Columns: {profile.get('columns', 0)}",
        f"Data Quality Score: {profile.get('quality_score', 0)}",
        f"Cleaning Actions: {len(cleaning.get('audit_log', []))}",
        f"Uncertain Cases Flagged: {len(cleaning.get('uncertain_cases', []))}",
        f"Quality Change: {cleaning.get('before_after_quality', {}).get('change', 0)}",
        f"ML Mode: {ml_results.get('mode', 'n/a')}",
        f"Winner: {ml_results.get('winner', {})}",
        f"Feature Importance Entries: {len(ml_results.get('feature_importance', []))}",
    ]
    for line in lines:
        doc.drawString(40, y, line)
        y -= 18
    doc.save()
