# Analysis and remediation policy

## Evidence model

Use three evidence layers:

1. **GSC evidence:** measurable symptom, affected period, magnitude, and report completeness.
2. **Public-site/data evidence:** reproducible response, metadata, sitemap, URL, or published-content observation.
3. **Code evidence:** exact implementation that explains the public observation.

A recommendation may rely on one or two layers. An `auto-fix` requires all three, high confidence, and a targeted regression test.

## Priority guidance

- **Critical:** widespread crawl/index blocking, invalid canonicalization, production 5xx, or sitemap behavior excluding intended published URLs.
- **High:** repeated canonical/indexing failures, material sitemap errors, broken SSR metadata, or a strong high-impression opportunity tied to a reproducible technical defect.
- **Medium:** isolated metadata, internal-link, image-geometry, structured-data, or performance defects with measurable exposure.
- **Low:** experiments, editorial opportunities, weak correlations, or incomplete evidence.

Useful opportunity groups include high-impression/low-CTR rows, positions 4–20, declining periods, zero-click impressions, device/country divergence, sitemap warnings/errors, canonical mismatch, robots/fetch failures, and weak submitted-versus-indexed ratios. Thresholds are signals and must be reported with their assumptions.

## Auto-fix gate

An automatic change must:

- Correct a reproducible defect rather than optimize toward a speculative ranking theory.
- Preserve visible content, routes, URL meaning, API contracts, CMS behavior, stored data, and media handling.
- Avoid migrations, database writes, production mutations, credentials, authentication, deployments, and external messages other than the explicitly authorized draft PR.
- Avoid editorial rewrites, publishing/unpublishing, author changes, category changes, bulk content updates, new redirects, URL restructuring, or dependency upgrades.
- Be narrow enough to test directly and revert independently.
- Pass the complete repository validation gate without introducing new warnings or failures.

When any condition is uncertain, mark the finding `advisory-only`.

## Published-data review

The helper may inspect only public sitemaps, robots/llms files, category data, and individual published post/page endpoints. Prioritize GSC page URLs by impressions, then sitemap URLs, and cap inspection at 200 URLs with at most four concurrent requests.

Treat missing SEO descriptions, duplicate metadata, generic authors, absent sources, low word counts, incomplete translations, and missing image dimensions as observations. They are not automatic proof of low quality and never authorize content edits.

## Response format

Lead with the outcome and data-quality caveats. For each finding include:

- Severity and confidence
- GSC evidence, including range and magnitude
- Public/code evidence with paths or URLs
- Likely impact stated without guarantees
- Recommended action
- `auto-fix` or `advisory-only`

Finish with validation status and either the draft PR link or an explicit statement that no safe code change qualified.
