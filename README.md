# SafaiKavach

Voice-first municipal hazard intake, PostGIS ward dispatch, and grounded weekly mitigation planning for Delhi sanitation fleets.

SafaiKavach gives municipal staff and citizens a way to report road hazards (biomedical waste, loose electrical wiring, chemical leaks, demolition debris, and open garbage heaps) by voice or text. Reports are validated on the server, tagged to Delhi municipal wards through spatial PostGIS queries, routed to field teams using deterministic rules, and aggregated weekly into structured mitigation plans grounded against verified SQL totals.

## Architecture

### Data Flow

```mermaid
flowchart TD
    A["Citizen or Driver Input: Voice Audio or Text"] --> B{"Submission Path"}
    B -->|"Audio Multipart"| C["/api/report Endpoint"]
    B -->|"Text and Geolocation"| D["Server Action: submitReport"]
    C --> E["Gnani Speech-to-Text"]
    E --> F["LLM or Mock Hazard Extraction"]
    D --> F
    F --> G["Zod Server Schema Validation"]
    G --> H["Spatial Landmark Gazetteer"]
    H --> I["PostGIS tagWardDb: ST_Covers over 290 Wards"]
    I --> J["Deterministic Rule Dispatch: getActionRequired"]
    J --> K[("Neon Postgres: Report and Ward Tables")]
    K --> L["Dashboard: React 19 UI and Live Leaflet Map"]
    K --> M["Weekly Aggregates Query: SQL GROUP BY"]
    M --> N["LangChain ChatOpenAI: Structured Output"]
    N --> O["groundPlan: Anti-Hallucination Enrichment"]
    O --> P[("MitigationPlan Table: Cached Strategy")]
```

1. Report Intake: Spoken audio is transcribed via Gnani STT (or mock fallback). Audio goes through `/api/report`. Text reports submit through the `submitReport` Server Action.
2. Server Extraction: The server parses the transcript or text using an LLM or keyword fallback into a hazard category, severity score (1 to 10), and location text.
3. Coordinates and Spatial Tagging: Coordinates are resolved from browser GPS or Delhi landmark gazetteer matching. The server then executes a PostGIS `ST_Covers` query over 290 MultiPolygon ward boundaries indexed with GiST in Neon Postgres.
4. Deterministic Dispatch: Hazard category and severity determine the action required (`dispatch_hazmat_bypass_standard`, `bypass_standard`, or `routine_collection`). The client cannot choose or override this value.
5. Storage and Broadcast: Reports are stored in the `Report` table in Postgres using Prisma. The client updates local view state without page reloads.
6. Mitigation Planning: `/api/mitigation-plan` runs a parameterized SQL query grouping the last 7 days of incidents by ward and hazard category. LangChain feeds these aggregates into an LLM with structured output. The server verifies every recommended ward and category against the SQL results via `groundPlan`, enriches items with exact database numbers, and caches the record in the `MitigationPlan` table.

## Key Design Decisions

* Counting stays in SQL: The LLM never calculates counts, sums, or percentage changes. Postgres performs all grouping, counting, and severity averages. The LLM only generates qualitative hypotheses, urgency ratings, and operational tasks.
* Anti-hallucination grounding: The `groundPlan` function checks every priority returned by the LLM against the actual weekly SQL aggregates. If the model references an unknown wardKey or hazard category, or provides duplicate priorities, the plan is rejected with a `GroundingError`.
* Zero raw text sent to mitigation LLM: Citizen voice transcripts, raw location notes, and PII are never passed to the mitigation model. The prompt receives only structured ward keys, ward names, categories, counts, and severity statistics.
* Server-controlled dispatch rules: The browser client never supplies `hazard_category`, `severity_level`, or `action_required`. All categorization, severity scoring, and routing rules execute strictly on the server.
* Stable ward externalId slug: The GeoJSON source file contains collisions where index 82 (GREATER KAILASH-I) and index 192 (Ward 192) share the same ward ID 192. Wards are uniquely identified by a composite slug format (`${ward_id}-${slug(name)}`) to prevent silent row overwrites during import.

## Tech Stack

* Framework: Next.js 16.4 (App Router, Turbopack, Cache Components, Partial Prerendering)
* Language: TypeScript (strict mode, no any)
* Database: Neon PostgreSQL with PostGIS extension (290 Delhi MCD MultiPolygon wards, GiST spatial index)
* ORM: Prisma 6.19
* AI and LLM: LangChain (`@langchain/core`, `@langchain/openai`) via OpenRouter, with built-in mock fallback
* Speech-to-Text: Gnani Vachana STT API (`hi-IN`) with mock fallback
* Maps: Leaflet, React-Leaflet, with fallback Turf.js spatial helpers
* Testing: Vitest (unit tests mock-isolated; separate integration suite for database)
* Container: Docker multi-stage build on Debian `node:22-slim`

## Getting Started

### Prerequisites

* Node.js 22 LTS
* PostgreSQL instance with PostGIS extension enabled (such as Neon Postgres)

### Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/kaizen105/Garbage_unstop_project.git
cd Garbage_unstop_project
npm install
```

### Environment Configuration

Copy `.env.example` to `.env` and fill in the required variables:

```bash
cp .env.example .env
```

Environment variables configured in `.env.example`:

* `DATABASE_URL`: Pooled connection string for Neon PostgreSQL.
* `DIRECT_URL`: Direct connection string for PostgreSQL schema migrations and pushes.
* `LLM_PROVIDER`: Provider mode (`mock`, `openrouter`, or `evon`). Defaults to `mock`.
* `LLM_BASE_URL`: Base URL for OpenRouter or custom endpoint (defaults to `https://openrouter.ai/api/v1`).
* `LLM_API_KEY`: API key for the LLM provider. The code also accepts `OPENROUTER_API_KEY` as an alias.
* `LLM_MODEL_EXTRACT`: Model slug for hazard extraction (defaults to `openrouter/free`).
* `LLM_MODEL_AUDIT`: Model slug for audit and mitigation planning (defaults to `openrouter/free`).
* `GNANI_API_KEY`: API key for Gnani speech transcription service. Optional; falls back to mock if empty.
* `GNANI_STT_URL`: URL for Gnani speech-to-text service.
* `NEXT_PUBLIC_MAP_PROVIDER`: Map tile provider (`leaflet` or `mapbox`, defaults to `leaflet`).

Note on LLM providers: `LLM_PROVIDER=mock` is the default fallback. Mock mode produces deterministic template output without network or LLM calls. Real LLM execution was verified with `openrouter/free`. Because `openrouter/free` is a router that dynamically selects available free models, pinning a specific tool-calling model slug in `LLM_MODEL_AUDIT` is recommended for production.

### Database Setup and Seeding

Run database schema setup and ward polygon imports in this exact order:

```bash
# Push Prisma schema to Postgres
npm run db:push

# Import Delhi ward boundaries into PostGIS (requires data/delhi_wards.json)
npm run db:import-wards

# Seed database with initial synthetic reports and tag them against PostGIS
npm run db:seed
```

### Start Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Testing

The project maintains two distinct test setups:

```bash
# Run unit tests (50 tests across 13 suites, completely offline, no DB or network access)
npm test

# Run integration tests (validates PostGIS ST_Covers queries and SQL aggregation against live Postgres)
npm run test:int
```

Continuous integration in GitHub Actions (`.github/workflows/test.yml`) runs unit tests only (`npm test`) alongside type checking and linting. Integration tests are not run in CI because no database service is provisioned during the workflow.

## Docker Deployment

The Dockerfile uses a multi-stage Debian build (`node:22-slim`) with non-root execution (`nextjs:nodejs`), producing a standalone Next.js server image.

### Building the Image

Build the container image locally without database credentials or build secrets:

```bash
docker build -t safaikavach:local .
```

### Running the Container

All credentials must be supplied at runtime only. When using an environment file with the env-file flag, ensure values in `.env` do not contain wrapping quotes, as Docker passes quotes literally into container process environments:

```bash
# Run using an unquoted environment file
docker run -p 3000:3000 --env-file .env safaikavach:local
```

If your .env has quoted values, make an unquoted copy such as .env.docker and pass that instead. Keep it out of git.

```bash
# Or pass runtime variables directly
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:password@host/neondb?sslmode=require" \
  -e DIRECT_URL="postgresql://user:password@host/neondb?sslmode=require" \
  -e LLM_PROVIDER="openrouter" \
  -e LLM_API_KEY="your-key-here" \
  safaikavach:local
```

## Known Limitations

* Synthetic base data: All baseline incident records are synthetic demo data, except for live reports submitted during a session.
* Pre-2022 ward boundaries: Ward polygons originate from DataMeet GeoJSON and predate the 2022 MCD 250-ward delimitation. Certain polygons feature boundary overlaps (for example, KHANPUR and TIGRI).
* Early warning reads client state: The Early Warning tab (`src/lib/early-warning/trends.ts`) groups reports into 4 weekly windows based on `raw_location` matching, computing an anomaly score `(this_week - mean) / std` and a 4-point linear regression slope. It operates over reports loaded into client state rather than running direct Postgres aggregation queries.
* Seed report dates: The synthetic seed reports use fixed relative date offsets computed at module import time (`src/data/seed_reports.ts`). The database seed or demo reset button must be run periodically to re-anchor incident dates to the current calendar week.
* Unauthenticated write actions: The `submitReport` server action and `/api/report` endpoint currently lack authentication and per-IP rate limiting. The Zod schema enforces length boundaries (1 to 2000 characters) on submitted text, but validation against empty or oversized text has not been verified in tests.
* LLM causes are hypotheses: Root causes and likely factors generated by the mitigation plan are model-generated qualitative hypotheses and require field inspection before municipal action.
* Degraded mode unverified: The fallback path in the mitigation service for handling upstream LLM failure has not been covered by integration tests.
* Docker image size: The standalone Docker image is approximately 710 MB due to broad file tracing includes covering local GeoJSON datasets and Prisma client binaries.
* Turf usage: Turf.js remains in the codebase as a verification oracle for unit tests, landmark bounding checks, and client-side map rendering.

## Project Structure

```
src/
├── app/
│   ├── actions/          # Server Actions (submitReport)
│   ├── api/              # API routes (report, audit, mitigation-plan, wards)
│   ├── layout.tsx        # Root HTML layout and font loading
│   └── page.tsx          # Cache-component page with dynamic data suspense
├── components/
│   ├── dashboard/        # DashboardClient, EarlyWarningPanel, MitigationPlanPanel
│   ├── map/              # Leaflet HazardMap and ward boundary rendering
│   └── voice/            # VoiceReporter audio intake component
├── data/
│   └── seed_reports.ts   # Synthetic seed report definitions
├── lib/
│   ├── audit/            # Anomaly clustering and cluster math
│   ├── db/               # Prisma singleton client (server-only)
│   ├── early-warning/    # Hotspot ranking, linear projection, and anomaly scores
│   ├── env.ts            # Zod environment variable validation
│   ├── finance/          # Cost prevention formulas
│   ├── gnani/            # Gnani Vachana STT client with retry logic
│   ├── llm/              # Extraction prompts, parser, and provider interfaces
│   ├── mitigation/       # Weekly aggregation SQL, LangChain chain, schema, grounding
│   ├── reports/          # Report service, DTO mapper, and database operations
│   ├── routing/          # OSRM bypass calculation and distance math
│   ├── spatial/          # PostGIS tagWardDb query, landmark gazetteer, Turf fallback
│   ├── store/            # Reports React context and view state
│   └── utils/            # Category formatting helpers
```
