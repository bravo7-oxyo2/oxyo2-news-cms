---
name: thepaperleaf-gsc-optimizer
description: Analyze ThePaperLeaf Google Search Console exports against its CMS code and published site, recommend evidence-backed SEO improvements, and—only when explicitly requested—apply safe compatible fixes and open a draft PR. Use for ThePaperLeaf GSC Performance, URL Inspection, Sitemap, Page Indexing, Core Web Vitals, or Links analysis; do not use for unrelated sites or generic SEO advice without GSC evidence.
---

# ThePaperLeaf GSC Optimizer

Correlate private GSC evidence with reproducible code and public-site evidence. Treat analytics as signals, not proof that a code change is correct.

## Select the mode

- **Analysis mode is the default.** Validate inputs, inspect the repository and public site, and return prioritized recommendations. Do not edit, branch, commit, push, or open a PR.
- **Full remediation mode** requires an explicit request to apply/fix changes and open a PR. That request authorizes the bounded Git/GitHub operations in this skill, not broader content, database, deployment, or production changes.

If the user's wording is ambiguous, remain in analysis mode.

## Inputs

Require one CMS Search Insights JSON export with `schemaVersion: "1.0"`. Accept either that file or a directory containing exactly one canonical export plus optional `.csv`/`.json` GSC supplements.

For an unattended Codex Cloud run with no supplied input, require both `PAPERLEAF_GSC_EXPORT_URL` and `PAPERLEAF_GSC_EXPORT_TOKEN`, then run:

```bash
bash scripts/fetch_gsc_export.sh REPOSITORY
```

Configure the token as a network secret scoped to the export URL's HTTPS host. The helper sends it only in the bearer header, validates the canonical response, removes the raw export before exiting, and writes the redacted analysis to a private temporary directory outside the repository. Read the analysis path from its final output line. Never copy that file into the checkout. If retrieval, validation, or analysis fails, stop and report the status without requesting or printing the credential.

For the unattended daily workflow, read [references/scheduled-cloud.md](references/scheduled-cloud.md) before starting. At every terminal outcome, make exactly one delivery attempt with `scripts/notify_telegram.py` after cleanup. The production API owns the Telegram bot token and chat ID; never request or configure either credential in Codex Cloud.

For a user-supplied export, run:

```bash
python3 scripts/gsc_optimizer.py analyze INPUT --repo REPOSITORY --output OUTPUT.json
```

Add `--offline` only when the user disallows live access or the site cannot be reached. The script reads published data through the public site/API only and never connects to PostgreSQL or admin APIs. Read [references/input-contract.md](references/input-contract.md) when an input fails validation or supplemental report recognition is important.

Never expose or commit the input bundle, normalized query rows, credentials, tokens, `.env` values, or generated private analysis JSON. Detailed GSC query text may inform the private response, but it must not enter a branch, commit, log excerpt, or PR body.

## Correlate evidence

Read [references/analysis-and-remediation.md](references/analysis-and-remediation.md) before deciding that any change is safe to implement.

1. Establish the repository baseline with `git status --short`, relevant route/model inspection, `pnpm typecheck`, `pnpm test`, and `pnpm build`.
2. Inspect implementations for SSR, canonical and hreflang output, robots directives, sitemap and News sitemap generation, structured data, internal links, image geometry, caching, and public response behavior. Use `rg` first.
3. Compare analytics findings with the code and the public snapshot from the helper. A GSC symptom without a reproducible defect remains advisory.
4. Return findings in priority order. Each finding must name severity, confidence, GSC evidence, code/site evidence, expected impact, recommendation, and disposition (`auto-fix` or `advisory-only`). Mention partial or stale inputs prominently.

Do not claim causation from correlation. Do not promise rankings, traffic, crawl timing, or indexing.

## Apply safe changes

In full remediation mode, apply only high-confidence changes that satisfy every auto-fix gate in the remediation reference. Preserve existing routes, API shapes, visible article content, CMS workflow, stored data, and media behavior.

Database/schema migrations, content edits, publishing changes, URL restructuring, redirects, dependency upgrades, authentication, credentials, generated analytics artifacts, and speculative title/description rewrites are advisory-only.

Use `apply_patch` for edits. Add targeted regression coverage for every changed behavior. Do not modify unrelated or pre-existing user changes.

## Validate and open the draft PR

Read [references/pr-workflow.md](references/pr-workflow.md) before any Git mutation.

The worktree must be clean before starting remediation. Run the PR guard's read-only preflight first:

```bash
python3 scripts/pr_guard.py preflight --repo REPOSITORY
```

Create the `codex/gsc-optimizer-<date>-<topic>` branch only after preflight and the pre-change baseline pass. After editing, run targeted tests plus:

```bash
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Compare affected public status codes, canonical/robots metadata, sitemap output, JSON-LD, and API response shapes before and after when the environment permits. If a baseline or validation command fails, do not push or create a PR.

Stage only explicitly reviewed paths. Use the guard to validate the publish state, then use authenticated `gh` commands described in the PR reference to push and create a draft PR. The PR body may contain aggregate evidence and public URLs, never raw queries or the input/export.

If no safe diff remains, create no branch, commit, or PR and return recommendations only.
