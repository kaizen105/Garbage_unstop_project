# SafaiKavach

SafaiKavach is an intake and dispatch platform for road hazards including biomedical waste, loose electrical wiring, chemical leaks, demolition debris, and open garbage heaps. It provides voice and text intake, PostGIS municipal ward tagging, deterministic dispatch routing, statistical early warning anomaly detection, and weekly mitigation plan generation. All data is synthetic.

Live deployment: https://garbage-unstop-project.vercel.app

## 2. Architecture

The system consists of a Next.js web application interfacing with Neon PostgreSQL (with PostGIS extensions), external speech-to-text services, and LLM inference providers.

```mermaid
flowchart TD
    subgraph Client["Client Browser"]
        UI["React 19 Dashboard and Leaflet Map"]
        AudioIntake["Voice Recorder: MediaRecorder Audio Blob"]
        TextIntake["Text Form: Hazard Description and GPS"]
    end

    subgraph Server["Next.js Server: Node.js"]
        ActionSubmit["Server Action: submitReport"]
        RouteReport["POST /api/report"]
        RouteEarlyWarning["GET /api/early-warning"]
        RouteMitigation["POST /api/mitigation-plan"]
        RouteAudit["POST /api/audit"]
        RouteStats["GET /api/stats"]
        RateLimiter["checkRateLimit: PostgreSQL Fixed-Window"]
        MitigationLock["tryAcquireMitigationLock: 60s Row Lock"]
        DispatchRules["Deterministic getActionRequired"]
        Grounding["groundPlan: Anti-Hallucination Verification"]
    end

    subgraph External["External APIs"]
        GnaniSTT["Gnani Speech-to-Text API"]
        LLMProvider["OpenRouter or Mock LLM Provider"]
    end

    subgraph Database["Neon PostgreSQL with PostGIS"]
        PostgisQuery["ST_Covers Spatial Query"]
        PrismaORM["Prisma Client"]
        Tables[("Ward, Report, AuditRun, MitigationPlan, RateLimit")]
    end

    AudioIntake -->|"audio multipart"| RouteReport
    TextIntake -->|"text and coords"| ActionSubmit

    RouteReport --> RateLimiter
    ActionSubmit --> RateLimiter

    RouteReport --> GnaniSTT
    GnaniSTT --> RouteReport
    RouteReport --> LLMProvider
    ActionSubmit --> LLMProvider

    RouteReport --> PostgisQuery
    ActionSubmit --> PostgisQuery
    PostgisQuery --> DispatchRules
    DispatchRules --> PrismaORM

    RouteEarlyWarning --> PrismaORM
    RouteStats --> PrismaORM
    RouteAudit --> PrismaORM

    RouteMitigation --> RateLimiter
    RouteMitigation --> MitigationLock
    RouteMitigation --> PrismaORM
    RouteMitigation --> LLMProvider
    LLMProvider --> Grounding
    Grounding --> PrismaORM

    PrismaORM --> Tables

    RouteReport --> UI
    ActionSubmit --> UI
    RouteEarlyWarning --> UI
    RouteMitigation --> UI
    RouteAudit --> UI
    RouteStats --> UI
```

### Request Flow

1. Report Intake: Spoken audio is uploaded to `/api/report` as multipart form data and transcribed by Gnani STT. Text reports are submitted directly via the `submitReport` Server Action.
2. Rate Limiting: Requests are checked against a PostgreSQL table (`RateLimit`) per client IP before running external APIs or database writes.
3. Extraction: The server passes transcripts or text to the LLM (or mock fallback) to extract hazard category, severity score (1 to 10), and location text.
4. Coordinate Resolution: Coordinates are obtained from browser GPS coordinates or matched against a static gazetteer of Delhi landmark coordinates.
5. Spatial Ward Tagging: Coordinates are matched against 290 MultiPolygon ward boundaries using PostGIS `ST_Covers`.
6. Deterministic Dispatch: Hazard category and severity determine the action required: `dispatch_hazmat_bypass_standard`, `bypass_standard`, or `routine_collection`. Clients cannot select or override this classification.
7. Storage: Validated reports are persisted to the `Report` table via Prisma.

## 3. Features and Limitations

### Spatial Ward Tagging with ST_Covers
* Capability: Automatically maps latitude and longitude coordinates to one of 290 legacy pre-2022 Delhi MCD ward polygons using the PostGIS spatial relationship `ST_Covers`.
* Limitation: Points must fall strictly inside the defined MultiPolygon boundary of a ward. Coordinates outside Delhi regional bounds or missing coordinates return an unmapped status. Wards reflect 290 legacy pre-2022 Delhi MCD ward polygons from DataMeet rather than the current official 2022 250-ward delimitation, and certain polygons contain boundary overlaps.

### In-Memory Marker Clustering and Incident Inspection
* Capability: Pure in-memory approximate fixed-grid clustering (`clusterReports`) groups dense incident points into cluster count bubbles across ~1.8km spatial grid cells without third-party GIS library dependencies. Clicking any marker or cluster opens an Incident Inspection Drawer presenting full incident telemetry, category, severity, coordinates, and dispatch classification.
* Limitation: Fixed-grid clustering is an approximate visual aggregation using fixed-interval coordinate rounding. It is not distance-based clustering (such as DBSCAN) nor zoom-aware dynamic clustering (such as Supercluster). Incident points separated by a few meters that straddle a grid-cell boundary are placed into adjacent buckets rather than merged. Clustering operates client-side on the currently loaded slice of incident markers (e.g. 50 to 300 reports).

### Early Warning Hotspot Detection and Trajectory Visualizations
* Capability: Groups historical reports into four consecutive 7-day buckets (W-3, W-2, W-1, W0) per ward. Identifies wards experiencing unusual volume using standardized z-scores against baseline moving averages and estimates next-week volumes using linear trend extrapolation. Visualizations feature analytical KPI summary cards, citywide category distributions, risk tier classifications, and 4-week trajectory sparklines showing observed counts alongside projected estimates.
* Limitation: Requires at least four weekly buckets. Anomaly scores are standardized statistical z-scores against short-term baseline variation and are not probability percentages. Linear regression over four observations cannot model seasonal patterns, holidays, or weather shifts.

### Weekly Root-Cause Audit
* Capability: Runs bounded SQL queries over recent reports to find spatial clusters and anomalies, running DBSCAN clustering to identify the dominant category and spatial centroid. Generates hypothesis text and recommended actions.
* Limitation: Requires at least three reports of the same hazard category within a single ward in the current week. If insufficient reports exist, the audit returns an insufficient data status.

### Municipal Mitigation Strategy and Department Breakdown
* Capability: Compiles 7-day incident totals, deltas, and severity statistics into structured operational mandates across 290 legacy pre-2022 Delhi MCD ward polygons. The `groundPlan` function verifies all LLM output against raw SQL aggregates to eliminate hallucinated wards, counts, or categories. The dashboard renders an Executive Operational Directive, Department Allocation Overview, and priority intervention cards partitioned into Quantitative Evidence, Diagnostic Hypotheses, and Prescribed Operational Actions.
* Limitation: Synthesizes priorities only for wards with recorded incidents in the last 7 days. Causes generated by the model are unconfirmed hypotheses, not verified root causes.

## 4. Synthetic Data Methodology

The repository contains a synthetic incident dataset of 10,000 rows with ID prefix `SYN-`, plus 60 baseline test rows with ID prefix `HZ-`. All synthetic rows have `isSynthetic = true`.

* Generator: `scripts/generate_synthetic_10k.ts`, executed with fixed pseudo-random seed 42.
* Profiling Origin: Incident category ratios, 24-hour time-of-day distributions, and day-of-week patterns were profiled from public Bengaluru grievance data (126,974 records). Only solid waste and electrical categories were mapped.
* Assumptions: Construction debris (10%), chemical leaks (3%), and unknown categories (2%) were assigned as baseline assumptions because they were not present in the public source dataset.
* Spatial Placement: Incident points were sampled within Delhi MCD ward polygon geometries using a two-tier Pareto distribution where the top 25 wards receive approximately 60% of baseline volume.
* Planted Spikes: Four wards contain artificial spikes added during the most recent 7-day window (W0) to verify detection pipelines:
  * RAJENDER NAGAR (Karol Bagh): 70 biohazard incidents
  * NDMC CHARGE 2 (Connaught Place): 65 electrical hazard incidents
  * AMAR COLONY (Lajpat Nagar): 55 chemical hazard incidents
  * PANDAV NAGAR (Laxmi Nagar): 50 general overflow incidents
* Notice: These records are synthetic demonstrations and are not real Delhi incidents.

## 5. Early Warning Method, R2 Rule, and Backtest

### Method
Incidents are aggregated into four consecutive 7-day weekly windows:
* W-3: 28 to 21 days ago
* W-2: 21 to 14 days ago
* W-1: 14 to 7 days ago
* W0: 7 days ago to current timestamp

The baseline mean is calculated over the three prior weeks:
$$ \text{mean} = \frac{W_{-3} + W_{-2} + W_{-1}}{3} $$

Sample variance with 2 degrees of freedom:
$$ s^2 = \frac{\sum_{i=1}^{3} (W_{-i} - \text{mean})^2}{2} $$

Effective standard deviation applies a floor to prevent division by zero or inflated scores on low baseline counts:
$$ \text{std} = \max\left(\max(1, \sqrt{\text{mean}}), \sqrt{s^2}\right) $$

Anomaly score:
$$ z = \frac{W_0 - \text{mean}}{\text{std}} $$

Next-week volume is estimated using ordinary least squares linear regression over indices 0, 1, 2, 3 corresponding to W-3, W-2, W-1, W0.

### The R2 Classification Rule with MIN_HIGH=13
Wards are classified into risk tiers:
* High: $z \ge 2.0$ AND $W_0 \ge 13$ AND $(W_0 - \text{mean}) \ge 3$
* Medium: $z \ge 1.0$ OR (week-over-week increase $\ge 50\%$ with $W_0 \ge 2$ and $W_{-1} \ge 3$)
* Low: All other qualifying wards

### Backtest Summary (from docs/EARLY_WARNING_BACKTEST.md)
Monte Carlo evaluation was run across seeds 1, 2, 3, 4, 5 (fixed in advance, 5,000 synthetic Poisson trials per cell per seed).

#### False Alarm Rates on Null Series (High Risk)
* Baseline 1: 0.00% (range: 0.00% to 0.00%)
* Baseline 3: 0.00% (range: 0.00% to 0.00%)
* Baseline 5: 0.14% (range: 0.10% to 0.20%)
* Baseline 10: 4.38% (range: 3.86% to 4.94%)
* Baseline 20: 4.38% (range: 3.94% to 4.80%)

#### Detection Rates for 3x Spikes (High Risk)
* Baseline 1: 0.0% (range: 0.0% to 0.0%)
* Baseline 3: 12.2% (range: 11.4% to 13.1%)
* Baseline 5: 70.9% (range: 70.5% to 71.3%)
* Baseline 10: 98.1% (range: 97.8% to 98.4%)
* Baseline 20: 100.0% (range: 100.0% to 100.0%)

#### Tuning Finding
MIN_HIGH=8 fails the 5.00% false alarm limit on the worst seed at baseline 10 (reaching 5.36%). MIN_HIGH=13 is the lowest threshold that passes the 5.00% limit across all baselines on every seed 1 through 5.

#### Stated Limitations
* Anomaly scores are standardized z-scores against short-term baseline moving averages, not probabilities.
* The trend estimate is a linear extrapolation, not a trained predictive forecasting model.
* Four weekly buckets cannot support seasonal inference.
* The backtest covers simulated planted spikes and Poisson arrival processes, not naturally occurring municipal complaint behavior.

## 6. Estimated Prevented Cost

Estimated prevented cost is an illustrative estimate, not measured financial savings.

### Formula
Only reports with non-routine dispatch actions (`actionRequired` not equal to `routine_collection`) are assigned an estimated prevented cost. Routine collection reports evaluate to 0 INR.

$$ \text{Prevented Cost} = \text{Base Cost}(\text{hazardCategory}) \times \frac{\text{severityLevel}}{10} $$

If vehicle bypass routing is active, net illustrative impact subtracts detour vehicle travel cost:
$$ \text{Detour Cost} = \text{Extra Distance (km)} \times 30 \text{ INR/km} $$
$$ \text{Net Impact} = \max(0, \text{Prevented Cost} - \text{Detour Cost}) $$

### Placeholder Base Cost Assumptions
* `chemical`: 120,000 INR
* `biohazard_medical`: 85,000 INR
* `electrical_hazard`: 60,000 INR
* `construction_debris`: 40,000 INR
* `general_overflow`: 5,000 INR
* `unknown`: 10,000 INR

These values are illustrative assumptions with no external source. The dashboard header sums all non-routine rows in the database, including synthetic rows, without date bounds.

## 7. Security and Limits

### Server-Side Demo Reset Guard
The demo reset action (`resetSyntheticData`) is disabled unless `ENABLE_DEMO_RESET="true"` is set on the server. If disabled, it returns an error and executes no database queries. When enabled, it deletes only rows where `isSynthetic = true` and ID begins with `HZ-`. Rows with ID prefix `SYN-` and real user submissions are protected.

### Input Validation
All endpoints validate input using Zod schemas:
* Reports must specify non-empty text or audio.
* Latitude must fall within -90 to 90 and longitude within -180 to 180.
* Delhi bounding box checks in `validateDelhiCoordinates` verify coordinates are between longitude 76.7 to 77.6 and latitude 28.3 to 29.0.
* Invalid payloads immediately return HTTP 400 Bad Request.

### Rate Limiting
Rate limiting is enforced per client IP using fixed time windows backed by the `RateLimit` table in PostgreSQL:
* `/api/report` and `submitReport`: Limited to `RATE_LIMIT_MAX` (default 10) requests per `RATE_LIMIT_WINDOW_SECONDS` (default 600 seconds).
* `/api/transcribe`: Checked against the rate limiter.
* `/api/mitigation-plan`: Enforces both per-IP rate limiting and concurrency locking.
* Fails Open: If the database rate limit query throws, the function catches the error, logs a warning, and allows the request through so database issues do not block citizen intake.

### Mitigation Concurrency Lock
Plan generation uses an atomic database row lock (`lock:mitigation`) with a 60-second time-to-live stored in the `RateLimit` table. This prevents concurrent duplicate LLM synthesis runs across serverless instances without holding database connections open.

## 8. LLM Integration, Model Stack, and Fallbacks

### Model Hypotheses
Root causes and operational recommendations generated by the LLM are diagnostic hypotheses, not confirmed facts.

### Three-Tier OpenRouter Model Stack

SafaiKavach integrates a centralized, sequential three-tier OpenRouter free-tier model stack for both citizen hazard report extraction and municipal mitigation planning.

| Priority Tier | Model Identifier | Purpose and Characteristics |
| :--- | :--- | :--- |
| Primary | `nvidia/nemotron-3.5-lightning:free` | First choice for high-speed structured extraction and mitigation planning (~8.7s to 9.6s workflow latency). |
| Fallback 1 | `baidu/ernie-5.5-flash-preview:free` | Genuinely independent provider fallback running on separate cloud infrastructure outside NVIDIA and Google clusters. |
| Fallback 2 | `openrouter/free` | Dynamic best-effort routing across available free-tier backends. |
| Final Safety Net | Deterministic Application Fallback | Guaranteed offline fallback logic ensuring zero downtime when external endpoints are unreachable. |

### Structured Output and Function Calling

Extensive live evaluation against OpenRouter endpoints established that while candidate models support OpenAI-compatible tool calling, plain JSON mode (`response_format: { type: "json_object" }`) is unreliable for the platform's nested Zod schemas (often dropping nested action arrays or serializing objects as flat strings).

* LangChain Function Calling: The application strictly enforces `withStructuredOutput(schema, { method: "functionCalling" })` across extraction and mitigation workflows.
* Strict Zod Validation: Responses must validate against `RawMitigationPlanSchema` and `ExtractedHazardSchema`. No schema fields have been relaxed or removed to accommodate models.
* Argument Validation: Missing, null, empty, or malformed tool call arguments are trapped as recoverable failures, immediately triggering the next tier in the stack.

### Deterministic Grounding and Anti-Hallucination

The LLM is never the source of truth for numerical counts, ward identifiers, or municipal statistics. All factual data originates strictly from application-controlled database queries.

* Mitigation Grounding (`groundPlan`): Prior to persisting or displaying any mitigation plan, the deterministic `groundPlan` function verifies that every priority's `wardKey` and `category` exist in the raw SQL weekly aggregates. If a model hallucinates an unknown ward key or category, the plan is rejected as invalid, triggering fallback to the next tier.
* Department Definitions: Ownership assignments are restricted to permitted municipal authorities (such as MCD Sanitation Dept, DPCC, Delhi Police, and Health Department).
* Extraction Grounding: Spoken audio transcripts are treated as untrusted data. The prompt explicitly prohibits transcript instructions from modifying extraction categories or rules.

### Sequential Fallback Orchestration

Model routing is handled by a bounded, sequential orchestrator (`executeStructuredWithFallback`):

1. Primary Execution: Attempts `nvidia/nemotron-3.5-lightning:free`.
2. First Fallback: If the primary encounters HTTP 429 rate limits, timeouts, or validation errors, the request falls back to `baidu/ernie-5.5-flash-preview:free` with a brief 500ms backoff on rate-limited responses.
3. Second Fallback: If Baidu ERNIE also fails, the orchestrator attempts `openrouter/free`.
4. Final Application Fallback: If all three LLM tiers are unavailable or fail validation, the system invokes the deterministic fallback:
   * Extraction Fallback: Runs deterministic keyword matching via `mockExtractHazard`, tagging the report with `degraded: true` and preserving citizen intake.
   * Mitigation Fallback: Compiles an operational plan directly from the top-volume rows of the SQL aggregate table via `buildDeterministicFallbackPlan`, guaranteeing 100% data integrity and zero broken layouts.
5. Dynamic Routing of `openrouter/free`: `openrouter/free` routes dynamically across fluctuating backends. It is treated as a best-effort tertiary LLM attempt and is never relied upon as an independent or deterministic endpoint.

### Lightweight Observability

The platform logs clean single-line routing telemetry without capturing sensitive citizen transcripts, personal information, or API credentials:
* Workflow name (`extraction` or `mitigation`)
* Target model identifier and priority tier
* Execution status (`success` or `failure`) and failure category (`rate_limit_429`, `timeout`, `zod_validation`, `malformed_output`, `network_error`, `provider_error`)
* Response latency in milliseconds
* Actual underlying served model reported by OpenRouter (e.g. `openrouter/free (served by <actual>)`)
* Boolean flag indicating whether the deterministic fallback was invoked

## 9. Database Schema and Spatial Query

### Prisma Schema (from prisma/schema.prisma)

```prisma
datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  directUrl  = env("DIRECT_URL")
  extensions = [postgis]
}

generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

enum Role {
  DRIVER
  DISPATCHER
  ADMIN
}

enum HazardCategory {
  biohazard_medical
  construction_debris
  electrical_hazard
  chemical
  general_overflow
  unknown
}

enum ReportStatus {
  OPEN
  DISPATCHED
  RESOLVED
}

enum ActionRequired {
  dispatch_hazmat_bypass_standard
  bypass_standard
  routine_collection
}

model User {
  id        String   @id @default(cuid())
  name      String
  phone     String?
  role      Role     @default(DRIVER)
  wardId    String?
  ward      Ward?    @relation(fields: [wardId], references: [id])
  reports   Report[]
  createdAt DateTime @default(now())
}

model Ward {
  id           String                                  @id @default(cuid())
  externalId   String                                  @unique
  name         String
  sourceWardId String?
  geom         Unsupported("geometry(MultiPolygon, 4326)")?
  users        User[]
  reports      Report[]
  audits       AuditRun[]

  @@index([geom], type: Gist, map: "ward_geom_gist")
}

model Report {
  id                    String         @id
  hazardCategory        HazardCategory
  severityLevel         Int
  rawLocation           String
  lat                   Float?
  lng                   Float?
  transcript            String
  transcriptMock        Boolean        @default(false)
  translatedEnglish     String?
  actionRequired        ActionRequired
  status                ReportStatus   @default(OPEN)
  estimatedPreventedInr Int?
  isSynthetic           Boolean        @default(false)
  reporterId            String?
  reporter              User?          @relation(fields: [reporterId], references: [id])
  wardId                String?
  ward                  Ward?          @relation(fields: [wardId], references: [id])
  createdAt             DateTime       @default(now())
  resolvedAt            DateTime?

  @@index([wardId, createdAt])
}

model AuditRun {
  id              String   @id @default(cuid())
  wardId          String?
  ward            Ward?    @relation(fields: [wardId], references: [id])
  weekStart       DateTime
  dominantAnomaly String
  rootCause       String
  recommendation  String
  createdAt       DateTime @default(now())
}

model MitigationPlan {
  id                String   @id @default(cuid())
  windowStart       DateTime
  windowEnd         DateTime
  model             String
  includesSynthetic Boolean
  aggregatesJson    Json
  planJson          Json
  createdAt         DateTime @default(now())
}

model RateLimit {
  id          String   @id @default(cuid())
  key         String
  windowStart DateTime
  count       Int      @default(1)
  updatedAt   DateTime @updatedAt

  @@unique([key, windowStart], name: "key_windowStart")
  @@index([windowStart])
}
```

### Spatial Query (from src/lib/spatial/wardsDb.ts)

```sql
SELECT id, "externalId", name, "sourceWardId"
FROM "Ward"
WHERE ST_Covers(geom, ST_SetSRID(ST_MakePoint(${lng}::double precision, ${lat}::double precision), 4326))
ORDER BY "externalId"
LIMIT 1;
```

## 10. Setup and Installation

### Prerequisites
* Node.js 22 LTS
* PostgreSQL with PostGIS extension (e.g. Neon Postgres)

### Environment Variables

| Variable Name | Purpose | Scope |
| :--- | :--- | :--- |
| `DATABASE_URL` | Pooled PostgreSQL connection string for application queries | Server only |
| `DIRECT_URL` | Direct PostgreSQL connection string for Prisma migrations | Server only |
| `ENABLE_DEMO_RESET` | Guard enabling demo data reset functionality when set to true | Server only |
| `LLM_PROVIDER` | LLM execution mode: mock, openrouter, or evon | Server only |
| `LLM_BASE_URL` | Base URL for LLM provider API endpoint | Server only |
| `LLM_API_KEY` | API authentication key for LLM provider | Server only |
| `LLM_MODEL_EXTRACT` | Model slug for citizen report hazard extraction | Server only |
| `LLM_MODEL_AUDIT` | Model slug for weekly audit and mitigation planning | Server only |
| `GNANI_API_KEY` | API key for Gnani speech-to-text service | Server only |
| `GNANI_STT_URL` | HTTP endpoint URL for Gnani speech transcription | Server only |
| `NEXT_PUBLIC_MAP_PROVIDER` | Map tile layer provider selection | Client and Server |
| `RATE_LIMIT_MAX` | Maximum number of allowed requests per IP within a rate limit window | Server only |
| `RATE_LIMIT_WINDOW_SECONDS` | Fixed window duration in seconds for IP rate limiting | Server only |

### Setup Commands (Windows PowerShell)

```powershell
# 1. Install dependencies
npm install

# 2. Configure environment
Copy-Item .env.example .env
# Edit .env with your PostgreSQL credentials

# 3. Push database schema to PostgreSQL
npm run db:push

# 4. Import Delhi ward polygon geometries into PostGIS
npm run db:import-wards

# 5. Seed baseline demo records
npm run db:seed

# 6. Optional: Generate 10k synthetic records profiled from public Bengaluru grievance data
npm run gen:10k

# 7. Start development server
npm run dev
```

Open http://localhost:3000 in your browser.

## 11. Testing

All test commands run via Vitest. Counts below reflect verified execution on 2026-11-20.

### Unit and Fallback Tests (Offline)
Unit and fallback tests run entirely in memory without network or database dependencies:
```powershell
npm test
```
Result on 2026-11-20:
* Test Files: 35 passed (35)
* Tests: 231 passed (231)
* Sequential Fallback Scenarios: 9 dedicated tests passing (Primary HTTP 429, timeout, null/malformed output, Baidu ERNIE fallback, OpenRouter dynamic fallback, deterministic fallback, and ungrounded ward rejection)
* Duration: ~8.0 seconds

### Integration Tests (Database and PostGIS)
Integration tests run against a live PostgreSQL database with PostGIS:
```powershell
npm run test:int
```
Result on 2026-11-19:
* Test Files: 3 passed (3)
* Tests: 6 passed (6)
* Duration: 7.72 seconds

### Early Warning Backtest
Runs Monte Carlo simulation evaluating R2 anomaly detection across seeds 1 to 5:
```powershell
npm run backtest
```
Result on 2026-11-19:
* Seeds evaluated: 1, 2, 3, 4, 5 (5,000 trials per cell)
* Outcome: Confirms MIN_HIGH=13 satisfies the 5.00% false alarm rate limit on the worst seed across all baselines.

## 12. Known Limitations and What Is Unproven

### Known Limitations
* Synthetic Data Only: Aside from user reports entered during an active session, all data is synthetic.
* Legacy Pre-2022 Boundaries: Uses 290 legacy pre-2022 Delhi MCD ward polygons from DataMeet rather than the official 2022 250-ward delimitation. Boundary overlaps exist in some areas, and the dataset does not represent current 250-ward administrative divisions.
* Approximate Fixed-Grid Clustering: Client map clustering uses fixed-interval grid coordinate rounding (~1.8km) rather than distance-based or zoom-aware clustering algorithms. Points near cell borders can fall into separate clusters.
* Small Baseline Moving Window: Four 7-day buckets provide insufficient depth to capture seasonal shifts, holidays, or weather cycles.
* Linear Trend Extrapolation: Next-week projections represent simple linear regressions over four numbers and are not trained forecasting models.
* Statistical Scores: Anomaly scores are standardized z-scores against short-term baseline variation, not event probabilities.
* Rate Limiting Fails Open: Database rate limit errors fail open to keep intake available. Per-IP tracking does not prevent distributed abuse.
* Unpinned Free Tier Models: Free tier models on OpenRouter can vary in availability, formatting reliability, and response latency.
* Avoided Cost Assumptions: Dollar and rupee values are placeholder assumptions, not measured municipal financial savings.

### What Is Unproven
* Real-World Citizen Reporting Behavior: The system has not been tested with live municipal call volumes, batch reporting, or citizen reporting bursts.
* Noisy Audio Robustness: Speech-to-text accuracy has not been validated against noisy field audio from heavy traffic or diverse dialects.
* Production Scalability Beyond 10,000 Rows: Spatial queries scan the report table sequentially; indexing or partitioning for hundred-thousand-row tables has not been tested in production.

## 13. Screenshots

The following verified screenshots reflect the active municipal operations dashboard:

### Live Incident Map
![Live Incident Map](docs/screenshots/live-map.png)
*Visualizes CartoDB dark tile layer, clustered incident density bubbles, frosted map controls (clustering toggle, ward polygons), live incident feed, operational metric tiles, and the bottom synthetic data disclaimer.*

### Early Warning and Hotspot Intelligence
![Early Warning and Hotspot Intelligence](docs/screenshots/early-warning.png)
*Displays analytical KPI cards (Wards on Watch, Next-Week Trend Estimate, Highest Risk Ward, Anomaly Baseline Rules), current-week category breakdown bars, risk tier distribution, and ranked hotspot cards with 4-week trajectory sparklines.*

### 7-Day Municipal Mitigation Strategy
![7-Day Municipal Mitigation Strategy](docs/screenshots/mitigation.png)
*Renders the Executive Operational Directive banner, Department Allocation Overview, and targeted priority intervention cards partitioned into Quantitative Evidence, Diagnostic Hypotheses, and Prescribed Operational Actions.*

### Mobile Responsive View (390px)
![Mobile Responsive View](docs/screenshots/mobile.png)
*Demonstrates single-column mobile collapse with stacked KPI metrics, collapsible voice and text dispatch drawer, and bottom disclaimer positioning.*
