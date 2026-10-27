# Draft PR workflow

## One-time dependency

Use GitHub CLI. If `gh` is absent, stop and ask the user to install it (Homebrew: `brew install gh`). If `gh auth status` fails, stop and ask the user to complete `gh auth login`. Never collect or store a GitHub token in the skill.

## Preflight

Run `python3 scripts/pr_guard.py preflight --repo REPOSITORY`. It must confirm:

- The path is a Git repository with an `origin` remote.
- The worktree has no tracked, staged, or untracked changes.
- `gh` exists, is authenticated, and can read the repository.
- The GitHub default branch can be resolved.

Do not stash, reset, clean, delete, or absorb unrelated work to satisfy preflight. A dirty worktree blocks remediation but not read-only analysis.

## Latest-main branch lifecycle

For every remediation PR, create a new isolated worktree and use this sequence:

1. Run preflight in the clean worktree.
2. Fetch `origin`'s resolved default branch and reset the clean worktree's detached `HEAD` to `origin/DEFAULT_BRANCH`.
3. Run the full pre-change baseline at that exact fetched commit. A failing baseline stops the PR workflow: do not create a branch, edit files, commit, push, or open a PR. Report the failing validation and clean up an otherwise untouched worktree.
4. Only after the baseline passes, create a unique `codex/gsc-optimizer-YYYYMMDD-topic` branch from `origin/DEFAULT_BRANCH`, make the bounded fix, and validate it again before publishing.

Fetch `origin` and create the branch with:

```bash
git fetch origin DEFAULT_BRANCH
git switch --detach origin/DEFAULT_BRANCH
git switch -c codex/gsc-optimizer-YYYYMMDD-topic origin/DEFAULT_BRANCH
```

## Publish gate

After all validation succeeds:

1. Review `git status --short` and `git diff --check`.
2. Verify every changed path belongs to the intended fix. Reject `.env` files, GSC exports, generated private reports, credentials, tokens, and unrelated user files.
3. Stage exact paths with `git add -- PATH...`; never use `git add .` or `git add -A`.
4. Inspect the staged diff and commit with a concise SEO-specific message.
5. Push only the current `codex/gsc-optimizer-*` branch with `git push -u origin BRANCH`.
6. Write the PR body to a temporary file outside the repository and run `gh pr create --draft --base DEFAULT_BRANCH --head BRANCH --title TITLE --body-file TEMP_FILE`.

The PR body contains aggregate evidence, public URLs where useful, the exact fix, tests run, compatibility statement, risks, and advisory follow-ups. Do not include raw query rows or attach the GSC bundle.

If validation fails, leave the local diff for user inspection and do not commit, push, or create a PR. If the diff is empty, return recommendations only.
