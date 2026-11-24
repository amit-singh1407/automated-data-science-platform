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
- Bearer-token validation on protected endpoints.
- Job ownership checks for status, results, history, audit logs, performance
  data, and artifact downloads.
- Logout in the frontend by clearing the active client session.

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

### 4.3 Explainable Cleaning

Cleaning is split into two auditable rule sets:

- **ECP rules:** schema inspection, duplicate removal, text whitespace
  normalization, ambiguous-missingness flags, ecommerce-field validation
  markers, dependency-preservation markers, numeric-range validation markers,
  and finalization.
- **General rules:** median imputation for numeric missing values and mode
  imputation for categorical missing values.

Every applied action records its rule set, rule name, column where applicable,
affected-row count, and reason. Cases that cannot be safely inferred are
reported as `uncertain_cases` instead of being silently modified.

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
- `audit-log.json`
- `report.pdf`

The PDF report contains the job ID, dataset dimensions, quality score, cleaning
action count, uncertain-case count, quality change, ML mode, winning model, and
feature-importance count.

Each major processing stage records:

- Stage name.
- Start timestamp.
- Duration in milliseconds.
- Peak traced memory.
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

### Jobs

- `POST /api/v1/jobs/upload`
- `GET /api/v1/jobs/history`
- `GET /api/v1/jobs/{job_id}/status`
- `GET /api/v1/jobs/{job_id}/results`
- `GET /api/v1/jobs/{job_id}/audit-logs`
- `GET /api/v1/jobs/{job_id}/performance`
- `GET /api/v1/jobs/{job_id}/download/{artifact}`

Supported download artifacts are `original`, `cleaned`, `transformed`,
`report`, and `log`. Downloads are authenticated and ownership-checked; raw
filesystem paths are not returned to the frontend.

## 7. Implemented Frontend Workspace

The React application includes these navigable workspace sections:

1. Dashboard
2. Dataset Upload
3. Data Profiling
4. Automated Cleaning
5. Data Transformation
6. Machine Learning
7. Visual Analytics
8. Audit Logs
9. Reports & Downloads
10. Job History

The frontend implements:

- Login and registration forms with API error display.
- Authenticated dataset upload.
- Automatic job-history refresh after upload.
- Polling until a job completes or fails.
- Progress percentage and stage messages.
- Loading of results and audit logs after completion.
- JSON result views for profile, cleaning, transformation, and ML sections.
- Plotly visualizations for missing values, quality, outliers, cleaning
  summaries, and ML results.
- Authenticated downloads for all generated artifacts.
- Job selection and historical-job review.

The API client centralizes authentication, upload, history, status, results,
audit-log, and artifact-download requests. Its default API base is
`/api/v1`, with `VITE_API_BASE_URL` available for deployment overrides.

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
