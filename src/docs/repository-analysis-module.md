# Repository Analysis Module

This module performs a first-stage, evidence-driven review of a GitLab repository without executing project code.

## Capabilities

- Register public or private GitLab repositories.
- Resolve a branch, tag, or commit to an exact SHA.
- Read repository structure and selected source files through GitLab API.
- Detect languages, packages, frameworks, modules, and likely architecture.
- Accept a project-expectations document or supplementary text for each analysis run.
- Capture quantitative workload targets such as concurrent users, requests per second, latency, availability, data volume, and growth horizon.
- Compare repository evidence with expectations and return a readiness verdict.
- Assess scalability risks and propose an architecture/remediation plan.
- Produce observer-style code review findings with evidence paths.
- Return all explanatory reports in Persian while preserving technical identifiers.

## Expectations input

The expectations snapshot belongs to an analysis run, not the repository connection. This preserves the exact requirements used for each historical report.

Supported file formats:

- TXT
- Markdown
- JSON
- YAML
- CSV
- XML
- HTML
- LOG

Files are kept in memory during the request and the normalized text is stored privately on the analysis-run document. The raw content is excluded from normal API responses.

PDF and DOCX are intentionally not parsed in this version. Convert them to UTF-8 text/Markdown or paste the relevant content into `expectationsText`.

## Environment variables

```env
REPOSITORY_ANALYSIS_ENABLED=true
GITLAB_BASE_URL=https://gitlab.zaris-dev.ir
GITLAB_ACCESS_TOKEN=
REPOSITORY_ANALYSIS_ALLOWED_GITLAB_HOSTS=gitlab.zaris-dev.ir
REPOSITORY_ANALYSIS_ALLOW_INSECURE_HTTP=false

REPOSITORY_ANALYSIS_MAX_FILES=10000
REPOSITORY_ANALYSIS_MAX_SELECTED_FILES=80
REPOSITORY_ANALYSIS_MAX_FILE_BYTES=200000
REPOSITORY_ANALYSIS_MAX_PROMPT_BYTES=500000
REPOSITORY_ANALYSIS_MAX_EXPECTATIONS_BYTES=524288
REPOSITORY_ANALYSIS_GITLAB_TIMEOUT_MS=30000
REPOSITORY_ANALYSIS_STALE_AFTER_MS=1800000

OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_REPOSITORY_ANALYSIS_MODEL=gpt-4.1-mini
OPENAI_REPOSITORY_ANALYSIS_TIMEOUT_MS=120000
```

## Start analysis

The endpoint accepts `multipart/form-data`. JSON requests without an expectations file remain backward compatible.

```http
POST /api/v1/repository-analysis/repositories/:repositoryId/analyze
Authorization: Bearer <access-token>
Content-Type: multipart/form-data
```

Fields:

- `ref`: optional branch, tag, or commit.
- `useAi`: boolean.
- `expectationsFile`: optional supported text file.
- `expectationsText`: optional supplementary requirements.
- `concurrentUsers`: optional positive integer.
- `requestsPerSecond`: optional positive number.
- `targetLatencyMs`: optional positive integer.
- `availabilityPercent`: optional number from 0 to 100.
- `dataVolume`: optional free-text data target.
- `growthHorizonMonths`: optional positive integer.

## Analysis outputs

In addition to packages, frameworks, inventory, and architecture, each run can contain:

- `expectations`
- `readinessAssessment`
- `scalabilityAssessment`
- `codeReviewAssessment`
- `executiveReport`
- `technicalReport`

### Readiness

The readiness assessment includes the overall verdict, score, confidence, expectation-by-expectation status, blockers, gaps, and ordered recommendations.

### Scalability

The scalability result is a risk assessment, not a benchmark. It includes workload assumptions, visible strengths, bottlenecks, capacity risks, recommended architecture, and a load-test validation plan.

### Code review

The observer report scores maintainability, reliability, security, and performance. AI findings must cite real repository paths, and the frontend labels them as findings requiring engineering verification.

## Important limitation

The project is not installed, built, executed, load-tested, penetration-tested, or deployed. No exact user or throughput capacity can be guaranteed from static analysis. Numerical capacity must be confirmed with production-like load tests and telemetry.

The first version still dispatches analysis in the API process. Before high concurrency, scheduled scans, builds, or dynamic testing, move execution to a durable queue and separate worker.
