#!/usr/bin/env python3
from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import gsc_optimizer
import pr_guard


def metric(clicks=10, impressions=100, ctr=0.1, position=5):
    return {"clicks": clicks, "impressions": impressions, "ctr": ctr, "position": position}


def canonical(property_value="sc-domain:thepaperleaf.com"):
    return {
        "schemaVersion": "1.0",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "property": property_value,
        "range": {"startDate": "2026-07-01", "endDate": "2026-07-31"},
        "rowLimits": {"queries": 5000, "pages": 5000},
        "summary": metric(), "previousSummary": metric(8, 90, 0.08, 6),
        "daily": [{"keys": ["2026-07-01"], **metric()}],
        "queries": [{"keys": ["private query"], **metric(0, 200, 0, 9)}],
        "pages": [{"keys": ["https://www.thepaperleaf.com/article/example"], **metric()}],
        "countries": [{"keys": ["mys"], **metric()}],
        "devices": [{"keys": ["mobile"], **metric()}],
        "searchAppearances": [],
        "sitemaps": [{"path": "https://www.thepaperleaf.com/sitemap.xml", "errors": 0, "warnings": 0, "contents": []}],
        "inspections": [{"url": "https://www.thepaperleaf.com/article/example", "verdict": "PASS", "sitemaps": []}],
        "notices": [],
    }


class BundleTests(unittest.TestCase):
    def write_json(self, directory: Path, name: str, value) -> Path:
        path = directory / name
        path.write_text(json.dumps(value), encoding="utf-8")
        return path

    def test_valid_canonical_file_and_query_redaction(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            source = self.write_json(root, "insights.json", canonical())
            bundle = gsc_optimizer.load_bundle(source)
            analysis = gsc_optimizer.build_analysis(bundle, root, True, 10)
            serialized = json.dumps(analysis)
            self.assertNotIn("private query", serialized)
            self.assertFalse(analysis["privacy"]["safeToCommit"])
            self.assertEqual(analysis["input"]["property"], "sc-domain:thepaperleaf.com")

    def test_partial_export_remains_valid_with_notice(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            value = canonical()
            value["notices"] = [{"section": "inspection", "message": "quota exceeded"}]
            bundle = gsc_optimizer.load_bundle(self.write_json(root, "insights.json", value))
            analysis = gsc_optimizer.build_analysis(bundle, root, True, 10)
            self.assertTrue(analysis["input"]["partial"])
            self.assertIn("inspection: quota exceeded", analysis["notices"])

    def test_malformed_and_secret_exports_fail(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            bad = root / "bad.json"
            bad.write_text("{", encoding="utf-8")
            with self.assertRaises(gsc_optimizer.InputError):
                gsc_optimizer.load_bundle(bad)
            value = canonical()
            value["refreshToken"] = "not-allowed"
            with self.assertRaises(gsc_optimizer.InputError):
                gsc_optimizer.load_bundle(self.write_json(root, "secret.json", value))

    def test_mixed_property_bundle_fails(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            self.write_json(root, "insights.json", canonical())
            (root / "coverage.csv").write_text("property,indexing reason,pages\nhttps://example.com,Excluded,2\n", encoding="utf-8")
            with self.assertRaisesRegex(gsc_optimizer.InputError, "different property"):
                gsc_optimizer.load_bundle(root)

    def test_supplements_are_recognized_and_unknown_is_nonfatal(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            self.write_json(root, "insights.json", canonical())
            (root / "coverage.csv").write_text("indexing reason,validation state,pages\nCrawled,Started,4\n", encoding="utf-8")
            (root / "mystery.csv").write_text("alpha,beta\n1,2\n", encoding="utf-8")
            bundle = gsc_optimizer.load_bundle(root)
            families = {row["family"] for row in bundle.supplements}
            self.assertEqual(families, {"page-indexing", "unknown"})
            self.assertEqual(len(bundle.notices), 1)

    def test_directory_rejects_nested_content(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            self.write_json(root, "insights.json", canonical())
            (root / "nested").mkdir()
            with self.assertRaisesRegex(gsc_optimizer.InputError, "flat"):
                gsc_optimizer.load_bundle(root)

    def test_opportunity_scoring_never_marks_an_automatic_fix(self):
        overview, findings = gsc_optimizer.analyze_metrics(canonical())
        self.assertGreater(overview["opportunities"]["nearPageOneRows"], 0)
        self.assertTrue(findings)
        self.assertTrue(all(row["disposition"] == "needs-code-corroboration" for row in findings))

    def test_origin_prefers_observed_www_property_url(self):
        self.assertEqual(gsc_optimizer.derive_site_origin(canonical()), "https://www.thepaperleaf.com")

    def test_origin_rejects_cross_property_pages(self):
        value = canonical()
        value["pages"][0]["keys"] = ["https://example.com/article/x"]
        value["inspections"] = []
        self.assertEqual(gsc_optimizer.derive_site_origin(value), "https://thepaperleaf.com")


class FakeRunner(pr_guard.Runner):
    def __init__(self, root: Path, *, dirty=False, changed=""):
        self.root = root
        self.dirty = dirty
        self.changed = changed
        self.commands: list[tuple[str, ...]] = []

    def run(self, command, cwd, check=True):
        command = tuple(command)
        self.commands.append(command)
        if command[:3] == ("git", "rev-parse", "--show-toplevel"):
            return pr_guard.Result(str(self.root) + "\n")
        if command[:3] == ("git", "status", "--porcelain=v1"):
            return pr_guard.Result(" M existing.ts\n" if self.dirty else "")
        if command[:4] == ("git", "remote", "get-url", "origin"):
            return pr_guard.Result("https://github.com/example/repo.git\n")
        if command[:3] == ("gh", "auth", "status"):
            return pr_guard.Result()
        if command[:4] == ("gh", "repo", "view", "--json"):
            return pr_guard.Result(json.dumps({"defaultBranchRef": {"name": "main"}, "nameWithOwner": "example/repo"}))
        if command[:3] == ("git", "branch", "--show-current"):
            return pr_guard.Result("codex/gsc-optimizer-20260831-canonical\n")
        if command[:3] == ("git", "diff", "--name-only"):
            return pr_guard.Result(self.changed + ("\n" if self.changed else ""))
        if command[:4] == ("git", "diff", "--cached", "--name-only"):
            return pr_guard.Result("")
        if command[:3] == ("git", "ls-files", "--others"):
            return pr_guard.Result("")
        if command[:3] == ("git", "show-ref", "--verify"):
            return pr_guard.Result(returncode=1)
        if command[:3] == ("gh", "pr", "create"):
            return pr_guard.Result("https://github.com/example/repo/pull/1\n")
        return pr_guard.Result()


class PrGuardTests(unittest.TestCase):
    def test_dirty_worktree_is_blocked(self):
        with tempfile.TemporaryDirectory() as raw, patch("pr_guard.shutil.which", return_value="/bin/gh"):
            root = Path(raw)
            with self.assertRaisesRegex(pr_guard.GuardError, "not clean"):
                pr_guard.preflight(root, FakeRunner(root, dirty=True))

    def test_missing_gh_is_blocked(self):
        with tempfile.TemporaryDirectory() as raw, patch("pr_guard.shutil.which", return_value=None):
            root = Path(raw)
            with self.assertRaisesRegex(pr_guard.GuardError, "not installed"):
                pr_guard.preflight(root, FakeRunner(root))

    def test_successful_draft_pr_flow_uses_exact_file(self):
        with tempfile.TemporaryDirectory() as repo_raw, tempfile.TemporaryDirectory() as outside_raw, patch("pr_guard.shutil.which", return_value="/bin/gh"):
            root = Path(repo_raw)
            changed = root / "apps" / "news" / "seo.ts"
            changed.parent.mkdir(parents=True)
            changed.write_text("export const canonical = true\n", encoding="utf-8")
            body = Path(outside_raw) / "pr.md"
            body.write_text("Aggregate GSC evidence and validation summary.", encoding="utf-8")
            runner = FakeRunner(root, changed="apps/news/seo.ts")
            result = pr_guard.publish(root, ["apps/news/seo.ts"], "Fix canonical metadata", body, "fix SEO canonical metadata", True, runner)
            self.assertEqual(result["pullRequest"], "https://github.com/example/repo/pull/1")
            self.assertIn(("git", "add", "--", "apps/news/seo.ts"), runner.commands)
            self.assertTrue(any(command[:3] == ("gh", "pr", "create") and "--draft" in command for command in runner.commands))

    def test_unreviewed_files_and_exports_are_blocked(self):
        with tempfile.TemporaryDirectory() as repo_raw, tempfile.TemporaryDirectory() as outside_raw, patch("pr_guard.shutil.which", return_value="/bin/gh"):
            root = Path(repo_raw)
            changed = root / "report.json"
            changed.write_text(json.dumps({"schemaVersion": "1.0", "queries": [], "inspections": []}), encoding="utf-8")
            body = Path(outside_raw) / "pr.md"
            body.write_text("Summary", encoding="utf-8")
            with self.assertRaisesRegex(pr_guard.GuardError, "Search Insights"):
                pr_guard.publish(root, ["report.json"], "Title", body, "commit", True, FakeRunner(root, changed="report.json"))


if __name__ == "__main__":
    unittest.main()
