# AutoData AI

AutoData AI cleans order data with the **E-commerce Cleaning Pipeline (ECP)**,
a seven-stage, fully audited cleaner that never deletes genuine sales. It
then profiles, transforms and models the cleaned data and produces
downloadable results and a PDF report.

## Features

- **ECP cleaning (S1-S7).** Profile, standardise, deduplicate, shop rules
  (returns, fees and adjustments moved to side tables), dependency repair,
  per-product unusual-value checks with safety checks, and price filling.
  Datasets without order columns are cleaned in a generic mode.
- **Audit log.** Every change is recorded with stage, row, column, old value,
  new value and reason. Rows that cannot be repaired safely go to a review
  queue instead of being changed.
- **Analysis.** Profiling, feature transformation, and machine learning:
  classification or regression when there is a column named `target`,
  `label` or `y`, and clustering with anomaly detection otherwise.
- **Downloads.** Cleaned and transformed data, the audit log, the review
  queue, side tables, a PDF report, or everything as a ZIP.
- **Accounts.** Login is required, and each user sees only their own jobs.
- **Evaluation.** Reproduces the thesis evaluation: injected errors,
  repair F1, baselines, and versions with one feature switched off.

Details: [implementation.md](./implementation.md). How the implementation
compares with the thesis: [docs/ECP-implementation-notes.md](./docs/ECP-implementation-notes.md).

## Tech stack

| Layer | Technologies |
| --- | --- |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, Plotly.js, Lucide icons |
| Backend | Python 3.11+, FastAPI, pandas, scikit-learn, XGBoost (optional), ReportLab |
| Storage | SQLite, plus one folder per job for its files |

## Quick start

### Backend

```powershell
cd automated-data-science-platform/backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:AUTODATA_SECRET_KEY = "a-long-random-string"   # required outside local testing
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

API documentation: http://127.0.0.1:8000/docs

### Frontend

```powershell
cd automated-data-science-platform/frontend
npm install
npm run dev
```

Open http://localhost:5173 and create an account. The first account
created on a server also receives any jobs uploaded before login was added.

## Settings

All backend settings are environment variables with the `AUTODATA_` prefix
(or lines in `backend/.env`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTODATA_SECRET_KEY` | `change-this-in-production` | Signs login tokens. **Set your own value.** |
| `AUTODATA_MAX_UPLOAD_SIZE_MB` | `25` | Upload limit. The UCI Online Retail CSV is about 45 MB, so raise this, or upload the `.xlsx` (about 23 MB). |
| `AUTODATA_ACCESS_TOKEN_EXPIRE_MINUTES` | `480` | How long a login lasts. |
| `AUTODATA_SQLITE_PATH` | `backend/autodata.db` | Database file. |
| `AUTODATA_UPLOADS_ROOT` | `backend/uploads` | Folder for job files. |
| `AUTODATA_TRACE_MEMORY` | `false` | Record peak memory per stage. Makes processing several times slower. |

The ECP thresholds (90% dependency rule, z-score 3.5, and so on) are in
`backend/app/services/ecp/config.py`.

## Reproducing the thesis evaluation

```powershell
cd automated-data-science-platform/backend
python -m app.services.evaluation "Online Retail.xlsx" --rates 0.02,0.05,0.1,0.2,0.3 --seeds 0,1,2,3,4 --out evaluation.json
python -m app.services.evaluation --list      # methods and error types
```

One error rate with one seed takes about two minutes for all eleven methods.

## Tests

```powershell
cd automated-data-science-platform/backend; python -m pytest
cd automated-data-science-platform/frontend; npm test
```

## Docker

```powershell
cd automated-data-science-platform
docker compose up --build
```

Set `AUTODATA_SECRET_KEY` in `docker-compose.yml` before using it beyond your own computer.
