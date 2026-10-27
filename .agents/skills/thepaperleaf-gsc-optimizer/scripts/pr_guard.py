#!/usr/bin/env python3
"""Guarded Git/GitHub workflow for ThePaperLeaf GSC remediation.

`preflight` is read-only. `start` and `publish` require --authorized and are
intended only after an explicit user request for full remediation and a PR.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Sequence

BRANCH_PREFIX = "codex/gsc-optimizer-"
VALIDATION = (("pnpm", "typecheck"), ("pnpm", "test"), ("pnpm", "build"))
SECRET_TEXT = re.compile(r"(?:refresh_token|client_secret|GSC_TOKEN_ENCRYPTION_KEY\s*=|authorization:\s*bearer)", re.I)


class GuardError(RuntimeError):
    pass


@dataclass(frozen=True)
class Result:
    stdout: str = ""
    stderr: str = ""
    returncode: int = 0


class Runner:
    def run(self, command: Sequence[str], cwd: Path, check: bool = True) -> Result:
        completed = subprocess.run(command, cwd=cwd, text=True, capture_output=True)
        result = Result(completed.stdout, completed.stderr, completed.returncode)
        if check and result.returncode:
            detail = (result.stderr or result.stdout).strip()[-1000:]
            raise GuardError(f"Command failed ({' '.join(command)}): {detail}")
        return result


def _root(repo: Path, runner: Runner) -> Path:
    repo = repo.expanduser().resolve()
    if not repo.is_dir():
        raise GuardError(f"Repository directory does not exist: {repo}")
    root = Path(runner.run(("git", "rev-parse", "--show-toplevel"), repo).stdout.strip()).resolve()
    if root != repo:
        raise GuardError(f"Use the Git repository root: {root}")
    return root


def _gh_metadata(repo: Path, runner: Runner) -> dict[str, str]:
    if shutil.which("gh") is None:
        raise GuardError("GitHub CLI is not installed. Install it with `brew install gh`.")
    runner.run(("gh", "auth", "status"), repo)
    raw = runner.run(("gh", "repo", "view", "--json", "defaultBranchRef,nameWithOwner"), repo).stdout
    try:
        value = json.loads(raw)
        base = value["defaultBranchRef"]["name"]
        name = value["nameWithOwner"]
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise GuardError("Could not resolve the GitHub repository and default branch") from exc
    if not base or not name:
        raise GuardError("GitHub returned incomplete repository metadata")
    return {"defaultBranch": str(base), "repository": str(name)}


def preflight(repo: Path, runner: Runner | None = None) -> dict[str, str | bool]:
    runner = runner or Runner()
    root = _root(repo, runner)
    if runner.run(("git", "status", "--porcelain=v1", "--untracked-files=all"), root).stdout.strip():
        raise GuardError("The worktree is not clean. Commit or otherwise handle existing work; do not stash/reset it automatically.")
    origin = runner.run(("git", "remote", "get-url", "origin"), root).stdout.strip()
    if not origin:
        raise GuardError("The repository has no origin remote")
    metadata = _gh_metadata(root, runner)
    return {"ready": True, "root": str(root), "origin": origin, **metadata}


def _topic(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:32]
    if not slug:
        raise GuardError("Topic must contain letters or numbers")
    return slug


def start(repo: Path, topic: str, authorized: bool, runner: Runner | None = None) -> dict[str, str]:
    if not authorized:
        raise GuardError("Starting remediation requires explicit authorization")
    runner = runner or Runner()
    ready = preflight(repo, runner)
    root = Path(str(ready["root"]))
    for command in VALIDATION:
        runner.run(command, root)
    base = str(ready["defaultBranch"])
    branch = f"{BRANCH_PREFIX}{datetime.now().strftime('%Y%m%d')}-{_topic(topic)}"
    if runner.run(("git", "show-ref", "--verify", "--quiet", f"refs/heads/{branch}"), root, check=False).returncode == 0:
        raise GuardError(f"Local branch already exists: {branch}")
    runner.run(("git", "fetch", "origin", base), root)
    runner.run(("git", "switch", "-c", branch, f"origin/{base}"), root)
    return {"branch": branch, "base": base, "repository": str(ready["repository"])}


def _changed_paths(repo: Path, runner: Runner) -> set[str]:
    unstaged = runner.run(("git", "diff", "--name-only"), repo).stdout.splitlines()
    staged = runner.run(("git", "diff", "--cached", "--name-only"), repo).stdout.splitlines()
    if staged:
        raise GuardError("Files are already staged. Unstage them and let the guard stage only reviewed paths.")
    untracked = runner.run(("git", "ls-files", "--others", "--exclude-standard"), repo).stdout.splitlines()
    return {path.strip() for path in [*unstaged, *untracked] if path.strip()}


def _review_paths(repo: Path, declared: list[str], changed: set[str]) -> list[str]:
    if not changed:
        raise GuardError("No code changes remain; do not create a PR")
    reviewed: list[str] = []
    for raw in declared:
        path = Path(raw)
        if path.is_absolute() or ".." in path.parts:
            raise GuardError(f"Changed paths must be repository-relative: {raw}")
        normalized = path.as_posix().lstrip("./")
        target = (repo / normalized).resolve()
        try:
            target.relative_to(repo)
        except ValueError as exc:
            raise GuardError(f"Path escapes the repository: {raw}") from exc
        if target.name == ".env" or target.name.startswith(".env."):
            raise GuardError(f"Environment files cannot be published by this skill: {normalized}")
        if target.suffix.lower() == ".csv":
            raise GuardError(f"CSV analytics files cannot be published: {normalized}")
        if target.exists() and target.is_file():
            if target.stat().st_size > 5 * 1024 * 1024:
                raise GuardError(f"Unexpected large changed file: {normalized}")
            text = target.read_text(encoding="utf-8", errors="ignore")
            if SECRET_TEXT.search(text):
                raise GuardError(f"Potential secret found in changed file: {normalized}")
            if '"schemaVersion"' in text and '"queries"' in text and '"inspections"' in text:
                raise GuardError(f"Potential Search Insights export cannot be published: {normalized}")
        reviewed.append(normalized)
    if set(reviewed) != changed:
        missing = sorted(changed - set(reviewed))
        extra = sorted(set(reviewed) - changed)
        raise GuardError(f"Declared paths do not exactly match the diff (unreviewed={missing}, unchanged={extra})")
    return sorted(reviewed)


def publish(
    repo: Path, files: list[str], title: str, body_file: Path, commit_message: str,
    authorized: bool, runner: Runner | None = None,
) -> dict[str, str]:
    if not authorized:
        raise GuardError("Publishing remediation requires explicit authorization")
    runner = runner or Runner()
    root = _root(repo, runner)
    branch = runner.run(("git", "branch", "--show-current"), root).stdout.strip()
    if not branch.startswith(BRANCH_PREFIX):
        raise GuardError(f"Current branch must start with {BRANCH_PREFIX}")
    runner.run(("git", "remote", "get-url", "origin"), root)
    metadata = _gh_metadata(root, runner)
    body = body_file.expanduser().resolve()
    if not body.is_file() or root == body or root in body.parents:
        raise GuardError("The PR body must be a regular temporary file outside the repository")
    if body.stat().st_size > 1024 * 1024:
        raise GuardError("The PR body is unexpectedly large")
    body_text = body.read_text(encoding="utf-8", errors="strict")
    if SECRET_TEXT.search(body_text) or ('"queries"' in body_text and '"inspections"' in body_text):
        raise GuardError("The PR body appears to contain secrets or raw Search Insights data")
    changed = _changed_paths(root, runner)
    reviewed = _review_paths(root, files, changed)
    runner.run(("git", "diff", "--check"), root)
    for command in VALIDATION:
        runner.run(command, root)
    runner.run(("git", "add", "--", *reviewed), root)
    runner.run(("git", "diff", "--cached", "--check"), root)
    runner.run(("git", "commit", "-m", commit_message), root)
    runner.run(("git", "push", "-u", "origin", branch), root)
    url = runner.run((
        "gh", "pr", "create", "--draft", "--base", str(metadata["defaultBranch"]),
        "--head", branch, "--title", title, "--body-file", str(body),
    ), root).stdout.strip()
    return {"branch": branch, "base": str(metadata["defaultBranch"]), "pullRequest": url}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    check = commands.add_parser("preflight", help="Read-only Git and GitHub readiness check")
    check.add_argument("--repo", required=True, type=Path)
    begin = commands.add_parser("start", help="Validate baseline and create a remediation branch")
    begin.add_argument("--repo", required=True, type=Path)
    begin.add_argument("--topic", required=True)
    begin.add_argument("--authorized", action="store_true")
    finish = commands.add_parser("publish", help="Validate, commit, push, and open a draft PR")
    finish.add_argument("--repo", required=True, type=Path)
    finish.add_argument("--file", action="append", required=True, dest="files")
    finish.add_argument("--title", required=True)
    finish.add_argument("--body-file", required=True, type=Path)
    finish.add_argument("--commit-message", required=True)
    finish.add_argument("--authorized", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.command == "preflight":
            result = preflight(args.repo)
        elif args.command == "start":
            result = start(args.repo, args.topic, args.authorized)
        else:
            result = publish(args.repo, args.files, args.title, args.body_file, args.commit_message, args.authorized)
        print(json.dumps(result, indent=2))
        return 0
    except GuardError as exc:
        print(json.dumps({"ready": False, "error": str(exc)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
