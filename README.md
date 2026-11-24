# ⚡ AutoData AI

> **Autonomous Data Science & AutoML Platform**  
> Upload any raw dataset once. The platform automatically profiles, cleans, engineers features, benchmarks machine learning models, generates interactive analytics, and exports production-ready datasets and PDF reports.

---

## 🚀 Key Features

* **Single-Upload Automated Pipeline:** Ingests CSV or Excel files and processes the entire data science lifecycle in the background.
* **ECP 7-Stage Cleaning Engine:** Specialized commercial & e-commerce heuristics for deduplication, context-aware null imputation, outlier handling, and text standardization.
* **Smart Feature Transformation:** Automatically extracts temporal signals from dates, applies Min-Max scaling, and creates interaction features.
* **AutoML Benchmark:** Automatically detects supervised (Classification/Regression) or unsupervised (K-Means Clustering & Isolation Forest Anomaly Detection) tasks and benchmarks top algorithms.
* **Interactive Visual Analytics:** Plotly-powered correlation heatmaps, feature variance spreads, and quality improvement gauges.
* **Production Export Center:** One-click downloads for Cleaned CSV/Excel, Transformed Feature matrices, and executive PDF reports.
* **Dataset Management:** Complete job history with position rankings, single delete, and bulk batch deletion.

---

## 🛠️ Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, Plotly.js, Lucide Icons |
| **Backend** | Python 3.10+, FastAPI, Uvicorn, Pandas, Scikit-learn, ReportLab |
| **Storage** | SQLite with scoped async connection pooling |

---

## 🧭 Application Structure

1. **Dashboard** — Overview metrics, overall pipeline tracker, and drag-and-drop file upload.
2. **Data Profiling** — Schema detection, data types, null counts, duplicate records, and summary statistics.
3. **Automated Cleaning** — Quality score gain ($+\Delta$), breakdown metrics, and 7-stage ECP execution status.
4. **Data Transformation** — Feature engineering log, datetime extractions, and scaling history.
5. **Machine Learning** — Algorithm winner selection, accuracy/F1/ROC curves, or K-Means cluster partitions.
6. **Visual Analytics** — 2D Pearson correlation matrix heatmap and feature distribution charts.
7. **Reports & Downloads** — Download cleaned datasets, feature matrices, and executive PDF reports.
8. **Job History** — Previous runs with selection checkboxes, single-job delete, and bulk delete.

---

## ⚡ Quick Start

### 1. Backend Setup

```powershell
cd automated-data-science-platform/backend

# Create & activate virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# Install dependencies & run server
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```
> Backend API docs will be available at: `http://127.0.0.1:8000/docs`

### 2. Frontend Setup

```powershell
cd automated-data-science-platform/frontend

# Install dependencies & launch UI
npm install
npm run dev
```
> Application UI will be live at: `http://localhost:5173`

---

## 🧪 Testing

```powershell
# Run Backend Tests
cd backend && pytest

# Run Frontend Tests
cd frontend && npm test
```
