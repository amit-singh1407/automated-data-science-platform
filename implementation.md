# AutoData AI - Current Implementation

This document describes the functionality that is implemented in the current
codebase. It is the implementation status companion to
[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md).

## 1. Implemented Architecture

AutoData AI is implemented as a local-development full-stack application:

- **Backend:** FastAPI, Pydantic, SQLite, Pandas, NumPy, scikit-learn,
  optional XGBoost, ReportLab, JWT, and bcrypt.
- **Frontend:** React, TypeScript, Vite, Tailwind CSS, Lucide React, Plotly,
  Vitest, and React Testing Library.
- **Persistence:** SQLite stores users, jobs, stage telemetry, dataset
  fingerprints, and cached profiles.
- **File storage:** Each job receives an isolated directory under the configured
  uploads directory.
- **Deployment:** Local PowerShell startup scripts and Docker Compose are
  available.

The backend exposes the application at `/api/v1` and provides `/health`,
`/docs`, and the root service information endpoint.

## 2. Authentication and Authorization

The following functionality is implemented:

- User registration through `POST /api/v1/auth/register`.
- User login through `POST /api/v1/auth/login`.
- Email normalization and duplicate-email rejection.
- Password validation between 8 and 128 characters.
- Bcrypt password hashing and verification.
- Signed JWT bearer tokens with configurable expiration.
- `GET /api/v1/auth/me` for the logged-in user's email.
- Every jobs endpoint requires a valid bearer token; a missing, invalid or
  expired token gives 401.
- Job ownership checks for upload, status, results, history, audit logs,
  performance data, downloads and deletion. Another user's job gives the same
  404 as a missing one, and bulk delete ignores IDs the user does not own.
- Jobs uploaded before login was required belong to a placeholder user; the
  first account registered takes them over. The placeholder cannot log in.
- Frontend login and registration screen. The token is kept in local storage,
  sent with every request, and cleared on logout; when the server rejects it,
  the user returns to the login screen with a message.

Configuration is loaded from environment variables using the `AUTODATA_`
prefix. The configurable values include the database path, upload directory,
JWT secret, token lifetime, and maximum upload size.

## 3. Upload and Job Lifecycle

`POST /api/v1/jobs/upload` is implemented as a background-processing workflow.
It:

1. Creates a UUID job and queued database record.
2. Validates the filename and extension.
3. Enforces the configured upload-size limit.
4. Stores the original file in a job-specific directory.
5. Starts processing in a FastAPI background task.
6. Reports progress and a human-readable progress message.
7. Persists either a completed result or a failed terminal state.

Supported input formats are CSV, XLS, XLSX, and Parquet. The original upload
is preserved and is never overwritten by generated artifacts.

The status lifecycle is:

```text
queued -> processing -> completed
                         \-> failed
```

Unexpected processing errors are recorded on the job as `failed` with an error
message, preventing jobs from remaining indefinitely in `processing`.

## 4. Automated Data Pipeline

The implementation in `backend/app/services/pipeline.py` runs these stages:

### 4.1 Loading

Pandas readers load CSV, Excel, and Parquet files. The pipeline records a
SHA-256 fingerprint, file size, row count, and column count for the source
dataset.

### 4.2 Profiling

The profiling service calculates:

- Row and column counts.
- Column data types.
- Missing-value counts.
- Duplicate-row counts.
- Numeric descriptive statistics.
- Top categorical-value counts.
- IQR-based unusual numeric-value counts.
- A weighted data-quality score.

The quality score is explicitly a data-quality indicator, not model prediction
accuracy. Profiles are cached by dataset fingerprint and cache version so
reprocessing identical input can reuse the profile.

### 4.3 ECP Cleaning (S1-S7)

Cleaning is the E-commerce Cleaning Pipeline (ECP) from the thesis,
implemented in `backend/app/services/ecp/`. It recognises the UCI Online
Retail columns (InvoiceNo, StockCode, Description, Quantity, InvoiceDate,
UnitPrice, CustomerID, Country) and common alternative names.

| Stage | What it does |
| --- | --- |
| S1 Profile | Counts types, blanks and distinct values; makes IDs text, quantities and prices numbers, dates dates. |
| S2 Standardise | Trims and collapses spaces; upper-cases invoice, stock code and description; maps countries with an alias table and fuzzy matching (similarity >= 0.85 and target >= 20x more frequent); real country names are never fuzzy-matched, so Iceland is not merged into Ireland. |
| S3 Deduplicate | Removes exact duplicates after S2, so near-duplicates are caught too. |
| S4 Shop rules | Moves returns (C invoices), adjustments (A invoices, adjustment codes, negative quantity without price) and fees (POST, DOT, ..., plus any stock code that is not a 5-digit product code, such as gift vouchers, when at least 90% of codes follow that format) to side tables; makes negative quantities on priced sales positive; treats zero prices as missing. |
| S5 Dependencies | Tests invoice->customer, invoice->country, product->description, customer->country; uses a rule only if >= 90% of rows follow it, then fills blanks and fixes minority values. Guest orders (no customer anywhere on the invoice) stay blank. |
| S6 Unusual values | Log-scale modified z-score (threshold 3.5) per product, and per guest/account for prices. A value seen >= 8 times, or a quantity normal for the customer, is genuine. Decimal slips are repaired only to a price charged >= 2 times; anything else goes to review. Quantities are flagged, never changed. |
| S7 Fill and validate | Fills missing prices from the same product on the same day, then the same customer, then overall; runs quality checks. |

Every change is recorded with stage, row (1-based row in the uploaded file),
column, action, old value, new value and reason. Settings are in
`ECPConfig` (`ecp/config.py`); defaults follow the thesis. The minimum group
size for z-scores (5) is an implementation choice not stated in the thesis.

Datasets without the order columns run in **generic mode**: S1 (profile
only), S2 (trim spaces), S3, then a general fill (median or most common
value) that is not part of ECP; S4-S6 are skipped. Columns more than 30%
blank are reported, not filled.

On the real UCI Online Retail data (541,909 rows) ECP takes about 15 seconds
on the development machine and reproduces the thesis figures for S1-S5 and S7
exactly: 523,660 sales lines, 132,477 guest lines kept, 133,102 text cells
standardised, 6,712 descriptions repaired and 570 filled, no fuzzy country
changes, no outlier repairs, and 126,012 of value added by filling missing
prices. The S6 review queue differs (7,845 rows against 5,795 in the thesis)
because the thesis does not fully specify the S6 rules (see ECPConfig).

Before-and-after quality scores and the quality change are persisted with the
job.

### 4.4 Feature Transformation

Implemented transformations include:

- Removing constant predictor columns.
- Extracting year, month, and day from consistently parseable date columns.
- Min-max scaling of numeric predictor columns.
- Creating an interaction feature from the first two numeric predictors.
- Removing exact duplicate predictor columns.
- Preserving the detected target column from feature transformations.

The target column is detected using `target`, `label`, or `y`. Transformation
steps and generated columns are returned as structured metadata.

### 4.5 Automated Machine Learning

The ML service selects a workflow based on the dataset:

- **Classification:** Random Forest and optional XGBoost classifiers,
  accuracy, confusion matrices, winner selection, and feature importance.
- **Regression:** Random Forest and optional XGBoost regressors, RMSE, R²,
  predictions, winner selection, and feature importance.
- **Unsupervised analysis:** KMeans clustering with silhouette score and
  Isolation Forest anomaly counts when no target exists and enough numeric data
  is available.
- **No-result handling:** explicit explanations for empty, too-small, or
  otherwise insufficient datasets.

## 5. Results, Auditability, and Performance

Completed jobs persist profile, cleaning, transformation, ML, visualization,
and audit data as JSON in SQLite. The pipeline also generates:

- `original.<extension>`
- `cleaned.<extension>`
- `transformed.<extension>`
- `audit-log.csv` (every ECP change; jobs from before ECP have `audit-log.json`)
- `review.csv` (rows flagged for review, with the reason)
- `side-returns.csv`, `side-fees.csv`, `side-adjustments.csv`,
  `side-duplicates.csv` (rows moved out of the sales data, when present)
- `report.pdf`

The results JSON holds the ECP summary plus samples of the audit log and
review queue; the full logs are in the CSV files.

The PDF report contains the job ID, dataset dimensions, quality score, cleaning
action count, uncertain-case count, quality change, ML mode, winning model, and
feature-importance count.

Each major processing stage records:

- Stage name.
- Start timestamp.
- Duration in milliseconds.
- Peak traced memory (only when `AUTODATA_TRACE_MEMORY=true`; tracing makes
  the pipeline several times slower, so it is off by default and reported as 0).
- Number of rows processed.

The telemetry is available through:

```text
GET /api/v1/jobs/{job_id}/performance
```

The benchmark command can measure profiling, cleaning, transformation, and
analysis stages for configurable row counts and repetitions.

## 6. Implemented API Surface

### Authentication

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`

### Jobs

- `POST /api/v1/jobs/upload`
- `GET /api/v1/jobs/history`
- `GET /api/v1/jobs/{job_id}/status`
- `GET /api/v1/jobs/{job_id}/results`
- `GET /api/v1/jobs/{job_id}/audit-logs`
- `GET /api/v1/jobs/{job_id}/performance`
- `GET /api/v1/jobs/{job_id}/download/{artifact}`

Supported download artifacts are `original`, `cleaned`, `transformed`,
`report`, `log`, `review`, `returns`, `fees`, `adjustments`,
`duplicates` and `all` (a ZIP of every file). Raw filesystem paths are not
returned to the frontend. `GET /api/v1/jobs/history` also returns rows,
quality before and after cleaning, and total duration per job.


## 7. Implemented Frontend Workspace

The React application (`frontend/src/`) has one file per page in `pages/`,
shared components in `components/`, and the app shell in `App.tsx`:

1. Dashboard: upload (click or drag and drop), job counts, average quality
   after cleaning, recent datasets, and pipeline progress per step.
2. Data Profiling: types, blanks, numeric summary, common text values.
3. ECP Cleaning: S1-S7 with counts and details per stage, the S5 dependency
   rules and their support, invoice totals, and the S7 validation checks.
4. Audit Log: every change (old value, new value, reason) with stage, action
   and text filters; the review queue; open issues.
5. Data Transformation: steps applied and the resulting columns.
6. Machine Learning: accuracy, precision, recall, F1, ROC AUC, MCC, the
   confusion matrix and ROC curve (classification); R², RMSE, MAE and actual
   vs predicted (regression); clusters, silhouette per k, cluster profiles and
   anomalies (clustering). The reason is shown when no model was trained.
7. Visual Analytics: blank values before and after cleaning, what each ECP
   stage did, a distribution per numeric column, and the correlation heatmap.
8. Performance: time per pipeline stage and per ECP stage.
9. Reports & Downloads: every artifact the job produced, plus a ZIP of all.
10. Job History: rows, quality before and after, duration, search, filters,
    per-job download and delete.

Every number shown comes from the backend; a value that was not calculated
is shown as "—". Pages render through `JobGate`, which handles the no-job,
queued, processing, failed and loading states, so a page cannot crash when
a job finishes while it is open. Jobs processed before ECP show a message
asking for a re-upload instead of empty sections. Plotly is loaded only when
the first chart is shown.

The API client centralizes upload, history, status, results, performance,
artifact-download and delete requests. Its default API base is `/api/v1`,
with `VITE_API_BASE_URL` available for deployment overrides.

## 8. Verification Currently Present

Backend tests cover:

- Profile, cleaning, and transformation auditability.
- Target preservation during transformation.
- Deterministic dataset fingerprints.
- Benchmark stage measurement.
- Profile-cache round trips.
- Health behavior and data workflow behavior.

The frontend test suite verifies that the application renders the AutoData AI
platform header. Backend and frontend commands are documented in
[`README.md`](./README.md).

## 9. Current Limitations

The following behavior is intentionally conservative or environment-dependent:

- XGBoost evaluation is available only when the optional dependency is
  installed.
- Ambiguous missingness, numeric outliers, and unsupported business rules are
  flagged for review rather than automatically changed.
- Cleaned `.xls` output is not written; CSV and XLSX should be used for
  generated spreadsheet artifacts.
- SQLite and in-process background tasks are intended for local development,
  not distributed production workloads.
- The default development secret key must be replaced through
  `AUTODATA_SECRET_KEY` before production use.
