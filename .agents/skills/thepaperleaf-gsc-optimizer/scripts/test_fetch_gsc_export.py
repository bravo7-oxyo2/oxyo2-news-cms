#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parent.parent
FETCH_SCRIPT = SKILL_ROOT / "scripts" / "fetch_gsc_export.sh"


def metric(clicks=10, impressions=100, ctr=0.1, position=5):
    return {"clicks": clicks, "impressions": impressions, "ctr": ctr, "position": position}


def canonical():
    return {
        "schemaVersion": "1.0",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "property": "sc-domain:thepaperleaf.com",
        "range": {"startDate": "2026-09-01", "endDate": "2026-09-30"},
        "rowLimits": {"queries": 5000, "pages": 5000},
        "summary": metric(),
        "previousSummary": metric(8, 90, 0.08, 6),
        "daily": [{"keys": ["2026-09-01"], **metric()}],
        "queries": [{"keys": ["private scheduled query"], **metric(0, 200, 0, 9)}],
        "pages": [{"keys": ["https://thepaperleaf.com/article/example"], **metric()}],
        "countries": [{"keys": ["mys"], **metric()}],
        "devices": [{"keys": ["mobile"], **metric()}],
        "searchAppearances": [],
        "sitemaps": [{"path": "https://thepaperleaf.com/sitemap.xml", "errors": 0, "warnings": 0}],
        "inspections": [{"url": "https://thepaperleaf.com/article/example", "verdict": "PASS"}],
        "notices": [],
    }


class CloudFetchTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.bin_dir = self.root / "bin"
        self.repo = self.root / "repo"
        self.temp_dir = self.root / "private"
        self.bin_dir.mkdir()
        self.repo.mkdir()
        self.temp_dir.mkdir()
        self.fixture = self.root / "export.json"
        self.fixture.write_text(json.dumps(canonical()), encoding="utf-8")
        self.capture = self.root / "curl-config.txt"
        fake_curl = self.bin_dir / "curl"
        fake_curl.write_text(
            """#!/usr/bin/env bash
set -Eeuo pipefail
config="$(cat)"
printf '%s' "$config" > "$FAKE_CURL_CONFIG_CAPTURE"
output=''
while [[ $# -gt 0 ]]; do
  if [[ "$1" == '--output' ]]; then output="$2"; shift 2; else shift; fi
done
[[ -n "$output" ]]
cp "$FAKE_GSC_FIXTURE" "$output"
""",
            encoding="utf-8",
        )
        fake_curl.chmod(0o700)

    def tearDown(self):
        self.temporary.cleanup()

    def environment(self):
        return {
            **os.environ,
            "PATH": f"{self.bin_dir}:{os.environ['PATH']}",
            "TMPDIR": str(self.temp_dir),
            "PAPERLEAF_GSC_EXPORT_URL": "https://admin.thepaperleaf.com/api/admin/search-console/automation-export",
            "PAPERLEAF_GSC_EXPORT_TOKEN": "t" * 48,
            "PAPERLEAF_GSC_OFFLINE": "1",
            "FAKE_GSC_FIXTURE": str(self.fixture),
            "FAKE_CURL_CONFIG_CAPTURE": str(self.capture),
        }

    def run_fetch(self, environment):
        return subprocess.run(
            ["bash", str(FETCH_SCRIPT), str(self.repo)],
            env=environment,
            text=True,
            capture_output=True,
            check=False,
        )

    def test_fetches_validates_analyzes_and_removes_raw_export(self):
        result = self.run_fetch(self.environment())
        self.assertEqual(result.returncode, 0, result.stderr)
        match = re.search(r"Private analysis written to: (.+)$", result.stdout.strip())
        self.assertIsNotNone(match)
        analysis_path = Path(match.group(1))
        self.assertTrue(analysis_path.is_file())
        self.assertFalse(analysis_path.is_relative_to(self.repo))
        analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
        serialized = json.dumps(analysis)
        self.assertNotIn("private scheduled query", serialized)
        self.assertNotIn("private scheduled query", result.stdout)
        self.assertFalse(analysis["privacy"]["safeToCommit"])
        self.assertEqual(list(self.temp_dir.glob("thepaperleaf-gsc-input.*")), [])
        curl_config = self.capture.read_text(encoding="utf-8")
        self.assertIn("Authorization: Bearer", curl_config)
        self.assertIn("t" * 48, curl_config)

    def test_requires_the_network_secret(self):
        environment = self.environment()
        environment.pop("PAPERLEAF_GSC_EXPORT_TOKEN")
        result = self.run_fetch(environment)
        self.assertEqual(result.returncode, 2)
        self.assertIn("PAPERLEAF_GSC_EXPORT_TOKEN is required", result.stderr)
        self.assertFalse(self.capture.exists())

    def test_rejects_non_https_export_urls(self):
        environment = self.environment()
        environment["PAPERLEAF_GSC_EXPORT_URL"] = "http://admin.thepaperleaf.com/export"
        result = self.run_fetch(environment)
        self.assertEqual(result.returncode, 2)
        self.assertIn("must be an HTTPS URL", result.stderr)
        self.assertFalse(self.capture.exists())

    def test_rejects_a_temporary_directory_inside_the_repository(self):
        environment = self.environment()
        environment["TMPDIR"] = str(self.repo)
        result = self.run_fetch(environment)
        self.assertEqual(result.returncode, 2)
        self.assertIn("TMPDIR must be outside the repository", result.stderr)
        self.assertFalse(self.capture.exists())


if __name__ == "__main__":
    unittest.main()
