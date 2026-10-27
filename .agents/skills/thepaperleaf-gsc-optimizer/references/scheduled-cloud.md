# Scheduled Codex Cloud workflow

Use this workflow only when the saved scheduled prompt explicitly authorizes the same safe-fix and draft-PR behavior as the established local automation.

## Execution contract

1. Fetch and validate a fresh canonical export with `scripts/fetch_gsc_export.sh`. Never persist the raw export in the repository or include it in task output.
2. Work from the latest remote default branch in an isolated Cloud workspace. Keep source/site analysis separate from any active developer checkout.
3. Rank findings by severity, confidence, aggregate GSC exposure, reproducible public behavior, and exact source evidence. Keep editorial and content changes proposal-only.
4. Apply a narrow technical fix and open a draft PR only when every optimizer auto-fix gate, clean-worktree check, baseline, targeted test, full validation, and PR guard passes. Otherwise create no branch or PR.
5. Clean successful temporary worktrees and raw inputs. Retain a failed worktree only when it is necessary for inspection and the Cloud task can expose it safely.
6. At every terminal outcome—`SUCCESS`, `ADVISORY_ONLY`, `BLOCKED`, or `FAILED`—make exactly one Telegram delivery attempt after cleanup. Do not retry an ambiguous delivery failure because that can create duplicate messages.

## Telegram delivery

Write the report to a private temporary UTF-8 text file, run:

```bash
python3 scripts/notify_telegram.py MESSAGE_FILE
```

The Cloud environment must provide:

- `PAPERLEAF_GSC_NOTIFY_URL` as the production HTTPS notification endpoint.
- `PAPERLEAF_GSC_EXPORT_URL` as the production HTTPS export endpoint on the same host.
- `PAPERLEAF_GSC_EXPORT_TOKEN` as a network secret scoped to that host.

Do not configure `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID` in Codex Cloud. The production API owns those values and performs the Telegram request.

Use exactly this format, retaining each heading and writing `Not run` when applicable:

```text
ThePaperLeaf GSC Optimizer — <UTC timestamp>
Outcome: <SUCCESS | ADVISORY_ONLY | BLOCKED | FAILED>

Context retrieval
• Export: <status>
• Production API access: <direct | unavailable>

Execution
1. Isolated worktree: <status>
2. Source and public-site analysis: <status>
3. Validation: <status>
4. Cleanup: <status>

Findings
• Priority: <severity> — <aggregate evidence-backed finding>
• Additional signals: <aggregate opportunities or none>
• Code proposal: <safe fix, deployment action, or advisory-only recommendation>

Change and PR
• Safe fix: <applied | not warranted | blocked; reason>
• Draft PR: <title and URL | not created>

Next action
• <one concrete next step or No action required>
```

Never include raw GSC rows or queries, credentials, tokens, cookies, stack traces, private analysis paths, or local filesystem paths. If Telegram delivery fails, report the generic failure in the scheduled task without revealing provider responses or credentials.
