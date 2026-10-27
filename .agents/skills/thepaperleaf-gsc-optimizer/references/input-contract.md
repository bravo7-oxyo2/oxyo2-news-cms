# Input contract

## Canonical export

The required JSON is the CMS `/api/admin/search-console/export` response, not the surrounding `{ data: ... }` report endpoint envelope. It must contain:

- `schemaVersion: "1.0"`
- `generatedAt`, `property`, and `range.startDate` / `range.endDate`
- `rowLimits.queries` and `rowLimits.pages`
- `summary`, `previousSummary`, `daily`, `queries`, `pages`, `countries`, `devices`, and `searchAppearances`
- `sitemaps`, `inspections`, and `notices`

Metric objects use finite, non-negative `clicks`, `impressions`, `ctr`, and `position`. Metric rows add a string `keys` array. A partial export is valid only when the required arrays exist; its `notices` lower confidence for affected sections.

## Bundle form

An input directory must contain exactly one JSON file matching the canonical contract. Other `.json` and `.csv` files are treated as supplemental exports. Symlinks, nested directories, files over 50 MiB, archives, executable files, and unsupported extensions are rejected.

Supplement recognition is header/content based rather than filename based. Supported families are:

- Page Indexing / coverage
- Core Web Vitals
- Links
- Search Performance
- URL Inspection
- Sitemaps

Unknown supplemental files generate a notice and do not block canonical analysis. Supplemental files that clearly identify another property make the whole bundle invalid. Differing or missing supplemental date ranges generate a notice rather than silently combining periods.

## Privacy

The helper emits aggregate opportunity counts and public page URLs, not raw search-query rows. It records a SHA-256 fingerprint of the canonical input for traceability without copying its contents.

Keep the source bundle and generated analysis outside the repository. Never paste raw exports into a PR description or commit them as fixtures. Tests must use synthetic data only.
