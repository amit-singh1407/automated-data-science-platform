# AutoData AI Implementation Plan

## 1. Project Goal

AutoData AI is a full-stack automated data science platform that allows users to:

1. Create an account and authenticate securely.
2. Upload a dataset.
3. Profile the dataset automatically.
4. Apply explainable cleaning rules.
5. Transform features for downstream analysis.
6. Run automated machine-learning analysis.
7. Generate visual analytics.
8. Review audit logs.
9. Download processed datasets and reports.
10. Review historical processing jobs.

The implementation supports local development with SQLite and Docker-based execution.

## 2. Technology Stack

### Backend

- Python
- FastAPI
- Pydantic and `pydantic-settings`
- SQLite
- Pandas and NumPy
- Scikit-learn
- XGBoost when available
- ReportLab
- JWT authentication
- Bcrypt password hashing

### Frontend

- React
- TypeScript
- Vite
- Tailwind CSS
- Lucide React icons
- Plotly.js
- Vitest
- React Testing Library

### Supported Dataset Formats

- CSV
- XLS
- XLSX
- Parquet

## 3. Repository Structure

```text
automated-data-science-platform/
├── backend/
│   ├── app/
│   │   ├── api/v1/
│   │   │   ├── endpoints/auth.py
│   │   │   └── endpoints/jobs.py
│   │   ├── core/config.py
│   │   ├── db/database.py
│   │   ├── services/
│   │   │   ├── cleaning.py
│   │   │   ├── file_storage.py
│   │   │   ├── ml.py
│   │   │   ├── pipeline.py
│   │   │   ├── profiling.py
│   │   │   ├── reporting.py
│   │   │   ├── security.py
│   │   │   └── transformation.py
│   │   ├── main.py
│   │   └── schemas.py
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── api.ts
│   │   ├── types.ts
│   │   └── App.test.tsx
│   └── package.json
├── docker-compose.yml
└── README.md
```

## 4. Backend Foundation

### 4.1 FastAPI Application

The backend exposes:

- `GET /health`
- `GET /`
- Versioned API routes under `/api/v1`

The application:

- Initializes the SQLite database at startup.
- Creates the uploads directory.
- Enables CORS for local frontend development.
- Registers authentication and job routers.

### 4.2 Configuration

Configuration is centralized in `backend/app/core/config.py`.

Supported environment variables include:

- `AUTODATA_SQLITE_PATH`
- `AUTODATA_UPLOADS_ROOT`
- `AUTODATA_SECRET_KEY`
- `AUTODATA_MAX_UPLOAD_SIZE_MB`

Defaults are provided for local development, while production deployments can override them through environment configuration.

### 4.3 Database

SQLite persistence includes:

#### Users

- User ID
- Email address
- Hashed password
- Creation timestamp

#### Jobs

- Job ID
- Owner user ID
- Original filename
- Processing status
- Error message
- Profile JSON
- Cleaning JSON
- Transformation JSON
- Machine-learning JSON
- Visualization JSON
- Audit JSON
- Progress percentage
- Progress message
- Creation and update timestamps

Indexes support efficient job-history queries by user and creation time.

## 5. Authentication Implementation

### Registration

`POST /api/v1/auth/register`

The registration flow:

1. Validates email format.
2. Requires a password between 8 and 128 characters.
3. Normalizes the email to lowercase.
4. Rejects duplicate email addresses.
5. Hashes the password with Bcrypt.
6. Creates the user.
7. Returns a JWT bearer token.

### Login

`POST /api/v1/auth/login`

The login flow:

1. Normalizes the email.
2. Retrieves the stored password hash.
3. Verifies the password.
4. Returns a signed JWT token.
5. Rejects invalid credentials with an authentication error.

### Authorization

Protected endpoints:

- Require a bearer token.
- Decode and validate the JWT.
- Verify that the user exists.
- Restrict job access to the authenticated owner.

## 6. Upload Workflow

`POST /api/v1/jobs/upload`

The upload process:

1. Creates a unique job ID.
2. Stores a queued job record.
3. Validates the filename and extension.
4. Enforces the configured upload-size limit.
5. Creates an isolated job directory.
6. Preserves the original upload as `original.<extension>`.
7. Schedules background processing.
8. Returns the job ID and queued status.

Each job has its own directory, preventing artifacts from different users or jobs from being mixed.

## 7. Automated Processing Pipeline

The pipeline is implemented in `backend/app/services/pipeline.py`.

### Stage 1: Load Dataset

The original file is loaded using the appropriate Pandas reader:

- `read_csv`
- `read_excel`
- `read_parquet`

### Stage 2: Profile Dataset

The profiling service calculates:

- Row count
- Column count
- Data types
- Missing-value counts
- Duplicate-row counts
- Numeric summaries
- Categorical summaries
- Unusual numeric values using an IQR-based rule
- A weighted quality score

The profile is preserved before cleaning to support before/after comparison.

### Stage 3: ECP Cleaning Rules

The ECP cleaning service applies explainable rules:

- Schema inspection
- Duplicate-row removal
- Text whitespace normalization
- E-commerce field validation marker
- Ambiguous missingness detection
- Numeric-range validation marker
- Final dataset completion marker

Rules that cannot be safely inferred are recorded as uncertain cases rather than silently mutating the data.

### Stage 4: General Cleaning Rules

General cleaning includes:

- Numeric missing-value imputation using the median.
- Categorical missing-value imputation using the mode.
- Unresolvable categorical missing values are flagged as uncertain.

Every action records:

- Rule set
- Rule name
- Column
- Number of affected rows
- Reason

### Stage 5: Feature Transformation

The transformation service prepares data for analysis, including supported date-derived features and other transformation steps defined by the project.

Transformation details are stored separately from the transformed artifact so the workflow remains auditable.

### Stage 6: Automated Machine Learning

The ML service detects the workflow mode:

#### Supervised Classification

When a target-like column is available:

- Detects `target`, `label`, or `y`.
- Uses preprocessing for numeric and categorical columns.
- Evaluates Random Forest.
- Evaluates XGBoost when available.
- Calculates accuracy.
- Generates confusion matrices.
- Reports feature importance when supported.

#### Supervised Regression

For numeric targets:

- Evaluates Random Forest regression.
- Evaluates XGBoost regression when available.
- Calculates RMSE.
- Calculates R² score.
- Stores predictions.
- Reports feature importance when supported.

#### Unsupervised Analysis

When no target is found and sufficient numeric data exists:

- Runs KMeans clustering.
- Calculates silhouette score.
- Runs Isolation Forest anomaly detection.
- Reports the number of detected anomalies.

If there is insufficient data, the result clearly reports that no reliable ML result is available.

### Stage 7: Visualization Payloads

The pipeline creates frontend-ready visualization data for:

- Missing values
- Quality score
- Before/after quality comparison
- Unusual numeric values
- Cleaning-rule summary
- Machine-learning results

The frontend renders these payloads using Plotly.

### Stage 8: Artifact Generation

Each completed job produces:

- Original dataset
- Cleaned dataset
- Transformed dataset
- Audit log JSON
- PDF report

The report includes:

- Job ID
- Dataset dimensions
- Quality score
- Cleaning action count
- Uncertain case count
- Quality change
- ML mode
- Winning model
- Feature-importance count

### Stage 9: Persist Results

The completed job stores all result sections as JSON in SQLite and transitions to:

```text
completed
```

Progress reaches 100% with a completion message.

## 8. Job Status and History APIs

### Status

`GET /api/v1/jobs/{job_id}/status`

Returns:

- Job ID
- Status
- Progress
- Progress message
- Error message
- Creation timestamp
- Update timestamp

### Results

`GET /api/v1/jobs/{job_id}/results`

Returns:

- Profile
- Cleaning details
- Transformation details
- Machine-learning results
- Visualization payloads
- Report availability
- Download links

Results are only available after the job reaches `completed`.

### Audit Logs

`GET /api/v1/jobs/{job_id}/audit-logs`

Returns the audit entries associated with the selected job.

### History

`GET /api/v1/jobs/history`

Returns the authenticated user's jobs ordered from newest to oldest.

### Artifact Downloads

`GET /api/v1/jobs/{job_id}/download/{artifact}`

Supported artifacts:

- `original`
- `cleaned`
- `transformed`
- `report`
- `log`

All downloads verify job ownership before returning a file.

## 9. Background-Processing Reliability

The processing pipeline now guarantees a terminal state for unexpected errors.

If an unexpected exception occurs:

1. The error is caught by the background task boundary.
2. The job is changed to `failed`.
3. The error message is persisted.
4. The frontend can display the failure through the status endpoint.

This prevents jobs from remaining indefinitely in `processing`.

## 10. Frontend Application

The React frontend provides:

- Authentication screen
- Dataset upload interface
- Job history
- Job selection
- Status polling
- Progress messaging
- Visual analytics
- Section-specific result views
- Audit-log display
- Download controls

### Authentication UX

Users can:

- Log in.
- Register.
- Switch between login and registration.
- See API validation errors.
- Log out and clear current session state.

### Upload UX

The upload panel:

- Accepts supported dataset formats.
- Displays the selected filename.
- Starts the workflow after authentication.
- Refreshes job history.
- Automatically selects the newly created job.

### Status Polling

After a job is selected, the frontend polls the status endpoint until the job is:

- Completed
- Failed

On completion, the frontend loads results and audit logs.

### Workspace Navigation

All planned workspace pages are now accessible through the sidebar:

- Dashboard
- Dataset Upload
- Data Profiling
- Automated Cleaning
- Data Transformation
- Machine Learning
- Visual Analytics
- Audit Logs
- Reports & Downloads
- Job History

### Section Views

Completed jobs expose:

- JSON profile details
- Cleaning actions and quality changes
- Transformation steps
- ML evaluation output
- Plotly visual analytics
- Audit entries
- Download buttons
- Selected-job details

### Authenticated Downloads

The frontend downloads artifacts through authenticated API requests rather than exposing unauthenticated file URLs.

Downloaded artifacts include:

- Original dataset
- Cleaned dataset
- Transformed dataset
- Audit log
- PDF report

## 11. Frontend API Client

The API client centralizes:

- Registration
- Login
- Upload
- History retrieval
- Status retrieval
- Result retrieval
- Audit-log retrieval
- Artifact downloads

The API base URL defaults to `/api/v1` and can be overridden with:

```text
VITE_API_BASE_URL
```

## 12. Testing and Validation

### Backend Tests

The backend test suite verifies:

- Health endpoint availability.
- Profile generation.
- Duplicate detection.
- Cleaning auditability.
- Numeric imputation.
- Date transformation.

Current result:

```text
2 passed
```

### Frontend Tests

The frontend test suite verifies that the application renders the AutoData AI platform header.

Current result:

```text
1 passed
```

### Frontend Build

The TypeScript and Vite production build completes successfully.

The build reports a non-blocking bundle-size warning because Plotly.js produces a large client bundle.

## 13. Local Development

### Backend

```powershell
cd D:\CleanCart\automated-data-science-platform\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```powershell
cd D:\CleanCart\automated-data-science-platform\frontend
npm install
npm run dev
```

### Root Commands

From `D:\CleanCart`:

```powershell
npm run install:frontend
npm run dev
npm run build
npm run test
```

## 14. Docker Execution

```powershell
cd D:\CleanCart\automated-data-science-platform
docker compose up --build
```

Services:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`
- Backend API documentation: `http://localhost:8000/docs`

## 15. Current Completion Status

### Completed

- Full FastAPI backend foundation
- SQLite persistence
- JWT authentication
- Password hashing
- User-isolated jobs
- Dataset upload validation
- Multi-format dataset loading
- Automated profiling
- ECP cleaning rules
- General cleaning rules
- Feature transformation
- Automated ML analysis
- Visualization payload generation
- PDF report generation
- Audit logging
- Job progress tracking
- Job status API
- Job results API
- Job history API
- Authenticated artifact downloads
- React frontend
- Authentication UX
- Dataset upload UX
- Job polling
- Workspace navigation
- Section-specific result views
- Plotly analytics
- Download panel
- Background failure handling
- Backend tests
- Frontend tests
- Production frontend build
- Local and Docker run instructions

### Known Non-Blocking Item

The production frontend build emits a bundle-size warning because Plotly.js is included in the client bundle. The application still builds successfully and all tests pass.

## 16. Final Verification Commands

Run the following from `D:\CleanCart`:

```powershell
npm run build
npm test
Push-Location automated-data-science-platform\backend
python -m pytest
Pop-Location
```

Expected results:

- Frontend build succeeds.
- Frontend tests pass.
- Backend tests pass.

## 17. Advanced Upgrade Progress

The incremental high-performance upgrade has started without replacing the
existing architecture.

### Implemented in the first upgrade slice

- Added SHA-256 dataset fingerprints.
- Added stage-level duration measurements.
- Added peak traced-memory measurements.
- Added rows-processed telemetry.
- Added runtime metadata for reproducibility.
- Added additive `job_stages` persistence.
- Added additive `dataset_fingerprints` persistence.
- Added `GET /api/v1/jobs/{job_id}/performance`.
- Added a measured benchmark runner at `backend/app/services/benchmarking.py`.
- Generated an actual 10,000-row benchmark report at
  `backend/benchmark-results.json`.
- Added a versioned SQLite profile cache keyed by dataset fingerprint.
- Recorded profile cache hits in the audit metadata.
- Preserved ECP rules as a separate stage from general cleaning.
- Prevented target columns from being scaled or used for generated feature
  engineering.
- Added constant and exact duplicate feature detection with audit details.
- Improved classification splitting with stratification when valid.
- Corrected feature importance extraction to use the winning fitted pipeline.

### Current measured benchmark

The first benchmark was executed on the development machine with Python 3.14
and 10,000 generated rows. It recorded:

- Total duration: `5448.952 ms`
- Profiling: `74.840 ms`
- Cleaning: `9.564 ms`
- Transformation: `67.893 ms`
- Analysis: `5295.897 ms`

These are measurements from the current environment, not projected targets.
The analysis stage and memory allocation should be treated as optimization
priorities in the next slice.

### Runtime fix completed

The synchronous FastAPI database dependency now supports worker-thread
execution by using request-scoped SQLite connections with
`check_same_thread=False`. This fixes authenticated history, status, results,
and audit-log requests that could otherwise fail with SQLite's thread-affinity
error. A regression test covers the authenticated dependency path.

### Remaining upgrade phases

1. Optimize profiling and analysis using bounded summaries and selective
   Polars, DuckDB, and PyArrow adapters.
2. Expand the cache to chart payloads and compatible analytical results.
3. Add leakage-safe fitted transformation and feature-selection pipelines.
4. Expand bounded AutoML model comparison and metrics.
5. Add optional SHAP explainability with safe fallbacks.
6. Lazy-load and aggregate Plotly visualizations.
7. Add data-quality insights, lineage, drift detection, and reproducibility
   endpoints.
8. Run baseline-versus-optimized benchmarks at 10,000, 100,000, and 500,000
   rows where hardware permits.
