# DriftWatch

DriftWatch is a privacy-first CSV comparison tool. It processes files entirely in your browser: CSV contents are not uploaded, sent to an API, or persisted to browser storage.

## Run locally

Requirements: Node.js 22.12+ and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. To create and serve a production build:

```bash
npm run build
npm run preview
```

## Use

1. Choose **New comparison** and add a baseline and newer `.csv` file (up to 150 MB each).
2. Review the pre-comparison data quality profile, then select and explicitly confirm a shared primary key. DriftWatch shows per-file uniqueness, missing/duplicate counts, overlap, and positional-key warnings before comparing.
3. If primary IDs can change, select and confirm a complete, unique secondary key or enter explicit old-to-new ID mappings. Linked primary-ID changes are Critical. Ambiguous, duplicate, missing, or conflicting matches stop the comparison rather than being guessed.
4. Optionally mark columns as High or Critical to configure change classification. The rules are explicit and do not infer business impact.
5. Review the overview, schema changes, numeric/categorical movement, and deterministic observations; open **Difference explorer** for per-record details.
6. Export detailed differences CSV, summary CSV, or a standalone HTML report.

The comparison matches exact trimmed primary-key values after explicit user confirmation. A selected key is never silently replaced. Optional reconciliation first respects exact primary-key matches, then applies explicit mappings, then uses a confirmed secondary key for remaining unmatched rows. A primary-key match that contradicts the selected secondary key is rejected. Secondary keys must be present, non-empty, and unique in both files; mappings must reference existing unmatched rows and use each ID at most once. Linked primary-ID edits appear as Critical field changes. Duplicate or missing primary IDs reject comparison; index-like keys and unusually low overlap trigger warnings for review. Field values are compared as strings; empty cells are treated as equivalent, and columns present in only one snapshot are reported as schema changes rather than record edits. Potential column renames are heuristic suggestions based on value overlap, not definitive matches.

Data quality checks are heuristics: email syntax is basic; numeric outliers use a Tukey 1.5× IQR fence (at least four values); date-format findings report multiple recognized formats; category normalization checks case and whitespace variants in low-cardinality text columns. Dataset fingerprints are SHA-256 digests of canonical parsed headers and row values; identical content requires the same column and row order.

File parsing, profiling, fingerprinting, candidate ranking, and comparison run in dedicated browser Web Workers. Workers improve interface responsiveness but structured-clone overhead can make total processing slower. CSV exports prefix spreadsheet formula-like cells; HTML reports escape untrusted values.

## Architecture

- `src/core/csv.ts`: browser CSV parsing, validation, and data-type inference.
- `src/core/compare.ts`: typed record matching/reconciliation, schema analysis, metrics, and deterministic insights.
- `src/core/export.ts`: CSV and self-contained HTML report generation.
- `src/core/profile.ts`: deterministic missingness, duplicate, email, date, outlier, and category profiling.
- `src/core/fingerprint.ts`: canonical content SHA-256 fingerprinting.
- `src/core/data.worker.ts` and `src/core/worker-client.ts`: browser-only background parsing, profiling, fingerprinting, and comparison.
- `src/components/ChangeChart.tsx`: lazily loaded comparison chart.
- `src/App.tsx`: upload flow, overview dashboard, explorer, export controls, and about page.
- `src/styles.css`: responsive dark interface and Tailwind entry point.

Datasets stay in page memory. Starting a new comparison clears the previous result; refreshing the tab also clears uploaded data. No authentication or server is required.

## Tests

```bash
npm test
npm run test:e2e
```

GitHub Actions runs the production build, unit tests, and Chromium end-to-end tests on pushes and pull requests targeting `main`, using Node.js 22 and `npm ci`. The opt-in near-limit upload benchmark is not enabled in CI.

Unit tests cover parsing/validation, detected delimiters and quotes, large cells, data types, exact and reconciled matching, ambiguous/duplicate/missing/conflicting identifiers and mappings, all record change types, schema changes, exports (including formula and HTML injection), profiling, fingerprints, significance and movement analytics, and the 100-versus-1,000 positional-index regression. Playwright covers upload, profile, explicit key confirmation, reconciliation and export, Worker failure cleanup, and synthetic 1k/10k/50k/100k comparison benchmarks; install Chromium once with `npx playwright install chromium` if needed. Run the 120 MB worker parse/profile/fingerprint benchmark separately with `RUN_LIMIT_BENCHMARK=1 npm run test:e2e -- --grep "near-limit CSV"`. It is opt-in because it requires substantial browser memory. Browser `performance.memory` snapshots cover the renderer and do not measure Worker memory; results depend on browser and hardware.

## Current limits

- Primary and secondary matching keys are each single columns; composite keys are not supported. Explicit mappings are manual and do not use fuzzy matching.
- Files are fully read into memory (inside a worker) and transferred as parsed datasets to the UI; fingerprinting and comparison add further allocations. A 120 MB one-column CSV passed the opt-in parse/profile/fingerprint benchmark in the tested Chromium browser, but the full 150 MB limit, two near-limit files, and Worker peak memory were not verified.
- Fingerprints are order-sensitive content hashes; the same records in a different row or header order are intentionally different fingerprints.
- Profiling findings are heuristics, not validation guarantees; ambiguous locale-specific dates and semantic category equivalence require human review.
- If no complete unique secondary key or reliable manual mapping exists, changed primary IDs remain removals/additions; DriftWatch will not infer identity from fuzzy similarity. A wrong but unique user-confirmed key can still associate different real-world records.
- Rename detection is a conservative value-overlap heuristic and must be reviewed by the user.
- Values compare exactly as strings; locale-aware number normalization is not implemented.
