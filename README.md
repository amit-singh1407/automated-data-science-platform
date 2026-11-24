# AutoData AI

AutoData AI is a full-stack automated data science platform with:

- React + Vite frontend (Tailwind, Lucide)
- FastAPI backend under versioned REST endpoints (`/api/v1/*`)
- Automated upload-to-processing workflow
- Separate thesis-based ECP rules and general cleaning rules
- Audit trail, job history, downloadable artifacts, and PDF reports
- SQLite persistence for local development
- Plotly-based visual analytics for missing values, outliers, and quality scores
- Progress reporting for each processing stage

## Implemented Pages

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

## Backend APIs (`/api/v1`)

### Auth
- `POST /auth/register`
- `POST /auth/login`

### Jobs
- `POST /jobs/upload`
- `GET /jobs/{job_id}/status`
- `GET /jobs/{job_id}/results`
- `GET /jobs/{job_id}/audit-logs`
- `GET /jobs/{job_id}/download/{artifact}`
- `GET /jobs/history`

## Local Run (without Docker)

### Backend
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

If running from the project root instead of `backend`, use:

```powershell
python -m uvicorn app.main:app --app-dir backend --reload --host 0.0.0.0 --port 8000
```

If your terminal is at `D:\CleanCart`, first enter the project directory:

```powershell
cd D:\CleanCart\automated-data-science-platform
.\start-backend.ps1
```

Or run it directly from `D:\CleanCart`:

```powershell
python -m uvicorn app.main:app --app-dir D:\CleanCart\automated-data-science-platform\backend --reload --host 0.0.0.0 --port 8000
```

The backend reads these optional environment variables:

- `AUTODATA_SQLITE_PATH` (default: `autodata.db`)
- `AUTODATA_SECRET_KEY`
- `AUTODATA_MAX_UPLOAD_SIZE_MB`

For local development, copy [`.env.example`](backend/.env.example) to `.env` inside
the `backend` folder and replace `AUTODATA_SECRET_KEY` with a long random value.

### Frontend
```powershell
cd frontend
npm install
npm run dev
```

Open: `http://localhost:5173`

### Performance benchmark

Run a measured backend benchmark without inventing performance results:

```powershell
cd backend
python -m app.services.benchmarking --sizes 10000,100000 --repetitions 1 --output benchmark-results.json
```

The report contains runtime metadata, total duration, stage timings, peak
traced allocations, and rows processed. Completed jobs also expose stage
telemetry through `GET /api/v1/jobs/{job_id}/performance`.

The backend creates request-scoped SQLite connections with thread checking
disabled because synchronous FastAPI endpoints may execute across worker
threads. Connections are still opened and closed per request.

From `D:\CleanCart`, the root npm wrapper can be used instead:

```powershell
npm run install:frontend
npm run dev
```

The wrapper forwards `dev`, `build`, `test`, and `preview` commands to
`automated-data-science-platform/frontend`.

## Docker Run

```powershell
docker compose up --build
```

- Frontend: `http://localhost:5173`
- Backend docs: `http://localhost:8000/docs`

## Processing Workflow

After upload, each job is isolated in its own folder and processed automatically:

1. File validation (type + size)
2. Profiling (types, nulls, duplicates, summaries, quality score)
3. Seven-stage ECP cleaning rules
4. General cleaning rules
5. Feature transformation
6. Automated ML selection/evaluation
7. Visualization payload generation
8. Artifact output:
   - original dataset
   - cleaned dataset
   - transformed dataset
   - audit log JSON
   - PDF report

The ML result includes an explicit task mode, evaluation metrics, feature importance
when a tree model supports it, confusion matrices for classification, and Isolation
Forest anomaly counts for unsupervised numeric datasets.

## Security and API Guarantees

- JWT-authenticated endpoints for user isolation.
- SQLite-backed users and jobs with unique email and job-history indexes.
- Job ownership enforced in all job reads/downloads.
- No filesystem paths returned to frontend.
- Ambiguous cleaning cases are flagged, not auto-mutated.
- Original uploaded dataset is preserved.

## Testing

### Backend
```powershell
cd backend
pytest
```

### Frontend
```powershell
cd frontend
npm test
```
